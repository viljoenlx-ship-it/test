/**
 * Screenshots of the calculated-field editor and the automation builder.
 * Start the API and the control panel first, then:
 *   CHROME_PATH=/usr/local/bin/google-chrome pnpm exec tsx scripts/capture-formula-screenshots.ts
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { generateTotp } from '../modules/platform-control/src/totp';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'docs/screenshots');
const control = process.env.CONTROL_ORIGIN ?? 'http://127.0.0.1:5174/control';
const tenant = '11111111-1111-4111-8111-111111111111';

async function signIn(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${control}/login`, { waitUntil: 'load' });
  await page.getByLabel('Email').fill('operator@omnivate.example');
  await page.getByLabel('Password').fill('local-demo-only');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/mfa/);
  const secret = (await page.locator('.ui-secret').textContent())?.replace(/\s/g, '') ?? '';
  if (!secret) {
    throw new Error('The operator authenticator secret was not on the page.');
  }
  await page.getByLabel('6-digit code').fill(generateTotp(secret));
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.waitForURL(/\/control\/?$/);
}

async function shot(page: Page, name: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.evaluate('window.scrollTo(0, 0)');
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(out, name), fullPage: true });
}

async function main(): Promise<void> {
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/usr/local/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await signIn(page);
  await page.goto(`${control}/tenants/${tenant}`, { waitUntil: 'load' });
  await page.getByRole('tab', { name: 'Custom Fields' }).click();
  await page.getByRole('heading', { name: 'Line Total' }).waitFor();
  await page.getByText('Line Total = Quantity × Price').waitFor();
  await shot(page, 'formula-editor-desktop.png', 1440, 900);
  await shot(page, 'formula-editor-phone.png', 390, 844);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('tab', { name: 'Automations' }).click();
  await page.getByRole('heading', { name: 'Reorder Alert' }).waitFor();
  await page.getByRole('heading', { name: 'Last 20 Runs' }).waitFor();
  await shot(page, 'automation-builder-desktop.png', 1440, 900);
  await shot(page, 'automation-builder-phone.png', 390, 844);
  await browser.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
