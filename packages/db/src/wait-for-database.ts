import pg from 'pg';
import { adminDatabaseUrl } from './env';
import { pgConnectionConfig } from './pg-config';

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown error';
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted-url]')
    .replace(/PASSWORD\s+'(?:''|[^'])*'/gi, "PASSWORD '[redacted]'");
}

/** Render's database can still be starting when the first deploy runs the web service. */
export async function waitForAdminDatabase(timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = 'the database did not respond';
  while (Date.now() < deadline) {
    const client = new pg.Client(pgConnectionConfig(adminDatabaseUrl()));
    try {
      await client.connect();
      await client.query('SELECT 1');
      return;
    } catch (error) {
      last = publicError(error);
    } finally {
      await client.end().catch(() => undefined);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
  }
  throw new Error(`The preview database is not ready. ${last}`);
}
