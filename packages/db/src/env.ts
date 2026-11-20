import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

function resolveRepoRoot(): string {
  try {
    if (import.meta.url.startsWith('file:')) {
      return fileURLToPath(new URL('../../../', import.meta.url));
    }
  } catch {
    // The web component tests run in happy-dom, which does not expose a file URL.
  }
  return process.cwd();
}

const repoRoot = resolveRepoRoot();

let loaded = false;

export function loadEnv(): void {
  if (loaded) {
    return;
  }
  loaded = true;
  const path = resolve(repoRoot, '.env');
  if (existsSync(path)) {
    config({ path });
  }
}

function required(name: string): string {
  loadEnv();
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and start PostgreSQL.`);
  }
  return value;
}

export function adminDatabaseUrl(): string {
  return required('DATABASE_ADMIN_URL');
}

export function assertAppDatabaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }

  if (parsed.username !== 'omnivate_app') {
    throw new Error(
      `DATABASE_URL must use the omnivate_app login so row-level security applies. Refusing "${parsed.username || '(none)'}".`,
    );
  }
}

export function appDatabaseUrl(): string {
  const url = required('DATABASE_URL');
  assertAppDatabaseUrl(url);
  return url;
}

/** Call this before the API listens. A superuser URL must stop the process, not merely fail a health check. */
export function assertApiDatabase(): void {
  appDatabaseUrl();
}

/**
 * Builds the API connection string from the migration login's URL and the
 * generated omnivate_app password. The host, database, and query string
 * (including sslmode) stay as they are. The username is always omnivate_app.
 */
export function databaseUrlForAppRole(adminUrl: string, password: string): string {
  if (!password) {
    throw new Error('OMNIVATE_APP_PASSWORD is empty.');
  }
  let parsed: URL;
  try {
    parsed = new URL(adminUrl);
  } catch {
    throw new Error('DATABASE_ADMIN_URL is not a valid URL.');
  }
  if (!parsed.hostname) {
    throw new Error('DATABASE_ADMIN_URL has no host.');
  }
  parsed.username = 'omnivate_app';
  parsed.password = password;
  const url = parsed.toString();
  assertAppDatabaseUrl(url);
  return url;
}
