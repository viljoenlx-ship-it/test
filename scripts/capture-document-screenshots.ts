/**
 * Desktop and phone shots of Snap a Document.
 * Start the API and both Vite apps first (`pnpm dev`), then:
 *   pnpm exec tsx scripts/capture-document-screenshots.ts
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { generateTotp } from '../modules/platform-control/src/totp';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'docs/screenshots');
const client = process.env.CLIENT_ORIGIN ?? 'http://127.0.0.1:5173';

async function signIn(page: Page) {
  await page.context().clearCookies();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${client}/login`, { waitUntil: 'load' });
  await page.getByLabel('Email').fill('owner@aubergine-atlas.example');
  await page.getByLabel('Password').fill('local-demo-only');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/mfa/);
  const secret = (await page.locator('.ui-secret').textContent())?.replace(/\s/g, '') ?? '';
  if (!secret) {
    throw new Error('Sign-in did not show an authenticator secret.');
  }
  await page.getByLabel('6-digit code').fill(generateTotp(secret));
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.waitForURL(/\/users/);
}

async function invoicePng(page: Page): Promise<string> {
  const path = '/tmp/sample-silver-mango-invoice.png';
  await page.setContent(`<!doctype html>
    <html><body style="margin:0;font-family:Georgia,serif;background:#fff;color:#243044;">
    <div style="width:720px;padding:36px;">
      <p style="letter-spacing:.14em;font-size:12px;margin:0;">TAX INVOICE</p>
      <h1 style="margin:8px 0 0;font-size:28px;">Silver Mango Packaging (Pty) Ltd</h1>
      <p style="margin:4px 0 20px;">VAT 4991001002 · SM-1044 · 4 March 2026</p>
      <table style="width:100%;border-collapse:collapse;font-size:16px;">
        <tr><td style="padding:8px 0;border-bottom:1px solid #ddd;">Chipboard screw 4 x 50 mm</td><td>100 each</td><td align="right">R85.00</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #ddd;">Portland cement 42.5 N, 50 kg</td><td>4 bag</td><td align="right">R392.00</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #ddd;">Clear silicone sealant</td><td>6 tube</td><td align="right">R270.00</td></tr>
      </table>
      <p style="text-align:right;font-size:18px;">Subtotal R747.00<br>VAT 15% R112.05<br><strong>Total R859.05</strong></p>
      <p style="font-size:12px;color:#667;">Fictional supplier. Not a real tax invoice.</p>
    </div></body></html>`);
  await page.locator('div').first().screenshot({ path });
  return path;
}

async function shot(page: Page, name: string, width: number, height: number, fullPage = true) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(out, name), fullPage });
}

async function main(): Promise<void> {
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  const invoice = await invoicePng(page);
  await signIn(page);

  await page.goto(`${client}/stock`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'Stock' }).waitFor();
  await page.getByText('Snap A Document').first().waitFor();
  await shot(page, 'snap-document-stock-desktop.png', 1440, 900);
  await shot(page, 'snap-document-stock-phone.png', 390, 844);

  const input = page.getByLabel('Snap A Document').first();
  await input.setInputFiles(invoice);
  await page.waitForURL(/\/documents\/[0-9a-f-]{36}/i);
  await page.getByRole('button', { name: 'Receive Stock' }).waitFor({ timeout: 15000 });
  await page.getByText('All totals add up.').waitFor();
  await page.getByText('Silver Mango Packaging (Pty) Ltd').first().waitFor();
  await shot(page, 'snap-document-review-desktop.png', 1440, 900);
  await shot(page, 'snap-document-review-phone.png', 390, 844, false);

  await page.goto(`${client}/documents`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'Documents', exact: true }).waitFor();
  await page.getByText('SM-1044').first().waitFor();
  await shot(page, 'snap-document-list-desktop.png', 1440, 900);
  await shot(page, 'snap-document-list-phone.png', 390, 844);

  await browser.close();
}

await main();
