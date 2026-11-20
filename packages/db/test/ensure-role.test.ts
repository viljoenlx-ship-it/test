import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { closePools, pgConnectionConfig } from '@omnivate/db';
import { appRoleAttributeClause } from '../src/ensure-role';

describe('application role attributes', () => {
  it('lets a non-superuser omit the clauses only a superuser may say', () => {
    const clause = appRoleAttributeClause(
      { superuser: false, createdb: false },
      "'generated+password/test='",
    );
    expect(clause).toContain("LOGIN PASSWORD 'generated+password/test='");
    expect(clause).toContain('NOCREATEROLE');
    expect(clause).toContain('NOINHERIT');
    expect(clause).not.toMatch(/CREATEDB|SUPERUSER|BYPASSRLS|REPLICATION/);
  });

  it('states the locked-down attributes when the actor is a superuser', () => {
    const clause = appRoleAttributeClause({ superuser: true, createdb: true }, "'local'");
    expect(clause).toContain('NOSUPERUSER');
    expect(clause).toContain('NOBYPASSRLS');
    expect(clause).toContain('NOREPLICATION');
    expect(clause).toContain('NOCREATEDB');
  });
});

describe('quote_literal passwords', () => {
  const role = 'password_probe';

  async function dropProbe(admin: pg.Client, adminUrl: string): Promise<void> {
    const database = new URL(adminUrl).pathname.replace(/^\//, '');
    await admin.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          EXECUTE 'REVOKE ALL ON DATABASE ${database} FROM ${role}';
          EXECUTE 'DROP ROLE ${role}';
        END IF;
      END
      $$;
    `);
  }

  afterAll(async () => {
    const adminUrl = process.env.DATABASE_ADMIN_URL;
    if (!adminUrl) {
      return;
    }
    const admin = new pg.Client(pgConnectionConfig(adminUrl));
    await admin.connect();
    try {
      await dropProbe(admin, adminUrl);
    } finally {
      await admin.end();
      await closePools();
    }
  });

  it('accepts a Render-style password that is not only letters and digits', async () => {
    const password = "unit+test/password='quoted'";
    const adminUrl = process.env.DATABASE_ADMIN_URL;
    if (!adminUrl) {
      throw new Error('DATABASE_ADMIN_URL is not set.');
    }
    const admin = new pg.Client(pgConnectionConfig(adminUrl));
    await admin.connect();
    try {
      await dropProbe(admin, adminUrl);
      const quoted = await admin.query<{ literal: string }>(
        'SELECT quote_literal($1::text) AS literal',
        [password],
      );
      const literal = quoted.rows[0]?.literal;
      if (!literal) {
        throw new Error('quote_literal returned nothing.');
      }
      await admin.query(
        `CREATE ROLE ${role} ${appRoleAttributeClause({ superuser: true, createdb: true }, literal)}`,
      );
      const database = new URL(adminUrl).pathname.replace(/^\//, '');
      await admin.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
    } finally {
      await admin.end();
    }

    const url = new URL(adminUrl);
    url.username = role;
    url.password = password;
    const client = new pg.Client(pgConnectionConfig(url.toString()));
    await client.connect();
    try {
      const who = await client.query<{ user: string }>('SELECT current_user AS "user"');
      expect(who.rows[0]?.user).toBe(role);
    } finally {
      await client.end();
    }
  });
});
