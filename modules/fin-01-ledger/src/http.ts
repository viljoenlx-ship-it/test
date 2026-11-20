import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { lookupSession, PermissionDeniedError } from '@omnivate/kernel';
import { LedgerError } from './errors';
import type { LedgerActor } from './rows';

const SESSION_COOKIE = 'omnivate_session';

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

export async function requireActor(
  request: FastifyRequest,
): Promise<LedgerActor & { tenantId: string; userId: string }> {
  const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;
  const raw = cookies?.[SESSION_COOKIE];
  if (!raw) {
    throw new HttpError(401, 'unauthenticated', 'Sign in again.');
  }
  const session = await lookupSession(createHash('sha256').update(raw).digest('hex'));
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
  const agent = request.headers['user-agent'];
  return {
    userId: session.userId,
    tenantId: session.tenantId,
    requestIp: request.ip || null,
    userAgent: typeof agent === 'string' ? agent.slice(0, 300) : null,
  };
}

export function readBody(request: FastifyRequest): Record<string, unknown> {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw new HttpError(400, 'bad_request', 'Expected a JSON object.');
  }
  return request.body as Record<string, unknown>;
}

export function readText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

type RouteHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function route(handler: RouteHandler): RouteHandler {
  return async (request, reply) => {
    try {
      await handler(request, reply);
    } catch (error) {
      if (error instanceof HttpError || error instanceof LedgerError) {
        const status = error.statusCode;
        const code = error instanceof HttpError ? error.code : 'ledger';
        await reply.code(status).send({ error: code, message: error.message });
        return;
      }
      if (error instanceof PermissionDeniedError) {
        await reply.code(403).send({ error: 'forbidden', message: error.message });
        return;
      }
      throw error;
    }
  };
}
