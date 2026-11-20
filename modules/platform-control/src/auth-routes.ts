import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  hashPassword,
  insertOperatorAudit,
  mfaEnforcement,
  lookupOperatorByEmail,
  lookupOperatorChallenge,
  lookupOperatorSession,
  lookupOperatorTotp,
  openOperatorChallenge,
  openOperatorSession,
  operatorFailureCount,
  recordOperatorAttempt,
  revokeOperatorSession,
  setOperatorTotp,
  touchOperatorChallenge,
  verifyPassword,
} from '@omnivate/kernel';
import { platformAllows, platformPermissions, type PlatformAction } from '@omnivate/shared';
import {
  CHALLENGE_SECONDS,
  cookieOptions,
  HttpError,
  LOGIN_FAILURE_LIMIT,
  MFA_FAILURE_LIMIT,
  OPERATOR_COOKIE,
  OPERATOR_PENDING,
  readBody,
  readCode,
  readEmail,
  readPassword,
  requestMeta,
  route,
  signInAgain,
  unauthenticated,
  type RequestMeta,
} from './http';
import { operatorSessionTtlSeconds } from './session';
import { hashToken, newToken } from './tokens';
import { createTotpSecret, totpUri, verifyTotp } from './totp';

export type OperatorContext = {
  sessionId: string;
  id: string;
  email: string;
  displayName: string;
  roleKeys: string[];
};

let dummyHash: Promise<string> | undefined;

function timingHash(): Promise<string> {
  dummyHash ??= hashPassword('omnivate-operator-timing');
  return dummyHash;
}

function clearOperatorCookies(reply: FastifyReply): void {
  reply.clearCookie(OPERATOR_COOKIE, { path: '/' });
  reply.clearCookie(OPERATOR_PENDING, { path: '/' });
}

export async function requireOperator(
  request: FastifyRequest,
  action?: PlatformAction,
): Promise<OperatorContext> {
  const raw = request.cookies[OPERATOR_COOKIE];
  if (!raw) {
    throw signInAgain();
  }
  const session = await lookupOperatorSession(hashToken(raw));
  if (!session || session.expired || session.revokedAt || session.status !== 'active') {
    throw signInAgain();
  }
  if (action && !platformAllows(session.roleKeys, action)) {
    throw new HttpError(403, 'forbidden', 'Your platform role cannot do that.');
  }
  return {
    sessionId: session.id,
    id: session.operatorId,
    email: session.email,
    displayName: session.displayName,
    roleKeys: session.roleKeys,
  };
}

async function auditAuth(
  operatorId: string,
  meta: RequestMeta,
  action: string,
  after: Record<string, unknown>,
): Promise<void> {
  await insertOperatorAudit({
    tenantId: null,
    operatorId,
    action,
    entityType: 'platform_operator',
    entityId: operatorId,
    beforeData: null,
    afterData: after,
    requestIp: meta.requestIp,
    userAgent: meta.userAgent,
  });
}

export function registerOperatorAuth(app: FastifyInstance): void {
  app.post(
    '/control/auth/login',
    route(async (request, reply) => {
      const body = readBody(request);
      const email = readEmail(body.email);
      const password = readPassword(body.password);
      const meta = requestMeta(request);
      const operator = await lookupOperatorByEmail(email);
      const passwordOk = operator
        ? await verifyPassword(operator.passwordHash, password)
        : await verifyPassword(await timingHash(), password);

      if ((await operatorFailureCount(email)) >= LOGIN_FAILURE_LIMIT) {
        if (operator) {
          await recordOperatorAttempt({
            email,
            operatorId: operator.id,
            succeeded: false,
            requestIp: meta.requestIp,
          });
          await auditAuth(operator.id, meta, 'platform.login.locked', { reason: 'locked' });
        }
        throw new HttpError(
          429,
          'locked',
          'Too many sign-in attempts. Try again in a few minutes.',
        );
      }

      if (!operator || !passwordOk || operator.status !== 'active') {
        await recordOperatorAttempt({
          email,
          operatorId: operator?.status === 'active' ? operator.id : null,
          succeeded: false,
          requestIp: meta.requestIp,
        });
        if (operator) {
          await auditAuth(operator.id, meta, 'platform.login.failed', {
            reason: operator.status === 'active' ? 'bad_password' : 'disabled',
          });
        }
        throw unauthenticated();
      }

      if (mfaEnforcement() === 'off') {
        const sessionToken = newToken();
        await openOperatorSession({
          operatorId: operator.id,
          tokenHash: hashToken(sessionToken),
          expiresAt: new Date(Date.now() + operatorSessionTtlSeconds() * 1000),
          requestIp: meta.requestIp,
          userAgent: meta.userAgent,
        });
        await recordOperatorAttempt({
          email,
          operatorId: operator.id,
          succeeded: true,
          requestIp: meta.requestIp,
        });
        await auditAuth(operator.id, meta, 'platform.login.succeeded', { mfa: false });
        reply.clearCookie(OPERATOR_PENDING, { path: '/' });
        reply.setCookie(OPERATOR_COOKIE, sessionToken, cookieOptions(operatorSessionTtlSeconds()));
        const opened = await lookupOperatorSession(hashToken(sessionToken));
        await reply.send({
          step: 'session',
          operator: {
            id: operator.id,
            email: operator.email,
            displayName: opened?.displayName ?? operator.displayName,
            roles: opened?.roleKeys ?? operator.roleKeys,
          },
        });
        return;
      }

      const purpose = operator.totpEnabled ? 'mfa_verify' : 'mfa_enroll';
      const secret = purpose === 'mfa_enroll' ? createTotpSecret() : null;
      const token = newToken();
      await openOperatorChallenge({
        operatorId: operator.id,
        purpose,
        tokenHash: hashToken(token),
        totpSecret: secret,
        expiresAt: new Date(Date.now() + CHALLENGE_SECONDS * 1000),
      });
      await recordOperatorAttempt({
        email,
        operatorId: operator.id,
        succeeded: true,
        requestIp: meta.requestIp,
      });
      await auditAuth(operator.id, meta, 'platform.login.mfa_required', { step: purpose });
      reply.clearCookie(OPERATOR_COOKIE, { path: '/' });
      reply.setCookie(OPERATOR_PENDING, token, cookieOptions(CHALLENGE_SECONDS));
      await reply.send({ step: purpose });
    }),
  );

  app.get(
    '/control/auth/mfa/pending',
    route(async (request, reply) => {
      const raw = request.cookies[OPERATOR_PENDING];
      if (!raw) {
        throw signInAgain();
      }
      const challenge = await lookupOperatorChallenge(hashToken(raw));
      if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now()) {
        throw signInAgain();
      }
      if (challenge.purpose === 'mfa_enroll' && challenge.totpSecret) {
        await reply.send({
          step: 'mfa_enroll',
          secret: challenge.totpSecret,
          otpauthUrl: totpUri(challenge.email, challenge.totpSecret),
        });
        return;
      }
      await reply.send({ step: 'mfa_verify' });
    }),
  );

  app.post(
    '/control/auth/mfa/confirm',
    route(async (request, reply) => {
      const raw = request.cookies[OPERATOR_PENDING];
      if (!raw) {
        throw signInAgain();
      }
      const code = readCode(readBody(request).code);
      const meta = requestMeta(request);
      const challenge = await lookupOperatorChallenge(hashToken(raw));
      if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now()) {
        throw signInAgain();
      }
      const secret =
        challenge.purpose === 'mfa_enroll'
          ? challenge.totpSecret
          : await lookupOperatorTotp(challenge.operatorId);
      if (!secret || !verifyTotp(secret, code)) {
        const attempts = challenge.failedAttempts + 1;
        const locked = attempts >= MFA_FAILURE_LIMIT;
        await touchOperatorChallenge(challenge.id, attempts, locked ? new Date() : null);
        await auditAuth(challenge.operatorId, meta, 'platform.mfa.failed', {
          failedAttempts: attempts,
          locked,
        });
        throw new HttpError(
          401,
          'mfa_invalid',
          locked ? 'Too many codes. Sign in again.' : 'That code did not match. Try the next one.',
        );
      }

      if (challenge.purpose === 'mfa_enroll') {
        await setOperatorTotp(challenge.operatorId, secret, true);
        await auditAuth(challenge.operatorId, meta, 'platform.mfa.enrolled', { totpEnabled: true });
      }
      await touchOperatorChallenge(challenge.id, challenge.failedAttempts, new Date());
      const token = newToken();
      await openOperatorSession({
        operatorId: challenge.operatorId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + operatorSessionTtlSeconds() * 1000),
        requestIp: meta.requestIp,
        userAgent: meta.userAgent,
      });
      await auditAuth(challenge.operatorId, meta, 'platform.login.succeeded', { mfa: true });
      reply.clearCookie(OPERATOR_PENDING, { path: '/' });
      reply.setCookie(OPERATOR_COOKIE, token, cookieOptions(operatorSessionTtlSeconds()));
      const session = await lookupOperatorSession(hashToken(token));
      await reply.send({
        step: 'session',
        operator: {
          id: challenge.operatorId,
          email: challenge.email,
          displayName: session?.displayName ?? challenge.email,
          roles: session?.roleKeys ?? [],
        },
      });
    }),
  );

  app.post(
    '/control/auth/logout',
    route(async (request, reply) => {
      const raw = request.cookies[OPERATOR_COOKIE];
      const meta = requestMeta(request);
      if (raw) {
        const session = await lookupOperatorSession(hashToken(raw));
        if (session && !session.revokedAt) {
          await revokeOperatorSession(session.id);
          await auditAuth(session.operatorId, meta, 'platform.logout', { sessionId: session.id });
        }
      }
      clearOperatorCookies(reply);
      await reply.send({ ok: true });
    }),
  );

  app.get(
    '/control/auth/session',
    route(async (request, reply) => {
      const operator = await requireOperator(request);
      await reply.send({
        step: 'session',
        operator: {
          id: operator.id,
          email: operator.email,
          displayName: operator.displayName,
          roles: operator.roleKeys,
        },
        permissions: [...platformPermissions(operator.roleKeys)],
      });
    }),
  );
}
