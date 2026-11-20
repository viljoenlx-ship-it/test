import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { adminDatabaseUrl } from './env';
import { ensureAppRole } from './ensure-role';
import { ensureMigrationOwnerPolicies } from './migration-owner';
import { pgConnectionConfig } from './pg-config';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(packageRoot, '../migrations');
const modulesDir = join(packageRoot, '../../../modules');

export async function migrate(): Promise<void> {
  await ensureAppRole();

  const client = new pg.Client(pgConnectionConfig(adminDatabaseUrl()));
  await client.connect();
  try {
    await assertMigrationRole(client);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = await listMigrations();
    for (const file of files) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [
        file.version,
      ]);
      if ((applied.rowCount ?? 0) > 0) {
        continue;
      }

      const sqlText = await readFile(file.path, 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sqlText);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file.version]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    await ensureMigrationOwnerPolicies(client);
  } finally {
    await client.end();
  }
}

/**
 * Local Docker and CI use the postgres superuser, which bypasses row-level security.
 * Render's user is not a superuser and cannot be given BYPASSRLS. That user does own
 * the database, which is enough to apply DDL. Cross-tenant reads then go through
 * ensureMigrationOwnerPolicies rather than through a bypass attribute.
 */
async function assertMigrationRole(client: pg.Client): Promise<void> {
  const result = await client.query<{
    user: string;
    superuser: boolean;
    bypass: boolean;
    ownsDatabase: boolean;
  }>(`
    SELECT
      current_user AS "user",
      r.rolsuper AS superuser,
      r.rolbypassrls AS bypass,
      d.datdba = r.oid AS "ownsDatabase"
    FROM pg_roles AS r
    JOIN pg_database AS d ON d.datname = current_database()
    WHERE r.rolname = current_user
  `);
  const row = result.rows[0];
  if (!row) {
    throw new Error('PostgreSQL did not return the migration login.');
  }
  if (row.user === 'omnivate_app') {
    throw new Error(
      'DATABASE_ADMIN_URL must not be omnivate_app. Migrations use the database owner. The API uses omnivate_app.',
    );
  }
  if (!row.superuser && !row.bypass && !row.ownsDatabase) {
    throw new Error(
      'DATABASE_ADMIN_URL must be a superuser, a BYPASSRLS role, or the owner of this database.',
    );
  }
}

type MigrationFile = { version: string; path: string };

/** Foundation migrations plus one folder per module, ordered by file name. */
async function listMigrations(): Promise<MigrationFile[]> {
  const found: MigrationFile[] = [];
  const packageFiles = await readdir(migrationsDir);
  for (const file of packageFiles) {
    if (file.endsWith('.sql')) {
      found.push({ version: file, path: join(migrationsDir, file) });
    }
  }

  const moduleNames = await readdir(modulesDir);
  for (const moduleName of moduleNames) {
    const modulePath = join(modulesDir, moduleName);
    if (!(await stat(modulePath)).isDirectory()) {
      continue;
    }
    const dir = join(modulePath, 'migrations');
    let files: string[];
    try {
      files = await readdir(dir);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        continue;
      }
      throw error;
    }
    for (const file of files) {
      if (file.endsWith('.sql')) {
        found.push({ version: file, path: join(dir, file) });
      }
    }
  }

  found.sort((left, right) => left.version.localeCompare(right.version));
  const seen = new Set<string>();
  for (const file of found) {
    if (seen.has(file.version)) {
      throw new Error(`Two migrations are named ${file.version}.`);
    }
    seen.add(file.version);
  }
  return found;
}
