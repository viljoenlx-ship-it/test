import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { lookupSession, PermissionDeniedError, SodConflictError } from '@omnivate/kernel';
import { CatalogError } from './errors';

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

export type ActorMeta = {
  userId: string;
  tenantId: string;
  requestIp: string | null;
  userAgent: string | null;
};

export async function requireActor(request: FastifyRequest): Promise<ActorMeta> {
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

export function readBool(value: unknown): boolean {
  return value === true;
}

export function readPacks(value: unknown): { name: string; plural: string; factor: string }[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'bad_request', 'Extra units were not a list.');
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new HttpError(400, 'bad_request', 'Extra units were not a list.');
    }
    const row = entry as Record<string, unknown>;
    return {
      name: readText(row.name),
      plural: readText(row.plural),
      factor: readText(row.factor),
    };
  });
}

export function readSerials(value: unknown): string[] {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  throw new HttpError(400, 'bad_request', 'Enter serial numbers one per line.');
}

type RouteHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function route(handler: RouteHandler): RouteHandler {
  return async (request, reply) => {
    try {
      await handler(request, reply);
    } catch (error) {
      if (error instanceof HttpError || error instanceof CatalogError) {
        const status = error instanceof HttpError ? error.statusCode : error.statusCode;
        const code = error instanceof HttpError ? error.code : 'catalog';
        await reply.code(status).send({ error: code, message: error.message });
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
      throw error;
    }
  };
}
