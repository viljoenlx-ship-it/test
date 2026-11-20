import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { checkDatabase, closePools } from '@omnivate/kernel';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

async function withServer(
  staticRoot: string,
  database: () => Promise<boolean>,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const app = await buildApp({
    checkDatabase: database,
    corsOrigin: 'https://omnivate-preview.onrender.com',
    staticRoot,
  });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  try {
    await run(address);
  } finally {
    await app.close();
  }
}

describe('one process serves the web app and the API', () => {
  afterAll(async () => {
    await closePools();
  });

  it('serves pages, assets, and /api/health from the same server', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnivate-web-'));
    await mkdir(join(root, 'assets'));
    await writeFile(
      join(root, 'index.html'),
      '<!doctype html><title>Omnivate</title><div id="root"></div>',
    );
    await writeFile(join(root, 'assets', 'app.js'), 'window.omnivateFixture = true;\n');

    await withServer(
      root,
      async () => true,
      async (base) => {
        const home = await fetch(`${base}/`);
        expect(home.status).toBe(200);
        expect(home.headers.get('content-type')).toMatch(/html/);
        expect(await home.text()).toContain('id="root"');

        const login = await fetch(`${base}/login`);
        expect(login.status).toBe(200);
        expect(await login.text()).toContain('id="root"');

        const asset = await fetch(`${base}/assets/app.js`);
        expect(asset.status).toBe(200);
        expect(await asset.text()).toContain('omnivateFixture');

        const health = await fetch(`${base}/api/health`);
        expect(health.status).toBe(200);
        expect(await health.json()).toMatchObject({ status: 'ok', service: 'omnivate-api' });

        const missingApi = await fetch(`${base}/api/missing`);
        expect(missingApi.status).toBe(404);
        expect(missingApi.headers.get('content-type')).toMatch(/json/);

        const missingAsset = await fetch(`${base}/assets/missing.js`);
        expect(missingAsset.status).toBe(404);
        expect(missingAsset.headers.get('content-type')).toMatch(/json/);
      },
    );
  });

  it('serves the production Vite build and a live health check', async () => {
    const indexPath = resolve('apps/web/dist/index.html');
    if (!existsSync(indexPath)) {
      if (process.env.CI) {
        throw new Error(
          'CI must run pnpm build before tests so the preview server uses the real web build.',
        );
      }
      return;
    }

    await withServer(resolve('apps/web/dist'), checkDatabase, async (base) => {
      const home = await fetch(`${base}/`);
      expect(home.status).toBe(200);
      const html = await home.text();
      expect(html).toContain('<title>Omnivate</title>');
      expect(html).toContain('id="root"');
      const script = html.match(/src="(\/assets\/[^"]+\.js)"/);
      expect(script?.[1]).toBeTruthy();

      const asset = await fetch(`${base}${script?.[1]}`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get('content-type')).toMatch(/javascript/);

      const login = await fetch(`${base}/login`);
      expect(login.status).toBe(200);
      expect(await login.text()).toContain('id="root"');

      const health = await fetch(`${base}/api/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({
        status: 'ok',
        service: 'omnivate-api',
        database: 'up',
      });
    });
  });
});
