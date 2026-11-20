import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const sqlPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../modules/krn-02-party-directory/seed/demo-parties.sql',
);

/** Loads the fictional KRN-02 contacts. The SQL file is safe to run more than once. */
export async function seedParties(pool: pg.Pool): Promise<void> {
  const sqlText = await readFile(sqlPath, 'utf8');
  await pool.query(sqlText);
}
