import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { closePools, migrate, pgConnectionConfig, seed } from '@omnivate/db';

const databaseName = 'omnivate_preview_rolecheck';
const ownerRole = 'preview_owner';
const ownerPassword = 'preview_owner_local';

describe('migration owner without BYPASSRLS', () => {
  const savedAdmin = process.env.DATABASE_ADMIN_URL;
  const savedApp = process.env.DATABASE_URL;

  afterAll(async () => {
    if (savedAdmin === undefined) {
      delete process.env.DATABASE_ADMIN_URL;
    } else {
      process.env.DATABASE_ADMIN_URL = savedAdmin;
    }
    if (savedApp === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = savedApp;
    }
    await closePools();
    if (!savedAdmin) {
      return;
    }
    const admin = new pg.Client(pgConnectionConfig(savedAdmin));
    await admin.connect();
    try {
      await admin.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [databaseName],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
      await admin.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ownerRole}') THEN
            BEGIN
              EXECUTE 'REVOKE omnivate_app FROM ${ownerRole}';
            EXCEPTION
              WHEN undefined_object THEN NULL;
            END;
            EXECUTE 'DROP ROLE ${ownerRole}';
          END IF;
        END
        $$;
      `);
    } finally {
      await admin.end();
    }
  });

  it('keeps forced row-level security for omnivate_app while the owner can seed', async () => {
    if (!savedAdmin || !savedApp) {
      throw new Error('Database URLs are not set.');
    }
    const bootstrap = new pg.Client(pgConnectionConfig(savedAdmin));
    await bootstrap.connect();
    try {
      await bootstrap.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [databaseName],
      );
      await bootstrap.query(`DROP DATABASE IF EXISTS ${databaseName}`);
      await bootstrap.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ownerRole}') THEN
            BEGIN
              EXECUTE 'REVOKE omnivate_app FROM ${ownerRole}';
            EXCEPTION
              WHEN undefined_object THEN NULL;
            END;
            EXECUTE 'DROP ROLE ${ownerRole}';
          END IF;
        END
        $$;
      `);
      await bootstrap.query(
        `CREATE ROLE ${ownerRole} LOGIN PASSWORD '${ownerPassword}' NOSUPERUSER NOBYPASSRLS CREATEROLE NOCREATEDB`,
      );
      await bootstrap.query(`CREATE DATABASE ${databaseName} OWNER ${ownerRole}`);
      await bootstrap.query(
        `GRANT omnivate_app TO ${ownerRole} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
      );
    } finally {
      await bootstrap.end();
    }

    const ownerUrl = new URL(savedAdmin);
    ownerUrl.username = ownerRole;
    ownerUrl.password = ownerPassword;
    ownerUrl.pathname = `/${databaseName}`;
    const appUrl = new URL(savedApp);
    appUrl.pathname = `/${databaseName}`;

    await closePools();
    process.env.DATABASE_ADMIN_URL = ownerUrl.toString();
    process.env.DATABASE_URL = appUrl.toString();

    await migrate();
    await migrate();
    await seed();

    const owner = new pg.Client(pgConnectionConfig(ownerUrl.toString()));
    await owner.connect();
    try {
      const who = await owner.query<{ superuser: boolean; bypass: boolean }>(
        `SELECT rolsuper AS superuser, rolbypassrls AS bypass
         FROM pg_roles WHERE rolname = current_user`,
      );
      expect(who.rows[0]).toEqual({ superuser: false, bypass: false });

      const notes = await owner.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM foundation_notes',
      );
      expect(notes.rows[0]?.n).toBe(2);

      const coverage = await owner.query<{ policies: number; tables: number }>(`
        SELECT
          (SELECT count(*)::int FROM pg_policy WHERE polname = 'omnivate_migration_owner') AS policies,
          (SELECT count(*)::int
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity) AS tables
      `);
      expect(coverage.rows[0]?.policies).toBe(coverage.rows[0]?.tables);
      expect(coverage.rows[0]?.policies).toBeGreaterThan(0);

      const appliedToApp = await owner.query<{ n: number }>(`
        SELECT count(*)::int AS n
        FROM pg_policy AS pol
        JOIN pg_roles AS role ON role.oid = ANY (pol.polroles)
        WHERE pol.polname = 'omnivate_migration_owner'
          AND role.rolname = 'omnivate_app'
      `);
      expect(appliedToApp.rows[0]?.n).toBe(0);
    } finally {
      await owner.end();
    }

    const app = new pg.Client(pgConnectionConfig(appUrl.toString()));
    await app.connect();
    try {
      const hidden = await app.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM foundation_notes',
      );
      expect(hidden.rows[0]?.n).toBe(0);

      const tenant = await app.query<{ slug: string }>(
        `SELECT slug FROM krn_tenant_by_slug('aubergine-atlas')`,
      );
      expect(tenant.rows[0]?.slug).toBe('aubergine-atlas');

      const user = await app.query<{ email: string }>(
        `SELECT email FROM krn_user_by_email('owner@aubergine-atlas.example')`,
      );
      expect(user.rows[0]?.email).toBe('owner@aubergine-atlas.example');

      await expect(app.query(`SET ROLE ${ownerRole}`)).rejects.toThrow(/permission denied/i);
      await expect(
        app.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only'),
      ).rejects.toThrow(/permission denied|must be owner of table/i);

      const ownerName = await app.query<{ owner: string }>(
        `SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname = 'audit_events'`,
      );
      expect(ownerName.rows[0]?.owner).toBe(ownerRole);
    } finally {
      await app.end();
    }
  }, 120_000);
});
