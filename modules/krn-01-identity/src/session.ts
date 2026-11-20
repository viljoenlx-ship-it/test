const DEFAULT_SESSION_SECONDS = 900;
const MIN_SESSION_SECONDS = 60;
const MAX_SESSION_SECONDS = 3600;

/** GOV-05 short-lived sessions. Default 15 minutes. Hard cap one hour. */
export function sessionTtlSeconds(): number {
  const raw = process.env.SESSION_TTL_SECONDS;
  if (!raw) {
    return DEFAULT_SESSION_SECONDS;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MIN_SESSION_SECONDS || parsed > MAX_SESSION_SECONDS) {
    throw new Error('SESSION_TTL_SECONDS must be an integer from 60 to 3600.');
  }
  return parsed;
}
