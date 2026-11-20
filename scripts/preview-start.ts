/**
 * Render start command. Free web services cannot use preDeployCommand, so this
 * process creates omnivate_app, migrates, loads the fictional seed, and only
 * then listens. A failure here fails the deploy instead of serving a half-ready site.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  adminDatabaseUrl,
  assertConnectedAppRole,
  closePools,
  databaseUrlForAppRole,
  migrate,
  seed,
  waitForAdminDatabase,
} from '@omnivate/db';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown error';
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted-url]')
    .replace(/PASSWORD\s+'(?:''|[^'])*'/gi, "PASSWORD '[redacted]'");
}

async function main(): Promise<void> {
  const password = process.env.OMNIVATE_APP_PASSWORD;
  if (!password) {
    throw new Error('OMNIVATE_APP_PASSWORD is not set. Render should generate it.');
  }
  if (!process.env.DATABASE_ADMIN_URL) {
    throw new Error('DATABASE_ADMIN_URL is not set. It should be the Render database connection.');
  }

  process.env.DATABASE_URL = databaseUrlForAppRole(adminDatabaseUrl(), password);

  const external = process.env.RENDER_EXTERNAL_URL?.replace(/\/$/, '');
  if (!process.env.WEB_ORIGIN) {
    if (!external) {
      throw new Error('Set WEB_ORIGIN, or run this on Render so RENDER_EXTERNAL_URL is present.');
    }
    process.env.WEB_ORIGIN = external;
  }
  if (external) {
    process.env.COOKIE_SECURE = 'true';
  }

  process.env.STATIC_ROOT = resolve(repoRoot, 'apps/web/dist');
  process.env.CONTROL_ROOT = resolve(repoRoot, 'apps/control-panel/dist');

  await waitForAdminDatabase();
  await migrate();
  await seed();
  await assertConnectedAppRole();
  await closePools();

  await import('../apps/api/src/main');
}

main().catch((error: unknown) => {
  console.error(publicError(error));
  process.exit(1);
});
