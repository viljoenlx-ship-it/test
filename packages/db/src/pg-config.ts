import type pg from 'pg';

/**
 * Pass the URL through unchanged once it parses.
 * Render's internal URL (what the blueprint injects) is on the private network
 * and does not use TLS. An external URL includes sslmode=require, and
 * node-postgres follows that. Forcing TLS here would break the internal URL.
 */
export function pgConnectionConfig(connectionString: string): pg.ClientConfig {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('A database URL is not valid.');
  }
  if (!url.hostname) {
    throw new Error('A database URL has no host.');
  }
  return { connectionString };
}
