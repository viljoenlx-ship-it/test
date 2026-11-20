import { describe, expect, it } from 'vitest';
import { assertApiDatabase, assertAppDatabaseUrl, databaseUrlForAppRole } from '@omnivate/db';

describe('application database login', () => {
  it('refuses a superuser connection string', () => {
    expect(() =>
      assertAppDatabaseUrl('postgres://postgres:postgres@localhost:5432/omnivate'),
    ).toThrow(/omnivate_app/);
  });

  it('accepts the application role', () => {
    expect(() =>
      assertAppDatabaseUrl(
        'postgres://omnivate_app:omnivate_local_dev_only@localhost:5432/omnivate',
      ),
    ).not.toThrow();
  });

  it('stops API startup when the configured URL is not the application role', () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/omnivate';
    try {
      expect(() => assertApiDatabase()).toThrow(/omnivate_app/);
    } finally {
      if (previous === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previous;
      }
    }
  });
});

describe('preview database URL', () => {
  it('builds an omnivate_app URL from the owner URL and a generated password', () => {
    const password = 'preview+demo/only=';
    const url = databaseUrlForAppRole(
      'postgresql://render_owner:ownerpass@dpg-abc-a/omnivate?sslmode=require',
      password,
    );
    const parsed = new URL(url);
    expect(parsed.protocol).toBe('postgresql:');
    expect(parsed.username).toBe('omnivate_app');
    expect(decodeURIComponent(parsed.password)).toBe(password);
    expect(parsed.hostname).toBe('dpg-abc-a');
    expect(parsed.pathname).toBe('/omnivate');
    expect(parsed.searchParams.get('sslmode')).toBe('require');
    expect(url).not.toContain('render_owner');
    expect(url).not.toContain('ownerpass');
  });

  it('refuses an empty password', () => {
    expect(() => databaseUrlForAppRole('postgresql://owner:secret@localhost/omnivate', '')).toThrow(
      /OMNIVATE_APP_PASSWORD/,
    );
  });
});
