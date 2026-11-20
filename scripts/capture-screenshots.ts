/**
 * Captures the light UI for docs/screenshots.
 * Uses the Chrome already on the machine. Does not download a Playwright browser.
 *
 * Start the API and both Vite apps first (`pnpm dev`), then:
 *   pnpm screenshots
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { generateTotp } from '../modules/platform-control/src/totp';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'docs/screenshots');
const client = process.env.CLIENT_ORIGIN ?? 'http://127.0.0.1:5173';
const control = process.env.CONTROL_ORIGIN ?? 'http://127.0.0.1:5174/control';

async function shot(page: Page, name: string, width: number, height: number, url: string) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(out, name), fullPage: true });
}

async function signInClient(page: Page, email: string) {
  await page.context().clearCookies();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${client}/login`, { waitUntil: 'load' });
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('local-demo-only');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/mfa/);
  const secret = (await page.locator('.ui-secret').textContent())?.replace(/\s/g, '') ?? '';
  await page.getByLabel('6-digit code').fill(generateTotp(secret));
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.waitForURL(/\/users/);
}

async function main(): Promise<void> {
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();

  await shot(page, 'login-after-desktop.png', 1440, 900, `${client}/login`);
  await shot(page, 'login-after-phone.png', 390, 844, `${client}/login`);
  await shot(page, 'home-desktop.png', 1440, 900, `${client}/`);
  await shot(page, 'home-phone.png', 390, 844, `${client}/`);
  await shot(page, 'users-signed-out-desktop.png', 1440, 900, `${client}/users`);
  await shot(page, 'control-login-desktop.png', 1440, 900, `${control}/login`);
  await shot(page, 'control-login-phone.png', 390, 844, `${control}/login`);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${client}/login`, { waitUntil: 'load' });
  await page.getByLabel('Email').fill('manager@aubergine-atlas.example');
  await page.getByLabel('Password').fill('local-demo-only');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/mfa/);
  await page
    .getByRole('img', { name: 'Authenticator setup code' })
    .waitFor({ timeout: 8000 })
    .catch(() => undefined);
  await page.screenshot({ path: resolve(out, 'mfa-enroll-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(out, 'mfa-enroll-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  const managerSecret =
    (
      await page
        .locator('.ui-secret')
        .textContent({ timeout: 4000 })
        .catch(() => '')
    )?.replace(/\s/g, '') ?? '';
  if (managerSecret) {
    await page.getByLabel('6-digit code').fill(generateTotp(managerSecret));
    await page.getByRole('button', { name: 'Confirm' }).click();
    await page.waitForURL(/\/users/);
    await page.getByText('Johan Pieters').waitFor();
    await page.screenshot({ path: resolve(out, 'users-desktop.png'), fullPage: true });
  }

  await page.goto(`${client}/contacts`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'Contacts' }).waitFor();
  await page.getByText('Cedar Kite Grocers (Pty) Ltd').waitFor();
  await page.screenshot({ path: resolve(out, 'contacts-list-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(out, 'contacts-list-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByText('Cedar Kite Grocers (Pty) Ltd').click();
  await page.getByRole('tab', { name: 'Overview' }).waitFor();
  await page.screenshot({ path: resolve(out, 'contacts-detail-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(out, 'contacts-detail-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${client}/contacts/new`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'New contact' }).waitFor();
  await page.screenshot({ path: resolve(out, 'contacts-new-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(out, 'contacts-new-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${client}/settings/fields`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'Custom fields' }).waitFor();
  await page.getByLabel('Site contact (required)').waitFor();
  await page.screenshot({ path: resolve(out, 'settings-fields-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(out, 'settings-fields-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${client}/settings/pipelines`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'Pipelines & alerts' }).waitFor();
  await page.getByRole('heading', { name: 'Job card' }).waitFor();
  await page.screenshot({ path: resolve(out, 'settings-pipelines-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(out, 'settings-pipelines-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
  const sidebar = await page.locator('.ui-sidebar').boundingBox();
  const viewport = page.viewportSize();
  if (!sidebar || !viewport || sidebar.height < viewport.height - 2) {
    throw new Error(
      `Sidebar is ${sidebar?.height ?? 0}px tall in a ${viewport?.height ?? 0}px viewport.`,
    );
  }
  await page.getByRole('button', { name: /Alerts/ }).click();
  await page.getByRole('heading', { name: 'Alerts' }).waitFor();
  await page.getByText('Sample job card is waiting').waitFor();
  await page.screenshot({ path: resolve(out, 'settings-alerts-desktop.png') });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /Alerts/ }).click();
  await page.getByRole('heading', { name: 'Alerts' }).waitFor();
  await page.screenshot({ path: resolve(out, 'settings-alerts-phone.png') });

  await signInClient(page, 'owner@aubergine-atlas.example');
  await page.goto(`${client}/branches`, { waitUntil: 'load' });
  await page.getByRole('heading', { level: 1, name: 'Branches' }).waitFor();
  await page.getByRole('button', { name: 'Allow more than one branch' }).waitFor();
  await page.getByText('Head Office').first().waitFor();
  await page.screenshot({ path: resolve(out, 'branches-single-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(out, 'branches-single-phone.png'), fullPage: true });

  await signInClient(page, 'owner@blue-crayon-foundry.example');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${client}/branches`, { waitUntil: 'load' });
  await page.getByRole('heading', { level: 1, name: 'Branches' }).waitFor();
  await page.getByLabel('Current branch').waitFor();
  await page.locator('td').filter({ hasText: 'Cape Town HQ' }).first().waitFor();
  await page.locator('td').filter({ hasText: 'Durban' }).first().waitFor();
  await page.screenshot({ path: resolve(out, 'branches-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(out, 'branches-phone.png'), fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${control}/login`, { waitUntil: 'load' });
  await page.getByLabel('Email').fill('operator@omnivate.example');
  await page.getByLabel('Password').fill('local-demo-only');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/mfa/);
  await page
    .getByRole('img', { name: 'Authenticator setup code' })
    .waitFor({ timeout: 8000 })
    .catch(() => undefined);
  await page.screenshot({ path: resolve(out, 'control-mfa-desktop.png'), fullPage: true });
  const secret =
    (
      await page
        .locator('.ui-secret')
        .textContent({ timeout: 4000 })
        .catch(() => '')
    )?.trim() ?? '';
  if (secret) {
    await page.getByLabel('6-digit code').fill(generateTotp(secret));
    await page.getByRole('button', { name: 'Confirm' }).click();
    await page.waitForURL(/\/control\/?$/);
    await page.getByText('Recent activity').waitFor();
    await page.getByText('Everything looks good').waitFor();
    await page.screenshot({ path: resolve(out, 'control-overview-desktop.png'), fullPage: true });
    await page.goto(`${control}/tenants`, { waitUntil: 'load' });
    await page.getByText('Aubergine Atlas Traders (Pty) Ltd').first().waitFor();
    await page.screenshot({ path: resolve(out, 'control-companies-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: resolve(out, 'control-companies-phone.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByText('Aubergine Atlas Traders (Pty) Ltd').first().click();
    await page.getByRole('tab', { name: 'Company' }).waitFor();
    await page.getByText('Custom fields and pipelines').waitFor();
    await page.screenshot({ path: resolve(out, 'control-company-desktop.png'), fullPage: true });
    await page.getByText('Custom fields and pipelines').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(out, 'control-workflows-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: resolve(out, 'control-workflows-phone.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${control}/tenants/22222222-2222-4222-8222-222222222222`, {
      waitUntil: 'load',
    });
    await page.getByRole('tab', { name: 'Branches' }).click();
    await page.locator('td').filter({ hasText: 'Cape Town HQ' }).first().waitFor();
    await page.getByRole('button', { name: 'Use Head Office only' }).waitFor();
    await page.screenshot({ path: resolve(out, 'control-branches-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: resolve(out, 'control-branches-phone.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('tab', { name: 'Billing' }).click();
    await page.getByText('Billing is coming soon').waitFor();
    await page.screenshot({ path: resolve(out, 'control-billing-desktop.png'), fullPage: true });
    await page.goto(`${control}/audit`, { waitUntil: 'load' });
    await page.getByRole('heading', { name: 'Activity' }).waitFor();
    await page.screenshot({ path: resolve(out, 'control-audit-desktop.png'), fullPage: true });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.context().clearCookies();
  await page.goto(`${client}/login`, { waitUntil: 'load' });
  await page.getByLabel('Email').fill('warehouse@aubergine-atlas.example');
  await page.getByLabel('Password').fill('local-demo-only');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/users/);
  await page.goto(`${client}/`, { waitUntil: 'load' });
  await page.getByText('Stock value').waitFor();
  await page.screenshot({ path: resolve(out, 'stock-home-desktop.png'), fullPage: true });
  await page.goto(`${client}/stock`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'Stock' }).waitFor();
  await page.getByText('Portland cement').waitFor();
  await page.screenshot({ path: resolve(out, 'stock-list-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(out, 'stock-list-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByText('Portland cement').click();
  await page.getByRole('heading', { name: 'Portland cement 42.5 N, 50 kg' }).waitFor();
  await page.screenshot({ path: resolve(out, 'stock-item-desktop.png'), fullPage: true });
  await page.goto(`${client}/stock/receive`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'Receive Stock' }).waitFor();
  await page.screenshot({ path: resolve(out, 'stock-receive-desktop.png'), fullPage: true });
  const grv = `${client}/stock/receipts/a8111111-1111-4111-8111-111111111001`;
  await page.goto(grv, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'GRV-1042' }).waitFor();
  await page.getByRole('button', { name: 'Print Labels' }).waitFor();
  await page.screenshot({ path: resolve(out, 'grv-detail-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(out, 'grv-detail-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Print Labels' }).click();
  await page.getByRole('heading', { name: 'Print Labels' }).waitFor();
  await page.getByRole('button', { name: 'Select All' }).waitFor();
  await page
    .locator('.label-frame')
    .screenshot({ path: resolve(out, 'grv-label-preview-desktop.png') });
  await page.screenshot({ path: resolve(out, 'grv-labels-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(out, 'grv-labels-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${client}/stock/receive`, { waitUntil: 'load' });
  await page.getByLabel('Scan a Barcode').fill('9900000001002');
  await page.getByLabel('Scan a Barcode').press('Enter');
  await page.getByText('Portland cement 42.5 N, 50 kg').waitFor();
  await page.screenshot({ path: resolve(out, 'grv-scan-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(out, 'grv-scan-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${client}/stock/low`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'Low stock' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(out, 'stock-low-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${client}/stock/value`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'Stock value' }).waitFor();
  await page.screenshot({ path: resolve(out, 'stock-value-desktop.png'), fullPage: true });
  await page.goto(`${client}/stock`, { waitUntil: 'load' });
  await page.getByText('Chipboard screw').click();
  await page.getByRole('button', { name: 'Print label' }).click();
  await page.getByRole('heading', { name: 'Print label' }).waitFor();
  await page.getByRole('button', { name: 'Print' }).waitFor();
  await page.screenshot({ path: resolve(out, 'stock-label-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(out, 'stock-label-phone.png'), fullPage: true });

  await browser.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
