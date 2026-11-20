import type { FastifyReply, FastifyRequest } from 'fastify';
import { PermissionDeniedError } from '@omnivate/kernel';
import { FileProblem } from './files';

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

export function readUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new HttpError(404, 'not_found', `That ${label} was not found.`);
  }
  return value;
}

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function route(handler: Handler): Handler {
  return async (request, reply) => {
    try {
      await handler(request, reply);
    } catch (error) {
      if (error instanceof HttpError) {
        await reply.code(error.statusCode).send({ error: error.code, message: error.message });
        return;
      }
      if (error instanceof PermissionDeniedError) {
        await reply.code(403).send({ error: 'forbidden', message: error.message });
        return;
      }
      if (error instanceof FileProblem) {
        await reply.code(400).send({ error: 'bad_request', message: error.message });
        return;
      }
      if (error instanceof Error && 'statusCode' in error) {
        const status = Number((error as { statusCode: unknown }).statusCode);
        if (status >= 400 && status < 500) {
          await reply.code(status).send({ error: 'bad_request', message: error.message });
          return;
        }
      }
      const statusCode =
        error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 0;
      if (statusCode === 413) {
        await reply.code(413).send({
          error: 'too_large',
          message: 'That file is larger than 20 MB. Split it into smaller files.',
        });
        return;
      }
      const message = error instanceof Error ? error.message : '';
      if (message === 'That import was not found.') {
        await reply.code(404).send({ error: 'not_found', message });
        return;
      }
      if (
        message.startsWith('There is nothing') ||
        message.startsWith('This import') ||
        message.startsWith('Only a finished') ||
        message.startsWith('Columns can') ||
        message.startsWith('That import')
      ) {
        await reply.code(409).send({ error: 'conflict', message });
        return;
      }
      throw error;
    }
  };
}
