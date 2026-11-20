import type { FastifyReply, FastifyRequest } from 'fastify';
import { IdentityRuleError, PermissionDeniedError, SodConflictError } from '@omnivate/kernel';

export const SESSION_COOKIE = 'omnivate_session';
export const PENDING_COOKIE = 'omnivate_pending';
export const CHALLENGE_SECONDS = 5 * 60;
export const INVITE_SECONDS = 7 * 24 * 60 * 60;
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_WINDOW_MINUTES = 15;
export const MFA_FAILURE_LIMIT = 5;

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

export function unauthenticated(): HttpError {
  return new HttpError(401, 'unauthenticated', 'Email, password, or company was not recognised.');
}

export function signInAgain(): HttpError {
  return new HttpError(401, 'unauthenticated', 'Sign in again.');
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

export function cookieOptions(maxAgeSeconds: number): {
  httpOnly: true;
  sameSite: 'lax';
  path: string;
  secure: boolean;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
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

export function readPassword(value: unknown, label = 'password'): string {
  if (typeof value !== 'string' || value.length < 10 || value.length > 200) {
    throw new HttpError(400, 'bad_request', `Use a ${label} of at least 10 characters.`);
  }
  return value;
}

export function readSlug(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9-]{2,63}$/.test(value)) {
    throw new HttpError(400, 'bad_request', 'Choose a company.');
  }
  return value;
}

/** A blank company code means “use the companies this email belongs to”. */
export function readOptionalSlug(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return readSlug(value);
}

export function readDisplayName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'bad_request', 'Enter a name.');
  }
  const name = value.trim();
  if (name.length < 1 || name.length > 80) {
    throw new HttpError(400, 'bad_request', 'Enter a name.');
  }
  return name;
}

export function readRoleKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z_]{3,40}$/.test(value)) {
    throw new HttpError(400, 'bad_request', 'Choose a role.');
  }
  return value;
}

export function readUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new HttpError(400, 'bad_request', `That ${label} was not found.`);
  }
  return value;
}

export function readActionKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_.]{1,78}[a-z0-9]$/.test(value)) {
    throw new HttpError(400, 'bad_request', 'Choose an action from the list.');
  }
  return value;
}

export function readCode(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'bad_request', 'Enter the 6-digit code.');
  }
  const code = value.replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) {
    throw new HttpError(400, 'bad_request', 'Enter the 6-digit code.');
  }
  return code;
}

export function centsOrNull(value: bigint | null): number | null {
  if (value === null) {
    return null;
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Approval limit is too large to send as a number.');
  }
  return Number(value);
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
      if (error instanceof SodConflictError) {
        await reply.code(409).send({ error: 'sod_conflict', message: error.message });
        return;
      }
      if (error instanceof IdentityRuleError) {
        await reply.code(409).send({ error: 'rule', message: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : '';
      if (message.includes('cannot be disabled') || message.includes('Cannot deactivate')) {
        await reply.code(409).send({ error: 'module_locked', message });
        return;
      }
      if (message.includes('Cannot activate')) {
        await reply.code(409).send({ error: 'module_locked', message });
        return;
      }
      throw error;
    }
  };
}
