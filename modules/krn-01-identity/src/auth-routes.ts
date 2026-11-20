import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  appendAuditEvent,
  authChallenges,
  hashPassword,
  mfaEnforcement,
  loginAttempts,
  lookupChallenge,
  lookupInvite,
  lookupLoginMemberships,
  lookupSession,
  lookupTenantBySlug,
  lookupTotpSecret,
  lookupUserByEmail,
  sessions,
  tenantId,
  tenants,
  users,
  verifyPassword,
  withTenant,
  type TenantTransaction,
} from '@omnivate/kernel';
import {
  CHALLENGE_SECONDS,
  HttpError,
  LOGIN_FAILURE_LIMIT,
  LOGIN_WINDOW_MINUTES,
  MFA_FAILURE_LIMIT,
  PENDING_COOKIE,
  SESSION_COOKIE,
  cookieOptions,
  readBody,
  readCode,
  readEmail,
  readPassword,
  readOptionalSlug,
  requestMeta,
  route,
  signInAgain,
  unauthenticated,
  type RequestMeta,
} from './http';
import { openChallenge, openSession } from './issue';
import { describeSession, type SessionBody } from './profile';
import { sessionTtlSeconds } from './session';
import { hashToken } from './tokens';
import { createTotpSecret, totpUri, verifyTotp } from './totp';
import { acceptInvite, type InviteAcceptResult } from './invite';

let dummyHash: Promise<string> | undefined;

function timingHash(): Promise<string> {
  dummyHash ??= hashPassword('omnivate-timing-padding');
  return dummyHash;
}

async function failureCount(tx: TenantTransaction, email: string): Promise<number> {
  const result = await tx.db.execute<{ count: string }>(sql`
    SELECT count(*)::text AS count
    FROM login_attempts
    WHERE email = ${email}
      AND succeeded = false
      AND attempted_at > now() - (${LOGIN_WINDOW_MINUTES}::int * interval '1 minute')
      AND attempted_at > COALESCE((
        SELECT max(attempted_at)
        FROM login_attempts
        WHERE email = ${email}
          AND succeeded = true
      ), '-infinity'::timestamptz)
  `);
  return Number(result.rows[0]?.count ?? 0);
}

async function recordAttempt(
  tx: TenantTransaction,
  input: {
    email: string;
    userId: string | null;
    succeeded: boolean;
    meta: RequestMeta;
    auditAction: string;
    entityType: string;
    entityId: string;
    after: Record<string, unknown>;
  },
): Promise<void> {
  await tx.db.insert(loginAttempts).values({
    tenantId: tx.tenantId,
    userId: input.userId,
    email: input.email,
    succeeded: input.succeeded,
    requestIp: input.meta.requestIp,
  });
  await appendAuditEvent(tx, {
    action: input.auditAction,
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: input.userId,
    beforeData: null,
    afterData: input.after,
    requestIp: input.meta.requestIp,
    userAgent: input.meta.userAgent,
  });
}

function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, cookieOptions(sessionTtlSeconds()));
  reply.clearCookie(PENDING_COOKIE, { path: '/' });
}

function setPendingCookie(reply: FastifyReply, token: string): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  reply.setCookie(PENDING_COOKIE, token, cookieOptions(CHALLENGE_SECONDS));
}

/**
 * The tenant comes from the session row. A request header is never read for it.
 */
export async function requireSession(request: {
  cookies: Record<string, string | undefined>;
}): Promise<NonNullable<Awaited<ReturnType<typeof lookupSession>>>> {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) {
    throw signInAgain();
  }
  const session = await lookupSession(hashToken(raw));
  if (
    !session ||
    session.expired ||
    session.revokedAt ||
    session.userStatus !== 'active' ||
    session.membershipStatus !== 'active'
  ) {
    throw signInAgain();
  }
  if (session.tenantStatus !== 'active') {
    throw new HttpError(
      403,
      'tenant_unavailable',
      'This company is not active. Sign-in is closed.',
    );
  }
  return session;
}

async function finishLogin(
  reply: FastifyReply,
  company: ReturnType<typeof tenantId>,
  userId: string,
  meta: RequestMeta,
  mfaRequired: boolean,
  totpEnabled: boolean,
  email: string,
): Promise<SessionBody | { step: 'mfa_enroll' | 'mfa_verify' }> {
  if (mfaEnforcement() === 'on' && (totpEnabled || mfaRequired)) {
    const purpose = totpEnabled ? 'mfa_verify' : 'mfa_enroll';
    const secret = purpose === 'mfa_enroll' ? createTotpSecret() : null;
    const token = await withTenant(company, async (tx) => {
      await recordAttempt(tx, {
        email,
        userId,
        succeeded: true,
        meta,
        auditAction: 'auth.login.mfa_required',
        entityType: 'user',
        entityId: userId,
        after: { step: purpose },
      });
      return openChallenge(tx, { userId, purpose, totpSecret: secret });
    });
    setPendingCookie(reply, token);
    return { step: purpose };
  }

  const token = await withTenant(company, async (tx) => {
    await recordAttempt(tx, {
      email,
      userId,
      succeeded: true,
      meta,
      auditAction: 'auth.login.succeeded',
      entityType: 'user',
      entityId: userId,
      after: { mfa: false },
    });
    return openSession(tx, userId, meta);
  });
  setSessionCookie(reply, token);
  return withTenant(company, (tx) => describeSession(tx, userId));
}

function companiesForSignIn(memberships: Awaited<ReturnType<typeof lookupLoginMemberships>>) {
  return memberships
    .filter((item) => item.membershipStatus === 'active' && item.tenantStatus === 'active')
    .sort((left, right) => left.tenantName.localeCompare(right.tenantName, 'en'));
}

async function passwordMatches(hash: string | undefined, password: string): Promise<boolean> {
  if (!hash) {
    await verifyPassword(await timingHash(), password);
    return false;
  }
  return verifyPassword(hash, password);
}

async function ensureNotLocked(
  email: string,
  companyIds: readonly string[],
  userId: string | null,
  meta: RequestMeta,
): Promise<void> {
  for (const companyId of companyIds) {
    const locked = await withTenant(tenantId(companyId), (tx) => failureCount(tx, email));
    if (locked < LOGIN_FAILURE_LIMIT) {
      continue;
    }
    await withTenant(tenantId(companyId), (tx) =>
      recordAttempt(tx, {
        email,
        userId,
        succeeded: false,
        meta,
        auditAction: 'auth.login.locked',
        entityType: userId ? 'user' : 'tenant',
        entityId: userId ?? companyId,
        after: { reason: 'locked' },
      }),
    );
    throw new HttpError(429, 'locked', 'Too many sign-in attempts. Try again in a few minutes.');
  }
}

async function recordFailure(
  email: string,
  userId: string | null,
  companyIds: readonly string[],
  meta: RequestMeta,
  reason: string,
): Promise<void> {
  for (const companyId of companyIds) {
    await withTenant(tenantId(companyId), (tx) =>
      recordAttempt(tx, {
        email,
        userId,
        succeeded: false,
        meta,
        auditAction: 'auth.login.failed',
        entityType: userId ? 'user' : 'tenant',
        entityId: userId ?? companyId,
        after: { reason },
      }),
    );
  }
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post(
    '/auth/login',
    route(async (request, reply) => {
      const body = readBody(request);
      const email = readEmail(body.email);
      const password = readPassword(body.password);
      const slug = readOptionalSlug(body.tenantSlug);
      const meta = requestMeta(request);
      const user = await lookupUserByEmail(email);
      const passwordOk = await passwordMatches(user?.passwordHash, password);
      const recognised = Boolean(user && passwordOk && user.status === 'active');
      const memberships = user ? await lookupLoginMemberships(user.id) : [];
      const open = companiesForSignIn(memberships);

      if (slug) {
        const company = await lookupTenantBySlug(slug);
        if (!company) {
          throw unauthenticated();
        }
        if (company.status !== 'active') {
          throw new HttpError(
            403,
            'tenant_unavailable',
            'This company is not active. Sign-in is closed.',
          );
        }
        await ensureNotLocked(email, [company.id], user?.id ?? null, meta);
        if (!recognised) {
          await recordFailure(
            email,
            user?.id ?? null,
            [company.id],
            meta,
            user && user.status === 'active' ? 'bad_password' : 'unknown_user',
          );
          throw unauthenticated();
        }
        if (!user) {
          throw unauthenticated();
        }
        const membership = memberships.find(
          (item) => item.tenantId === company.id && item.membershipStatus === 'active',
        );
        if (!membership) {
          await recordFailure(email, user.id, [company.id], meta, 'inactive');
          throw unauthenticated();
        }
        const result = await finishLogin(
          reply,
          tenantId(company.id),
          user.id,
          meta,
          membership.mfaRequired,
          user.totpEnabled,
          email,
        );
        await reply.send(result);
        return;
      }

      if (!recognised) {
        if (open.length > 0) {
          const companyIds = open.map((item) => item.tenantId);
          await ensureNotLocked(email, companyIds, user?.id ?? null, meta);
          await recordFailure(
            email,
            user?.id ?? null,
            companyIds,
            meta,
            user && user.status === 'active' ? 'bad_password' : 'unknown_user',
          );
        }
        throw unauthenticated();
      }
      if (!user) {
        throw unauthenticated();
      }

      if (open.length === 0) {
        const closed = memberships.some(
          (item) => item.membershipStatus === 'active' && item.tenantStatus !== 'active',
        );
        if (closed) {
          throw new HttpError(
            403,
            'tenant_unavailable',
            'This company is not active. Sign-in is closed.',
          );
        }
        throw unauthenticated();
      }

      if (open.length > 1) {
        await reply.send({
          step: 'choose_company',
          companies: open.map((item) => ({ slug: item.tenantSlug, name: item.tenantName })),
        });
        return;
      }

      const only = open[0];
      if (!only) {
        throw unauthenticated();
      }
      await ensureNotLocked(email, [only.tenantId], user.id, meta);
      const result = await finishLogin(
        reply,
        tenantId(only.tenantId),
        user.id,
        meta,
        only.mfaRequired,
        user.totpEnabled,
        email,
      );
      await reply.send(result);
    }),
  );

  app.get(
    '/auth/mfa/pending',
    route(async (request, reply) => {
      const raw = request.cookies[PENDING_COOKIE];
      if (!raw) {
        throw signInAgain();
      }
      const challenge = await lookupChallenge(hashToken(raw));
      if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now()) {
        throw signInAgain();
      }
      const email = await withTenant(tenantId(challenge.tenantId), async (tx) => {
        const rows = await tx.db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, challenge.userId));
        return rows[0]?.email ?? 'person';
      });
      if (challenge.purpose === 'mfa_enroll' && challenge.totpSecret) {
        await reply.send({
          step: 'mfa_enroll',
          secret: challenge.totpSecret,
          otpauthUrl: totpUri(email, challenge.totpSecret),
        });
        return;
      }
      await reply.send({ step: 'mfa_verify' });
    }),
  );

  app.post(
    '/auth/mfa/confirm',
    route(async (request, reply) => {
      const raw = request.cookies[PENDING_COOKIE];
      if (!raw) {
        throw signInAgain();
      }
      const code = readCode(readBody(request).code);
      const meta = requestMeta(request);
      const challenge = await lookupChallenge(hashToken(raw));
      if (!challenge || challenge.consumedAt) {
        throw signInAgain();
      }

      const outcome = await withTenant(tenantId(challenge.tenantId), async (tx) => {
        const fresh = await tx.db
          .select({
            id: authChallenges.id,
            purpose: authChallenges.purpose,
            totpSecret: authChallenges.totpSecret,
            failedAttempts: authChallenges.failedAttempts,
            userId: authChallenges.userId,
          })
          .from(authChallenges)
          .where(
            and(
              eq(authChallenges.id, challenge.id),
              isNull(authChallenges.consumedAt),
              sql`${authChallenges.expiresAt} > now()`,
            ),
          );
        const row = fresh[0];
        if (!row) {
          return { kind: 'expired' as const };
        }

        const secret =
          row.purpose === 'mfa_enroll' ? row.totpSecret : await lookupTotpSecret(row.userId);
        const company = await tx.db.select({ status: tenants.status }).from(tenants);
        if (company[0]?.status !== 'active') {
          return { kind: 'suspended' as const };
        }

        if (!secret || !verifyTotp(secret, code)) {
          const attempts = row.failedAttempts + 1;
          const lock = attempts >= MFA_FAILURE_LIMIT;
          await tx.db
            .update(authChallenges)
            .set({
              failedAttempts: attempts,
              consumedAt: lock ? new Date() : null,
            })
            .where(eq(authChallenges.id, row.id));
          await appendAuditEvent(tx, {
            action: 'auth.mfa.failed',
            entityType: 'user',
            entityId: row.userId,
            actorId: row.userId,
            beforeData: { failedAttempts: row.failedAttempts },
            afterData: { failedAttempts: attempts, locked: lock },
            requestIp: meta.requestIp,
            userAgent: meta.userAgent,
          });
          return { kind: 'bad_code' as const, locked: lock };
        }

        if (row.purpose === 'mfa_enroll') {
          await tx.db.execute(sql`SELECT krn_set_totp(${row.userId}::uuid, ${secret}, true)`);
          await appendAuditEvent(tx, {
            action: 'auth.mfa.enrolled',
            entityType: 'user',
            entityId: row.userId,
            actorId: row.userId,
            beforeData: { totpEnabled: false },
            afterData: { totpEnabled: true },
            requestIp: meta.requestIp,
            userAgent: meta.userAgent,
          });
        } else {
          await appendAuditEvent(tx, {
            action: 'auth.mfa.verified',
            entityType: 'user',
            entityId: row.userId,
            actorId: row.userId,
            beforeData: null,
            afterData: { totpEnabled: true },
            requestIp: meta.requestIp,
            userAgent: meta.userAgent,
          });
        }

        await tx.db
          .update(authChallenges)
          .set({ consumedAt: new Date() })
          .where(eq(authChallenges.id, row.id));
        await appendAuditEvent(tx, {
          action: 'auth.login.succeeded',
          entityType: 'user',
          entityId: row.userId,
          actorId: row.userId,
          beforeData: null,
          afterData: { mfa: true },
          requestIp: meta.requestIp,
          userAgent: meta.userAgent,
        });
        const token = await openSession(tx, row.userId, meta);
        return { kind: 'ok' as const, token, userId: row.userId };
      });

      if (outcome.kind === 'expired') {
        throw signInAgain();
      }
      if (outcome.kind === 'suspended') {
        throw new HttpError(
          403,
          'tenant_unavailable',
          'This company is not active. Sign-in is closed.',
        );
      }
      if (outcome.kind === 'bad_code') {
        throw new HttpError(
          401,
          'mfa_invalid',
          outcome.locked
            ? 'Too many codes. Sign in again.'
            : 'That code did not match. Try the next one.',
        );
      }

      setSessionCookie(reply, outcome.token);
      const body = await withTenant(tenantId(challenge.tenantId), (tx) =>
        describeSession(tx, outcome.userId),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/auth/logout',
    route(async (request, reply) => {
      const raw = request.cookies[SESSION_COOKIE];
      const meta = requestMeta(request);
      if (raw) {
        const session = await lookupSession(hashToken(raw));
        if (session && !session.revokedAt) {
          await withTenant(tenantId(session.tenantId), async (tx) => {
            await tx.db
              .update(sessions)
              .set({ revokedAt: new Date() })
              .where(and(eq(sessions.id, session.id), isNull(sessions.revokedAt)));
            await appendAuditEvent(tx, {
              action: 'auth.logout',
              entityType: 'session',
              entityId: session.id,
              actorId: session.userId,
              beforeData: { revokedAt: null },
              afterData: { revokedAt: new Date().toISOString() },
              requestIp: meta.requestIp,
              userAgent: meta.userAgent,
            });
          });
        }
      }
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      reply.clearCookie(PENDING_COOKIE, { path: '/' });
      await reply.send({ ok: true });
    }),
  );

  app.get(
    '/auth/session',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const body = await withTenant(tenantId(session.tenantId), (tx) =>
        describeSession(tx, session.userId),
      );
      await reply.send(body);
    }),
  );

  app.get(
    '/auth/invites/preview',
    route(async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const token = typeof query.token === 'string' ? query.token : '';
      if (token.length < 20) {
        throw new HttpError(400, 'bad_request', 'This invite link is not valid.');
      }
      const invite = await lookupInvite(hashToken(token));
      if (!invite || invite.revokedAt || invite.acceptedAt) {
        throw new HttpError(400, 'bad_request', 'This invite link is not valid.');
      }
      await reply.send({
        email: invite.email,
        tenantName: invite.tenantName,
        roleName: invite.roleName,
        expired: invite.expiresAt.getTime() <= Date.now(),
      });
    }),
  );

  app.post(
    '/auth/invites/accept',
    route(async (request, reply) => {
      const body = readBody(request);
      const token = typeof body.token === 'string' ? body.token : '';
      if (token.length < 20) {
        throw new HttpError(400, 'bad_request', 'This invite link is not valid.');
      }
      const result: InviteAcceptResult = await acceptInvite({
        token,
        displayName: typeof body.displayName === 'string' ? body.displayName : '',
        password: typeof body.password === 'string' ? body.password : '',
        meta: requestMeta(request),
      });
      if (result.kind === 'session') {
        setSessionCookie(reply, result.token);
        const view = await withTenant(tenantId(result.tenantId), (tx) =>
          describeSession(tx, result.userId),
        );
        await reply.send(view);
        return;
      }
      setPendingCookie(reply, result.token);
      await reply.send({ step: result.step });
    }),
  );
}
