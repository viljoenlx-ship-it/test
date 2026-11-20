const DEFAULT_SESSION_SECONDS = 600;
const MIN_SESSION_SECONDS = 60;
const MAX_SESSION_SECONDS = 900;

/** Shorter than a tenant session. Default 10 minutes. Hard cap 15 minutes. */
export function operatorSessionTtlSeconds(): number {
  const raw = process.env.OPERATOR_SESSION_TTL_SECONDS;
  if (!raw) {
    return DEFAULT_SESSION_SECONDS;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MIN_SESSION_SECONDS || parsed > MAX_SESSION_SECONDS) {
    throw new Error('OPERATOR_SESSION_TTL_SECONDS must be an integer from 60 to 900.');
  }
  return parsed;
}
