import { createHash } from 'node:crypto';
import '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  IdentityRuleError,
  PermissionDeniedError,
  SodConflictError,
  lookupOperatorSession,
  lookupSession,
  tenantId,
  type TenantId,
} from '@omnivate/kernel';
import { platformAllows, type PlatformAction } from '@omnivate/shared';
import { WorkflowError } from './errors';
import type { Actor } from './actions';

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
  return value.toLowerCase();
}

export function requestMeta(request: FastifyRequest): {
  requestIp: string | null;
  userAgent: string | null;
} {
  const agent = request.headers['user-agent'];
  return {
    requestIp: request.ip || null,
    userAgent: typeof agent === 'string' ? agent.slice(0, 300) : null,
  };
}

export type SessionContext = {
  userId: string;
  tenantId: TenantId;
  actor: Actor;
};

export async function requireSession(request: FastifyRequest): Promise<SessionContext> {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) {
    throw new HttpError(401, 'unauthenticated', 'Sign in again.');
  }
  const session = await lookupSession(hashToken(raw));
  if (
    !session ||
    session.expired ||
    session.revokedAt ||
    session.userStatus !== 'active' ||
    session.membershipStatus !== 'active'
  ) {
    throw new HttpError(401, 'unauthenticated', 'Sign in again.');
  }
  if (session.tenantStatus !== 'active') {
    throw new HttpError(
      403,
      'tenant_unavailable',
      'This company is not active. Sign-in is closed.',
    );
  }
  const meta = requestMeta(request);
  return {
    userId: session.userId,
    tenantId: tenantId(session.tenantId),
    actor: { actorId: session.userId, ...meta },
  };
}

export async function requireOperator(
  request: FastifyRequest,
  action: PlatformAction = 'tenants.read',
): Promise<{ id: string; requestIp: string | null; userAgent: string | null }> {
  const raw = request.cookies[OPERATOR_COOKIE];
  if (!raw) {
    throw new HttpError(401, 'unauthenticated', 'Sign in again.');
  }
  const session = await lookupOperatorSession(hashToken(raw));
  if (!session || session.expired || session.revokedAt || session.status !== 'active') {
    throw new HttpError(401, 'unauthenticated', 'Sign in again.');
  }
  if (!platformAllows(session.roleKeys, action)) {
    throw new HttpError(403, 'forbidden', 'Your platform role cannot do that.');
  }
  const meta = requestMeta(request);
  return { id: session.operatorId, ...meta };
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
      if (error instanceof WorkflowError) {
        await reply.code(400).send({ error: 'rule', message: error.message });
        return;
      }
      if (error instanceof PermissionDeniedError) {
        await reply.code(403).send({ error: 'forbidden', message: error.message });
        return;
      }
      if (error instanceof SodConflictError) {
        await reply.code(409).send({ error: 'sod_conflict', message: error.message });
        return;
      }
      if (error instanceof IdentityRuleError) {
        await reply.code(409).send({ error: 'rule', message: error.message });
        return;
      }
      throw error;
    }
  };
}
