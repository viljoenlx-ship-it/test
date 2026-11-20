import { randomUUID } from 'node:crypto';
import { DEMO_PASSWORD, demoAccounts, demoTenants, platformOperator } from '@omnivate/shared';
import { closePools, getAdminPool, getAppPool, hashPassword, seed } from '@omnivate/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../apps/api/src/app';
import { generateTotp } from '../src/index';
import { OPERATOR_COOKIE } from '../src/http';

const aubergine = demoTenants[0];
const owner = demoAccounts.find((account) => account.email === 'owner@aubergine-atlas.example');
const cashier = demoAccounts.find((account) => account.email === 'cashier@aubergine-atlas.example');

function cookieValue(headers: unknown, name: string): string {
  const raw =
    headers && typeof headers === 'object' && 'set-cookie' in headers
      ? (headers as { 'set-cookie'?: string | string[] })['set-cookie']
      : undefined;
  const lines = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const line = lines.find((item) => item.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(';')[0] ?? '';
}

async function operatorCookie(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
  const login = await app.inject({
    method: 'POST',
    url: '/control/auth/login',
    payload: { email: platformOperator.email, password: DEMO_PASSWORD },
  });
  expect(login.statusCode).toBe(200);
  expect(login.json()).toMatchObject({ step: 'mfa_enroll' });
  expect(cookieValue(login.headers, OPERATOR_COOKIE)).toBe('');
  const pending = cookieValue(login.headers, 'omnivate_operator_pending');
  const setup = await app.inject({
    method: 'GET',
    url: '/control/auth/mfa/pending',
    cookies: { omnivate_operator_pending: pending },
  });
  const secret = setup.json().secret as string;
  const confirmed = await app.inject({
    method: 'POST',
    url: '/control/auth/mfa/confirm',
    cookies: { omnivate_operator_pending: pending },
    payload: { code: generateTotp(secret) },
  });
  expect(confirmed.statusCode).toBe(200);
  const token = cookieValue(confirmed.headers, OPERATOR_COOKIE);
  expect(token.length).toBeGreaterThan(20);
  return token;
}

describe('platform control panel', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = '';

  beforeAll(async () => {
    process.env.BRANDING_STORAGE_DIR = `/tmp/omnivate-branding-${randomUUID()}`;
    await seed();
    await getAdminPool().query(
      `UPDATE platform_operators SET totp_secret = NULL, totp_enabled = false WHERE email = $1`,
      [platformOperator.email],
    );
    await getAdminPool().query(`DELETE FROM platform_login_attempts WHERE email = $1`, [
      platformOperator.email,
    ]);
    await getAdminPool().query(
      `UPDATE tenants SET status = 'active', suspended_at = NULL, archived_at = NULL WHERE id = $1`,
      [aubergine.id],
    );
    app = await buildApp({ checkDatabase: async () => true });
    token = await operatorCookie(app);
  });

  afterAll(async () => {
    await getAdminPool().query(
      `UPDATE tenants SET status = 'active', suspended_at = NULL, archived_at = NULL WHERE id = $1`,
      [aubergine.id],
    );
    await app.close();
    await closePools();
  });

  it('keeps a tenant session out of the control panel and an operator out of the company', async () => {
    const signedIn = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: cashier?.email, password: DEMO_PASSWORD, tenantSlug: aubergine.slug },
    });
    expect(signedIn.statusCode).toBe(200);
    const tenantCookie = cookieValue(signedIn.headers, 'omnivate_session');
    const blocked = await app.inject({
      method: 'GET',
      url: '/control/tenants',
      cookies: { omnivate_session: tenantCookie },
    });
    expect(blocked.statusCode).toBe(401);

    const operatorOnCompany = await app.inject({
      method: 'GET',
      url: '/auth/session',
      cookies: { omnivate_operator: token },
    });
    expect(operatorOnCompany.statusCode).toBe(401);

    const operatorUsers = await app.inject({
      method: 'GET',
      url: '/krn/users',
      cookies: { omnivate_operator: token },
    });
    expect(operatorUsers.statusCode).toBe(401);
  });

  it('lists every company only through the operator search, not through the app role', async () => {
    const hidden = await getAppPool().query('SELECT count(*)::text AS count FROM tenants');
    expect(hidden.rows[0]?.count).toBe('0');
    await expect(getAppPool().query('SELECT email FROM platform_operators')).rejects.toThrow(
      /permission denied/i,
    );

    const listed = await app.inject({
      method: 'GET',
      url: '/control/tenants?status=all',
      cookies: { omnivate_operator: token },
    });
    expect(listed.statusCode).toBe(200);
    const names = (listed.json().tenants as { companyName: string }[]).map(
      (row) => row.companyName,
    );
    expect(names).toEqual(
      expect.arrayContaining([aubergine.displayName, demoTenants[1].displayName]),
    );

    const client = await getAppPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [aubergine.id]);
      const updated = await client.query(
        `UPDATE tenants SET display_name = 'should-not-stick' WHERE id = $1`,
        [demoTenants[1].id],
      );
      expect(updated.rowCount).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('writes an audit row for each operator change and blocks a suspended company', async () => {
    const slug = `north-wind-${randomUUID().slice(0, 8)}`;
    const created = await app.inject({
      method: 'POST',
      url: '/control/tenants',
      cookies: { omnivate_operator: token },
      payload: {
        companyName: 'North Wind Traders',
        slug,
        legalName: 'North Wind Traders (Pty) Ltd',
        tradingName: 'North Wind',
        registrationNumber: '2026/000001/07',
        vatNumber: '4000000000',
        contactEmail: 'hello@north-wind.example',
        contactPhone: '+27 21 000 0000',
        addressLine1: '1 Fictional Street',
        city: 'Cape Town',
        province: 'Western Cape',
        postalCode: '8001',
        country: 'ZA',
        industryPreset: 'retail_hardware',
      },
    });
    expect(created.statusCode).toBe(201);
    const companyId = created.json().id as string;

    const audit = await getAdminPool().query<{
      actor_kind: string;
      operator_id: string;
      actor_id: string | null;
      action: string;
    }>(
      `SELECT actor_kind, operator_id, actor_id, action
       FROM audit_events
       WHERE entity_id = $1 AND action = 'platform.tenant.created'`,
      [companyId],
    );
    expect(audit.rows[0]).toMatchObject({
      actor_kind: 'operator',
      operator_id: platformOperator.id,
      actor_id: null,
      action: 'platform.tenant.created',
    });

    const badVat = await app.inject({
      method: 'PUT',
      url: `/control/tenants/${companyId}/settings`,
      cookies: { omnivate_operator: token },
      payload: {
        currencyCode: 'ZAR',
        vatRateBasisPoints: 15000,
        timeZone: 'Africa/Johannesburg',
        financialYearStartMonth: 3,
      },
    });
    expect(badVat.statusCode).toBe(400);

    const settings = await app.inject({
      method: 'PUT',
      url: `/control/tenants/${companyId}/settings`,
      cookies: { omnivate_operator: token },
      payload: {
        currencyCode: 'zar',
        vatRateBasisPoints: 1500,
        timeZone: 'Africa/Johannesburg',
        financialYearStartMonth: 3,
      },
    });
    expect(settings.statusCode).toBe(200);

    const locked = await app.inject({
      method: 'POST',
      url: `/control/tenants/${companyId}/modules`,
      cookies: { omnivate_operator: token },
      payload: { moduleId: 'KRN-01', active: false, confirm: true },
    });
    expect(locked.statusCode).toBe(409);

    const preview = await app.inject({
      method: 'GET',
      url: `/control/tenants/${companyId}/modules/preview?moduleId=SAL-03&active=true`,
      cookies: { omnivate_operator: token },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().pulledIn).toEqual(expect.arrayContaining(['SCM-01', 'FIN-01']));

    const withoutConfirm = await app.inject({
      method: 'POST',
      url: `/control/tenants/${companyId}/modules`,
      cookies: { omnivate_operator: token },
      payload: { moduleId: 'SAL-03', active: true },
    });
    expect(withoutConfirm.statusCode).toBe(409);

    const activated = await app.inject({
      method: 'POST',
      url: `/control/tenants/${companyId}/modules`,
      cookies: { omnivate_operator: token },
      payload: { moduleId: 'SAL-03', active: true, confirm: true },
    });
    expect(activated.statusCode).toBe(200);

    const moduleAudit = await getAdminPool().query(
      `SELECT 1 FROM audit_events
       WHERE tenant_id = $1 AND action = 'identity.module.activated' AND actor_kind = 'operator'`,
      [companyId],
    );
    expect(moduleAudit.rowCount).toBeGreaterThan(0);

    const suspended = await app.inject({
      method: 'POST',
      url: `/control/tenants/${aubergine.id}/suspend`,
      cookies: { omnivate_operator: token },
      payload: {},
    });
    expect(suspended.statusCode).toBe(200);
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: owner?.email, password: DEMO_PASSWORD, tenantSlug: aubergine.slug },
    });
    expect(login.statusCode).toBe(403);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/control/tenants/${companyId}`,
      cookies: { omnivate_operator: token },
    });
    expect(removed.statusCode).toBe(404);

    const filtered = await app.inject({
      method: 'GET',
      url: `/control/audit?tenantId=${companyId}&action=platform.tenant.created`,
      cookies: { omnivate_operator: token },
    });
    expect(filtered.statusCode).toBe(200);
    expect((filtered.json().events as { action: string }[])[0]?.action).toBe(
      'platform.tenant.created',
    );

    await app.inject({
      method: 'POST',
      url: `/control/tenants/${aubergine.id}/reactivate`,
      cookies: { omnivate_operator: token },
      payload: {},
    });
  });

  it('saves a column layout, resets a password, and opens a read-only preview', async () => {
    const columns = await app.inject({
      method: 'PUT',
      url: `/control/tenants/${aubergine.id}/column-layouts`,
      cookies: { omnivate_operator: token },
      payload: { stock: ['name', 'code'], contacts: ['name', 'city'] },
    });
    expect(columns.statusCode).toBe(200);
    expect(columns.json().columnLayouts.stock).toEqual(['name', 'code']);

    const empty = await app.inject({
      method: 'PUT',
      url: `/control/tenants/${aubergine.id}/column-layouts`,
      cookies: { omnivate_operator: token },
      payload: { stock: [], contacts: ['name'] },
    });
    expect(empty.statusCode).toBe(400);

    const cashierId = cashier?.id;
    expect(cashierId).toBeTruthy();
    const reset = await app.inject({
      method: 'POST',
      url: `/control/tenants/${aubergine.id}/users/${cashierId}/password`,
      cookies: { omnivate_operator: token },
      payload: { password: 'replacement-demo-password' },
    });
    expect(reset.statusCode).toBe(200);
    const audit = await getAdminPool().query(
      `SELECT after_data FROM audit_events
       WHERE tenant_id = $1 AND action = 'platform.user.password_reset'
       ORDER BY occurred_at DESC LIMIT 1`,
      [aubergine.id],
    );
    expect(JSON.stringify(audit.rows[0]?.after_data)).not.toMatch(/replacement-demo-password/);
    const restored = await app.inject({
      method: 'POST',
      url: `/control/tenants/${aubergine.id}/users/${cashierId}/password`,
      cookies: { omnivate_operator: token },
      payload: { password: DEMO_PASSWORD },
    });
    expect(restored.statusCode).toBe(200);

    const opened = await app.inject({
      method: 'POST',
      url: `/control/tenants/${aubergine.id}/client-preview`,
      cookies: { omnivate_operator: token },
      payload: {},
    });
    expect(opened.statusCode).toBe(200);
    const previewUrl = opened.json().previewUrl as string;
    expect(previewUrl).toContain('/preview?ticket=');
    const ticket = new URL(previewUrl).searchParams.get('ticket') ?? '';
    const exchanged = await app.inject({
      method: 'POST',
      url: '/preview/exchange',
      payload: { ticket },
    });
    expect(exchanged.statusCode).toBe(200);
    expect(exchanged.json().companyName).toContain('Aubergine');
    expect(exchanged.json().columnLayouts.stock).toEqual(['name', 'code']);
    const previewCookie = cookieValue(exchanged.headers, 'omnivate_client_preview');
    const stock = await app.inject({
      method: 'GET',
      url: '/preview/stock',
      cookies: { omnivate_client_preview: previewCookie },
    });
    expect(stock.statusCode).toBe(200);
    expect(Array.isArray(stock.json().items)).toBe(true);
    const write = await app.inject({
      method: 'POST',
      url: '/preview/stock',
      cookies: { omnivate_client_preview: previewCookie },
      payload: {},
    });
    expect(write.statusCode).toBe(405);
    const again = await app.inject({
      method: 'POST',
      url: '/preview/exchange',
      payload: { ticket },
    });
    expect(again.statusCode).toBe(401);

    await app.inject({
      method: 'PUT',
      url: `/control/tenants/${aubergine.id}/column-layouts`,
      cookies: { omnivate_operator: token },
      payload: {
        stock: ['name', 'code', 'onHand', 'value', 'price'],
        contacts: ['name', 'roles', 'reach', 'city'],
      },
    });
  });

  it('stores a logo and removes it with an audit row', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const boundary = '----logotest';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="mark.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const uploaded = await app.inject({
      method: 'POST',
      url: `/control/tenants/${aubergine.id}/logo`,
      cookies: { omnivate_operator: token },
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json()).toMatchObject({ hasLogo: true });

    const anonymous = await app.inject({
      method: 'DELETE',
      url: `/control/tenants/${aubergine.id}/logo`,
    });
    expect(anonymous.statusCode).toBe(401);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/control/tenants/${aubergine.id}/logo`,
      cookies: { omnivate_operator: token },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ hasLogo: false });
    const audit = await getAdminPool().query(
      `SELECT after_data
       FROM audit_events
       WHERE action = 'platform.branding.logo' AND entity_id = $1
       ORDER BY occurred_at DESC
       LIMIT 1`,
      [aubergine.id],
    );
    expect(audit.rows[0]?.after_data).toMatchObject({ hasLogo: false });
  });

  it('refuses a support operator the suspend action', async () => {
    const supportId = randomUUID();
    const passwordHash = await hashPassword('support-demo-only');
    await getAdminPool().query(
      `INSERT INTO platform_operators (id, email, display_name, password_hash, status, totp_enabled)
       VALUES ($1, $2, 'Support Person', $3, 'active', false)`,
      [supportId, `support-${supportId.slice(0, 8)}@omnivate.example`, passwordHash],
    );
    await getAdminPool().query(
      `INSERT INTO platform_operator_roles (operator_id, role_id)
       VALUES ($1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2')`,
      [supportId],
    );
    const raw = `support-${randomUUID()}`;
    const { hashToken } = await import('../../krn-01-identity/src/tokens');
    await getAdminPool().query(
      `INSERT INTO platform_sessions (operator_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '10 minutes')`,
      [supportId, hashToken(raw)],
    );
    const denied = await app.inject({
      method: 'POST',
      url: `/control/tenants/${aubergine.id}/suspend`,
      cookies: { omnivate_operator: raw },
      payload: {},
    });
    expect(denied.statusCode).toBe(403);
  });

  it('shows build progress only to a signed-in operator', async () => {
    const hidden = await app.inject({ method: 'GET', url: '/control/progress' });
    expect(hidden.statusCode).toBe(401);

    const shown = await app.inject({
      method: 'GET',
      url: '/control/progress',
      cookies: { omnivate_operator: token },
    });
    expect(shown.statusCode).toBe(200);
    expect(shown.headers['cache-control']).toBe('no-store');
    const body = shown.json() as {
      github: string;
      counts: { done: number };
      items: { id: string }[];
    };
    expect(body.github === 'live' || body.github === 'unavailable').toBe(true);
    expect(body.counts.done).toBeGreaterThan(0);
    expect(body.items.some((item) => item.id === 'SCM-01')).toBe(true);
  });
});
