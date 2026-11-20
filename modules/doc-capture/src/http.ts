import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PermissionDeniedError, SodConflictError } from '@omnivate/kernel';
import { PartyInputError } from '@omnivate/shared';
import { copy } from './copy';
import { DocumentError } from './errors';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function readBody(request: FastifyRequest): Record<string, unknown> {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw new DocumentError('Expected a JSON object.');
  }
  return request.body as Record<string, unknown>;
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

export function readUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new DocumentError(`That ${label} was not found.`, 404, 'not_found');
  }
  return value.toLowerCase();
}

function described(error: unknown): { status: number; code: string; message: string } | null {
  if (error instanceof DocumentError) {
    return { status: error.statusCode, code: error.code, message: error.message };
  }
  if (error instanceof PermissionDeniedError) {
    return { status: 403, code: 'forbidden', message: error.message };
  }
  if (error instanceof SodConflictError) {
    return { status: 409, code: 'sod_conflict', message: error.message };
  }
  if (error instanceof PartyInputError) {
    return { status: 400, code: 'bad_request', message: error.message };
  }
  if (error instanceof Error && error.name === 'CatalogError' && 'statusCode' in error) {
    const status = (error as { statusCode: number }).statusCode;
    return { status, code: 'catalog', message: error.message };
  }
  if (error instanceof Error && error.name === 'HttpError' && 'statusCode' in error) {
    const status = (error as { statusCode: number }).statusCode;
    return { status, code: 'request', message: error.message };
  }
  if (error instanceof Error && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
    return { status: 400, code: 'document', message: copy.tooLarge };
  }
  return null;
}

type RouteHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function route(handler: RouteHandler): RouteHandler {
  return async (request, reply) => {
    try {
      await handler(request, reply);
    } catch (error) {
      const known = described(error);
      if (!known) {
        throw error;
      }
      await reply.code(known.status).send({ error: known.code, message: known.message });
    }
  };
}
