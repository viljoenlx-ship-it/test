import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { lookupOperatorSession, lookupSession, PermissionDeniedError } from '@omnivate/kernel';
import { platformAllows } from '@omnivate/shared';
import { ReportError } from './types';

const SESSION_COOKIE = 'omnivate_session';
const OPERATOR_COOKIE = 'omnivate_operator';

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

export type ActorMeta = {
  userId: string;
  tenantId: string;
  requestIp: string | null;
  userAgent: string | null;
};

export type OperatorMeta = {
  operatorId: string;
  requestIp: string | null;
  userAgent: string | null;
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function meta(request: FastifyRequest): { requestIp: string | null; userAgent: string | null } {
  const agent = request.headers['user-agent'];
  return {
    requestIp: request.ip || null,
    userAgent: typeof agent === 'string' ? agent.slice(0, 300) : null,
  };
}

function cookiesOf(request: FastifyRequest): Record<string, string | undefined> {
  return (request as { cookies?: Record<string, string | undefined> }).cookies ?? {};
}

export async function requireActor(request: FastifyRequest): Promise<ActorMeta> {
  const raw = cookiesOf(request)[SESSION_COOKIE];
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
    throw new HttpError(403, 'tenant_unavailable', 'This company is not active.');
  }
  return { userId: session.userId, tenantId: session.tenantId, ...meta(request) };
}

export async function requireOperator(request: FastifyRequest): Promise<OperatorMeta> {
  const raw = cookiesOf(request)[OPERATOR_COOKIE];
  if (!raw) {
    throw new HttpError(401, 'unauthenticated', 'Sign in again.');
  }
  const session = await lookupOperatorSession(hashToken(raw));
  if (!session || session.expired || session.revokedAt || session.status !== 'active') {
    throw new HttpError(401, 'unauthenticated', 'Sign in again.');
  }
  if (!platformAllows(session.roleKeys, 'tenants.write')) {
    throw new HttpError(403, 'forbidden', 'Your platform role cannot change reports.');
  }
  return { operatorId: session.operatorId, ...meta(request) };
}

export function readBody(request: FastifyRequest): Record<string, unknown> {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw new HttpError(400, 'bad_request', 'Expected a JSON object.');
  }
  return request.body as Record<string, unknown>;
}

type RouteHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function route(handler: RouteHandler): RouteHandler {
  return async (request, reply) => {
    try {
      await handler(request, reply);
    } catch (error) {
      if (error instanceof HttpError || error instanceof ReportError) {
        const status = error.statusCode;
        const code = error instanceof HttpError ? error.code : 'report';
        await reply.code(status).send({ error: code, message: error.message });
        return;
      }
      if (error instanceof PermissionDeniedError) {
        await reply.code(403).send({ error: 'forbidden', message: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : '';
      if (
        message.toLowerCase().includes('statement timeout') ||
        message.includes('canceling statement')
      ) {
        await reply.code(400).send({
          error: 'timeout',
          message: 'This report took too long. Add a filter or choose fewer rows.',
        });
        return;
      }
      throw error;
    }
  };
}
