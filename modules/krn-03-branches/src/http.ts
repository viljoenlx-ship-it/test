import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/cookie';
import {
  BranchAccessError,
  lookupOperatorSession,
  lookupSession,
  PermissionDeniedError,
} from '@omnivate/kernel';
import { platformAllows, type PlatformAction } from '@omnivate/shared';

export const SESSION_COOKIE = 'omnivate_session';
export const OPERATOR_COOKIE = 'omnivate_operator';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class BranchRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BranchRuleError';
  }
}

export type RequestMeta = {
  requestIp: string | null;
  userAgent: string | null;
};

export function requestMeta(request: FastifyRequest): RequestMeta {
  const agent = request.headers['user-agent'];
  return {
    requestIp: request.ip || null,
    userAgent: typeof agent === 'string' ? agent.slice(0, 300) : null,
  };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function readBody(request: FastifyRequest): Record<string, unknown> {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw new HttpError(400, 'bad_request', 'Expected a JSON object.');
  }
  return request.body as Record<string, unknown>;
}

export function readUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new HttpError(400, 'bad_request', `That ${label} was not found.`);
  }
  return value;
}

function signInAgain(): HttpError {
  return new HttpError(401, 'unauthenticated', 'Sign in again.');
}

export async function requireSession(request: FastifyRequest) {
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

export async function requireOperator(request: FastifyRequest, action: PlatformAction) {
  const raw = request.cookies[OPERATOR_COOKIE];
  if (!raw) {
    throw signInAgain();
  }
  const session = await lookupOperatorSession(hashToken(raw));
  if (!session || session.expired || session.revokedAt || session.status !== 'active') {
    throw signInAgain();
  }
  if (!platformAllows(session.roleKeys, action)) {
    throw new HttpError(403, 'forbidden', 'Your platform role cannot do that.');
  }
  return session;
}

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 6 && current instanceof Error && !seen.has(current); depth += 1) {
    seen.add(current);
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join('\n');
}

export function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && current.code === '23505') {
      return true;
    }
    current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

type RouteHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function route(handler: RouteHandler): RouteHandler {
  return async (request, reply) => {
    try {
      await handler(request, reply);
    } catch (error) {
      if (error instanceof HttpError) {
        await reply.code(error.statusCode).send({ error: error.code, message: error.message });
        return;
      }
      if (error instanceof BranchRuleError) {
        await reply.code(409).send({ error: 'rule', message: error.message });
        return;
      }
      if (error instanceof BranchAccessError || error instanceof PermissionDeniedError) {
        await reply.code(403).send({ error: 'forbidden', message: error.message });
        return;
      }
      if (isUniqueViolation(error)) {
        await reply
          .code(409)
          .send({ error: 'conflict', message: 'That branch code is already in use.' });
        return;
      }
      const text = errorText(error);
      if (text.includes('same company') || text.includes('not in this company')) {
        await reply
          .code(409)
          .send({ error: 'rule', message: 'Choose a legal entity at this company.' });
        return;
      }
      throw error;
    }
  };
}
