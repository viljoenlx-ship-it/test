import { createHash } from 'node:crypto';
import { lookupSession } from '@omnivate/kernel';
import { HttpError } from './http';

/** Same cookie and hash as KRN-01. The session row is the tenant. A header is ignored. */
const SESSION_COOKIE = 'omnivate_session';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function requireSession(request: { cookies: Record<string, string | undefined> }) {
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
  return session;
}
