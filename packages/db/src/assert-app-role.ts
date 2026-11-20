import pg from 'pg';
import { appDatabaseUrl } from './env';
import { pgConnectionConfig } from './pg-config';

/**
 * Live check used before the preview process listens.
 * The URL check refuses any login name other than omnivate_app.
 * This one refuses a role that was given superuser, BYPASSRLS, or table ownership.
 */
export async function assertConnectedAppRole(): Promise<void> {
  const client = new pg.Client(pgConnectionConfig(appDatabaseUrl()));
  await client.connect();
  try {
    const result = await client.query<{
      user: string;
      superuser: boolean;
      bypass: boolean;
      owner: string | null;
    }>(`
      SELECT
        current_user AS "user",
        rolsuper AS superuser,
        rolbypassrls AS bypass,
        (
          SELECT pg_get_userbyid(relowner)
          FROM pg_class
          WHERE relname = 'audit_events'
        ) AS owner
      FROM pg_roles
      WHERE rolname = current_user
    `);
    const row = result.rows[0];
    if (!row?.owner) {
      throw new Error('audit_events is missing, so migrations did not finish.');
    }
    if (
      row.user !== 'omnivate_app' ||
      row.superuser ||
      row.bypass ||
      row.owner === 'omnivate_app'
    ) {
      throw new Error(
        'Refusing to start. The API must connect as omnivate_app, that role must not bypass row-level security, and it must not own the tables.',
      );
    }
  } finally {
    await client.end();
  }
}
