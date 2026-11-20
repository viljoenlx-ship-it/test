import type { FastifyReply, FastifyRequest } from 'fastify';
import { PermissionDeniedError, SodConflictError } from '@omnivate/kernel';
import { PartyInputError } from '@omnivate/shared';

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

export class DuplicatePartyError extends Error {
  constructor(readonly matches: { id: string; displayName: string; reasons: string[] }[]) {
    super('A contact with this name, VAT number, or email already exists.');
    this.name = 'DuplicatePartyError';
  }
}

export function readBody(request: FastifyRequest): Record<string, unknown> {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw new HttpError(400, 'bad_request', 'Expected a JSON object.');
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
      if (error instanceof DuplicatePartyError) {
        await reply.code(409).send({
          error: 'duplicate',
          message: error.message,
          matches: error.matches,
        });
        return;
      }
      if (error instanceof PartyInputError) {
        await reply
          .code(400)
          .send({ error: 'bad_request', message: error.message, fields: error.fields });
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
