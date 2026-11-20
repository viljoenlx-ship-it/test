import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { adminDatabaseUrl, appDatabaseUrl } from './env';
import { pgConnectionConfig } from './pg-config';
import { schema } from './schema';

// int8 comes back as a string by default. Parse it to bigint so cents never become floats.
pg.types.setTypeParser(20, (value) => BigInt(value));

export type Database = NodePgDatabase<typeof schema>;

let appPool: pg.Pool | undefined;
let adminPool: pg.Pool | undefined;

export function getAppPool(): pg.Pool {
  appPool ??= new pg.Pool({ ...pgConnectionConfig(appDatabaseUrl()), max: 10 });
  return appPool;
}

export function getAdminPool(): pg.Pool {
  adminPool ??= new pg.Pool({ ...pgConnectionConfig(adminDatabaseUrl()), max: 5 });
  return adminPool;
}

export function createAdminDatabase(): { pool: pg.Pool; db: Database } {
  const pool = new pg.Pool({ ...pgConnectionConfig(adminDatabaseUrl()), max: 1 });
  return { pool, db: drizzle(pool, { schema }) };
}

export async function closePools(): Promise<void> {
  await appPool?.end();
  await adminPool?.end();
  appPool = undefined;
  adminPool = undefined;
}
