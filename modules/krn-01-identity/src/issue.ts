import { authChallenges, sessions, type TenantTransaction } from '@omnivate/kernel';
import { CHALLENGE_SECONDS, type RequestMeta } from './http';
import { sessionTtlSeconds } from './session';
import { hashToken, newToken } from './tokens';

export async function openSession(
  tx: TenantTransaction,
  userId: string,
  meta: RequestMeta,
): Promise<string> {
  const token = newToken();
  await tx.db.insert(sessions).values({
    tenantId: tx.tenantId,
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + sessionTtlSeconds() * 1000),
    requestIp: meta.requestIp,
    userAgent: meta.userAgent,
  });
  return token;
}

export async function openChallenge(
  tx: TenantTransaction,
  input: { userId: string; purpose: 'mfa_enroll' | 'mfa_verify'; totpSecret: string | null },
): Promise<string> {
  const token = newToken();
  await tx.db.insert(authChallenges).values({
    tenantId: tx.tenantId,
    userId: input.userId,
    purpose: input.purpose,
    tokenHash: hashToken(token),
    totpSecret: input.totpSecret,
    failedAttempts: 0,
    expiresAt: new Date(Date.now() + CHALLENGE_SECONDS * 1000),
  });
  return token;
}
