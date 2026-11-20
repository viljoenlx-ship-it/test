/**
 * Loads each main company screen at phone widths and fails if the desk shell
 * is showing or the page scrolls sideways.
 *
 * Requires the web build (`pnpm --filter @omnivate/web build`), Postgres, and
 * Chrome or Playwright's Chromium.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { closePools, seed } from '@omnivate/db';
import { checkDatabase } from '@omnivate/kernel';
import { buildApp } from '../apps/api/src/app';

const root = resolve(import.meta.dirname, '..');
const staticRoot = resolve(root, 'apps/web/dist');
const shots = process.env.PHONE_SHOTS ? resolve(process.env.PHONE_SHOTS) : '';

const widths = [
  { width: 360, height: 780 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 430, height: 932 },
] as const;

const screens = [
  { name: 'home', path: '/' },
  { name: 'stock', path: '/stock' },
  { name: 'receive', path: '/stock/receive' },
  { name: 'adjust', path: '/stock/adjust' },
  { name: 'snap', path: '/scan' },
  { name: 'quotes', path: '/quotes' },
  { name: 'quote-editor', path: '/quotes/new' },
  { name: 'invoices', path: '/invoices' },
  { name: 'customers', path: '/customers' },
  { name: 'contacts', path: '/contacts' },
  { name: 'people', path: '/users' },
  { name: 'reports', path: '/reports' },
] as const;

function chromePath(): string | undefined {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
  ];
  return candidates.find((path) => path && existsSync(path));
}

async function measure(page: Page): Promise<{
  shell: string;
  phone: boolean;
  mobileBar: boolean;
  search: boolean;
  crumbs: boolean;
  overflow: number;
  past: number;
  offender: string;
}> {
  return page.evaluate(`(() => {
    const root = document.documentElement;
    let past = 0;
    let offender = '';
    for (const node of document.body.querySelectorAll('*')) {
      const box = node.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      if (box.right > past) {
        past = box.right;
        const label = (node.innerText || node.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').slice(0, 40);
        const parent = node.parentElement && node.parentElement.className ? String(node.parentElement.className) : '';
        offender = node.tagName + ' ' + label + ' / ' + parent;
      }
    }
    return {
      shell: root.dataset.shell || '',
      phone: document.querySelector('.ui-phone') !== null,
      mobileBar: [...document.querySelectorAll('.ui-mobile-bar')].some((node) => node.getBoundingClientRect().height > 2),
      search: [...document.querySelectorAll('.ui-search-bar')].some((node) => node.getBoundingClientRect().height > 2),
      crumbs: [...document.querySelectorAll('.ui-crumbs')].some((node) => node.getBoundingClientRect().height > 2),
      overflow: root.scrollWidth - root.clientWidth,
      past,
      offender,
    };
  })()`) as Promise<{
    shell: string;
    phone: boolean;
    mobileBar: boolean;
    search: boolean;
    crumbs: boolean;
    overflow: number;
    past: number;
    offender: string;
  }>;
}

function assertFit(
  label: string,
  width: number,
  metrics: Awaited<ReturnType<typeof measure>>,
  signedIn: boolean,
): void {
  const problems: string[] = [];
  if (metrics.shell !== 'phone') {
    problems.push(`shell is ${metrics.shell || 'unset'}`);
  }
  if (signedIn && !metrics.phone) {
    problems.push('desk frame is showing');
  }
  if (metrics.mobileBar) {
    problems.push('hamburger bar is showing');
  }
  if (metrics.search) {
    problems.push('Ctrl K search bar is showing');
  }
  if (signedIn && metrics.crumbs) {
    problems.push('breadcrumbs are showing');
  }
  if (metrics.overflow > 1) {
    problems.push(`page is ${metrics.overflow}px wider than the screen`);
  }
  if (metrics.past > width + 1) {
    problems.push(`content extends to ${Math.round(metrics.past)}px (${metrics.offender})`);
  }
  if (problems.length > 0) {
    throw new Error(`${label} at ${width}px: ${problems.join('; ')}`);
  }
}

async function signIn(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Sign In' }).waitFor();
  await page.getByLabel('Email').fill('owner@aubergine-atlas.example');
  await page.getByLabel('Password').fill('local-demo-only');
  await page.getByRole('button', { name: 'Sign In' }).click();
  const chooser = page.getByRole('combobox', { name: 'Company' });
  if (await chooser.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Sign In' }).click();
  }
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20_000 });
  if (page.url().includes('/mfa')) {
    throw new Error('Sign-in stopped on the authenticator. Set MFA_ENFORCEMENT=off.');
  }
}

async function main(): Promise<void> {
  if (!existsSync(staticRoot)) {
    throw new Error('Web build not found. Run pnpm --filter @omnivate/web build.');
  }
  process.env.MFA_ENFORCEMENT = 'off';
  process.env.COOKIE_SECURE = 'false';
  await seed();
  const app = await buildApp({
    checkDatabase,
    logger: false,
    staticRoot,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const origin = `http://127.0.0.1:${port}`;
  const executablePath = chromePath();
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  try {
    if (shots) {
      await mkdir(shots, { recursive: true });
    }
    for (const size of widths) {
      await page.setViewportSize(size);
      await page.context().clearCookies();
      await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Sign In' }).waitFor();
      const login = await measure(page);
      assertFit('sign-in', size.width, login, false);
      if (shots && size.width === 412) {
        await page.screenshot({ path: resolve(shots, 'after-sign-in-412.png') });
      }
    }

    await page.setViewportSize({ width: 412, height: 915 });
    await signIn(page, origin);

    for (const size of widths) {
      await page.setViewportSize(size);
      for (const screen of screens) {
        await page.goto(`${origin}${screen.path}`, { waitUntil: 'domcontentloaded' });
        await page.locator('.ui-phone').waitFor({ timeout: 15_000 });
        const metrics = await measure(page);
        assertFit(screen.name, size.width, metrics, true);
        if (shots && size.width === 412) {
          await page.screenshot({ path: resolve(shots, `after-${screen.name}-412.png`) });
        }
      }
      if (size.width === 412) {
        await page.goto(`${origin}/stock`, { waitUntil: 'domcontentloaded' });
        const row = page.locator('.ui-record-hit').first();
        await row.waitFor();
        await row.click();
        await page.locator('.ui-phone').waitFor();
        assertFit('stock-item', 412, await measure(page), true);
        if (shots) {
          await page.screenshot({ path: resolve(shots, 'after-stock-item-412.png') });
        }
        await page.goto(`${origin}/customers`, { waitUntil: 'domcontentloaded' });
        const customer = page.locator('.ui-record-hit').first();
        if (await customer.count()) {
          await customer.click();
          await page.locator('.ui-phone').waitFor();
          assertFit('customer', 412, await measure(page), true);
          if (shots) {
            await page.screenshot({ path: resolve(shots, 'after-customer-412.png') });
          }
        }
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await page.getByRole('heading', { name: 'More' }).waitFor();
        await page.waitForTimeout(250);
        assertFit('more', 412, await measure(page), true);
        if (shots) {
          await page.screenshot({ path: resolve(shots, 'after-more-412.png') });
        }
        await page.keyboard.press('Escape');
        await page.goto(`${origin}/users`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('heading', { name: 'Open This On A Computer' }).waitFor();
        if (await page.getByRole('button', { name: 'Invite' }).count()) {
          throw new Error('People setup is still on the phone.');
        }
      }
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${origin}/stock`, { waitUntil: 'domcontentloaded' });
    await page.locator('.ui-sidebar').waitFor();
    const desk = await measure(page);
    if (desk.phone || desk.shell === 'phone') {
      throw new Error('Desk width rendered the phone shell.');
    }
    if (shots) {
      await writeFile(resolve(shots, 'desktop-stock-ok.txt'), 'sidebar visible at 1280\n');
    }

    const handset = await browser.newContext({
      viewport: { width: 820, height: 900 },
      screen: { width: 412, height: 915 },
      hasTouch: true,
      isMobile: true,
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    });
    await handset.addCookies(await page.context().cookies());
    const handsetPage = await handset.newPage();
    await handsetPage.goto(`${origin}/users`, { waitUntil: 'domcontentloaded' });
    await handsetPage.locator('.ui-phone').waitFor({ timeout: 15_000 });
    const inflated = await measure(handsetPage);
    assertFit('inflated-layout', 820, inflated, true);
    if (await handsetPage.getByRole('heading', { name: 'Invite A Person' }).count()) {
      throw new Error('Inflated phone layout still shows Invite A Person on the page.');
    }
    await handsetPage.getByRole('heading', { name: 'Open This On A Computer' }).waitFor();
    await handset.close();
  } finally {
    await browser.close();
    await app.close();
    await closePools();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
