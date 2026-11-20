import type { FastifyReply, FastifyRequest } from 'fastify';
import { PermissionDeniedError } from '@omnivate/kernel';
import { ParticularsError, SettingsValidationError } from '@omnivate/shared';

export const OPERATOR_COOKIE = 'omnivate_operator';
export const OPERATOR_PENDING = 'omnivate_operator_pending';
export const CHALLENGE_SECONDS = 5 * 60;
export const LOGIN_FAILURE_LIMIT = 5;
export const MFA_FAILURE_LIMIT = 5;
export const INVITE_SECONDS = 7 * 24 * 60 * 60;

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

export function signInAgain(): HttpError {
  return new HttpError(401, 'unauthenticated', 'Sign in again.');
}

export function unauthenticated(): HttpError {
  return new HttpError(401, 'unauthenticated', 'Email or password was not recognised.');
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

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: maxAgeSeconds,
  };
}

export function readBody(request: FastifyRequest): Record<string, unknown> {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw new HttpError(400, 'bad_request', 'Expected a JSON object.');
  }
  return request.body as Record<string, unknown>;
}

export function readEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'bad_request', 'Enter an email address.');
  }
  const email = value.trim().toLowerCase();
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'bad_request', 'Enter an email address.');
  }
  return email;
}

export function readPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 10 || value.length > 200) {
    throw new HttpError(400, 'bad_request', 'Use a password of at least 10 characters.');
  }
  return value;
}

export function readCode(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value.replace(/\s/g, ''))) {
    throw new HttpError(400, 'bad_request', 'Enter the 6-digit code.');
  }
  return value.replace(/\s/g, '');
}

export function readUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new HttpError(400, 'bad_request', `That ${label} was not found.`);
  }
  return value.toLowerCase();
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
      if (error instanceof PermissionDeniedError) {
        await reply.code(403).send({ error: 'forbidden', message: error.message });
        return;
      }
      if (error instanceof ParticularsError || error instanceof SettingsValidationError) {
        await reply.code(400).send({ error: 'bad_request', message: error.message });
        return;
      }
      if (isUniqueViolation(error)) {
        await reply.code(409).send({
          error: 'conflict',
          message: 'That company code is already in use. Choose another.',
        });
        return;
      }
      const message = error instanceof Error ? error.message : '';
      if (
        message.includes('Cannot activate') ||
        message.includes('Cannot deactivate') ||
        message.includes('cannot be disabled')
      ) {
        await reply.code(409).send({ error: 'module_locked', message });
        return;
      }
      if (message.includes('must be a colour')) {
        await reply.code(400).send({ error: 'bad_request', message });
        return;
      }
      throw error;
    }
  };
}
