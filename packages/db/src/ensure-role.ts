import pg from 'pg';
import { adminDatabaseUrl, appDatabaseUrl } from './env';
import { pgConnectionConfig } from './pg-config';

const APP_ROLE = 'omnivate_app';

/**
 * Attributes for CREATE ROLE / ALTER ROLE.
 * A non-superuser is not allowed to mention SUPERUSER, REPLICATION, or BYPASSRLS,
 * even to turn them off. Those stay at PostgreSQL's defaults (all off) and the
 * caller checks the result. The password literal must come from quote_literal.
 */
export function appRoleAttributeClause(
  actor: { superuser: boolean; createdb: boolean },
  quotedPassword: string,
): string {
  // A non-superuser may not mention CREATEDB unless they have CREATEDB themselves,
  // even to turn it off. The default is already NOCREATEDB. The caller checks the result.
  const parts = [`LOGIN PASSWORD ${quotedPassword}`, 'NOCREATEROLE', 'NOINHERIT'];
  if (actor.superuser || actor.createdb) {
    parts.push('NOCREATEDB');
  }
  if (actor.superuser) {
    parts.push('NOSUPERUSER', 'NOREPLICATION', 'NOBYPASSRLS');
  }
  return parts.join(' ');
}

/** Creates the non-superuser login the API uses. CREATE ROLE cannot run inside a transaction. */
export async function ensureAppRole(): Promise<void> {
  const client = new pg.Client(pgConnectionConfig(adminDatabaseUrl()));
  await client.connect();
  try {
    const password = decodeURIComponent(new URL(appDatabaseUrl()).password);
    if (!password) {
      throw new Error('The omnivate_app password is empty.');
    }

    const actor = await client.query<{
      superuser: boolean;
      createrole: boolean;
      createdb: boolean;
    }>(
      `SELECT rolsuper AS superuser, rolcreaterole AS createrole, rolcreatedb AS createdb
       FROM pg_roles
       WHERE rolname = current_user`,
    );
    const actorRow = actor.rows[0];
    if (!actorRow) {
      throw new Error('PostgreSQL did not return the migration login.');
    }
    if (!actorRow.superuser && !actorRow.createrole) {
      throw new Error(
        'The migration login cannot create roles. On Render that login is the database owner. It is not a superuser and cannot grant BYPASSRLS, but it must be allowed to create omnivate_app.',
      );
    }

    const quoted = await client.query<{ literal: string }>(
      'SELECT quote_literal($1::text) AS literal',
      [password],
    );
    const literal = quoted.rows[0]?.literal;
    if (!literal?.startsWith("'")) {
      throw new Error('Could not quote the omnivate_app password.');
    }

    const attributes = appRoleAttributeClause(
      { superuser: actorRow.superuser, createdb: actorRow.createdb },
      literal,
    );
    const existing = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_ROLE]);
    if ((existing.rowCount ?? 0) === 0) {
      await client.query(`CREATE ROLE ${APP_ROLE} ${attributes}`);
    } else {
      await client.query(`ALTER ROLE ${APP_ROLE} WITH ${attributes}`);
    }

    const created = await client.query<{
      superuser: boolean;
      bypass: boolean;
      createdb: boolean;
      createrole: boolean;
      inherit: boolean;
      login: boolean;
      replication: boolean;
    }>(
      `SELECT rolsuper AS superuser,
              rolbypassrls AS bypass,
              rolcreatedb AS createdb,
              rolcreaterole AS createrole,
              rolinherit AS inherit,
              rolcanlogin AS login,
              rolreplication AS replication
       FROM pg_roles
       WHERE rolname = $1`,
      [APP_ROLE],
    );
    const role = created.rows[0];
    if (
      !role?.login ||
      role.superuser ||
      role.bypass ||
      role.createdb ||
      role.createrole ||
      role.inherit ||
      role.replication
    ) {
      throw new Error(
        'omnivate_app must be a login that is not a superuser, does not bypass row-level security, and cannot create databases or roles.',
      );
    }
  } finally {
    await client.end();
  }
}
