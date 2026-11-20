/**
 * Screenshots of the import flow. Start the API and both Vite apps first.
 * Uses the Chrome already on the machine.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { generateTotp } from '../modules/platform-control/src/totp';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'docs/screenshots');
const client = process.env.CLIENT_ORIGIN ?? 'http://127.0.0.1:5173';
const control = process.env.CONTROL_ORIGIN ?? 'http://127.0.0.1:5174/control';

const sample = [
  'Name,Email,VAT number',
  'Fictional Import Co,import-demo@example.com,4123456789',
  'Thabo Mokoena,thabo-import@example.com,123',
].join('\n');

async function signIn(page: Page, origin: string, email: string): Promise<void> {
  await page.goto(`${origin}/login`, { waitUntil: 'load' });
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('local-demo-only');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/mfa/);
  const secret = (await page.locator('.ui-secret').textContent())?.replace(/\s/g, '') ?? '';
  if (!secret) {
    throw new Error(`No authenticator secret shown for ${email}. Reset TOTP and try again.`);
  }
  await page.getByLabel('6-digit code').fill(generateTotp(secret));
  await page.getByRole('button', { name: 'Confirm' }).click();
}

async function shot(page: Page, name: string, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(out, name), fullPage: true });
}

async function main(): Promise<void> {
  await mkdir(out, { recursive: true });
  const csv = '/tmp/fictional-contacts.csv';
  await writeFile(csv, `${sample}\n`);
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();

  await signIn(page, client, 'owner@aubergine-atlas.example');
  await page.waitForURL((url) => !url.pathname.endsWith('/mfa'));
  await page.goto(`${client}/import`, { waitUntil: 'load' });
  await page.getByRole('button', { name: /Customers and suppliers/ }).waitFor();
  await shot(page, 'import-choose-desktop.png', 1440, 900);
  await shot(page, 'import-choose-phone.png', 390, 844);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: /Customers and suppliers/ }).click();
  await page.getByText('Download Excel template').waitFor();
  await shot(page, 'import-file-desktop.png', 1440, 900);
  await shot(page, 'import-file-phone.png', 390, 844);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel('Your file').setInputFiles(csv);
  await page.getByRole('button', { name: 'Read the file' }).click();
  await page.getByRole('button', { name: 'Check the rows' }).waitFor();
  await shot(page, 'import-columns-desktop.png', 1440, 900);
  await shot(page, 'import-columns-phone.png', 390, 844);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Check the rows' }).click();
  await page.getByText('Row 3: VAT number should be 10 digits.').waitFor();
  await shot(page, 'import-preview-desktop.png', 1440, 900);
  await shot(page, 'import-preview-phone.png', 390, 844);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: /Import 1 row/ }).click();
  await page.getByRole('button', { name: 'Download error report' }).waitFor();
  await shot(page, 'import-done-desktop.png', 1440, 900);
  await shot(page, 'import-done-phone.png', 390, 844);

  await signIn(page, control, 'operator@omnivate.example');
  await page.waitForURL(/\/control\/?$/);
  await page.goto(`${control}/tenants`, { waitUntil: 'load' });
  await page.getByText('Aubergine Atlas Traders (Pty) Ltd').first().click();
  await page.getByRole('button', { name: 'Import data' }).waitFor();
  await shot(page, 'control-import-action-desktop.png', 1440, 900);
  await page.getByRole('button', { name: 'Import data' }).click();
  await page.getByRole('button', { name: /Customers and suppliers/ }).waitFor();
  await shot(page, 'control-import-desktop.png', 1440, 900);
  await shot(page, 'control-import-phone.png', 390, 844);

  await browser.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
