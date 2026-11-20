import { randomUUID } from 'node:crypto';
import { DEMO_PASSWORD, demoAccounts, demoTenants } from '@omnivate/shared';
import { closePools, getAdminPool, seed } from '@omnivate/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../apps/api/src/app';
import { generateTotp, hashToken, newToken } from '../src/index';

const aubergine = demoTenants[0];
const crayon = demoTenants[1];
const cashier = demoAccounts.find((account) => account.email === 'cashier@aubergine-atlas.example');
const owner = demoAccounts.find((account) => account.email === 'owner@aubergine-atlas.example');
const accountant = demoAccounts.find(
  (account) => account.email === 'accountant@aubergine-atlas.example',
);
const manager = demoAccounts.find((account) => account.email === 'manager@aubergine-atlas.example');
const hr = demoAccounts.find((account) => account.email === 'hr@aubergine-atlas.example');

function setCookies(headers: unknown): string[] {
  if (!headers || typeof headers !== 'object' || !('set-cookie' in headers)) {
    return [];
  }
  const raw = (headers as { 'set-cookie'?: unknown })['set-cookie'];
  if (typeof raw === 'string') {
    return [raw];
  }
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

function cookieValue(headers: unknown, name: string): string {
  const line = setCookies(headers).find((item) => item.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(';')[0] ?? '';
}

describe('KRN-01 sign-in over HTTP', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    if (!cashier || !owner || !accountant || !manager || !hr) {
      throw new Error('Demo accounts missing.');
    }
    await seed();
    await getAdminPool().query(
      `UPDATE users SET totp_secret = NULL, totp_enabled = false
       WHERE email = ANY($1::text[])`,
      [[owner.email, accountant.email, manager.email, hr.email, cashier.email]],
    );
    await getAdminPool().query(`DELETE FROM login_attempts WHERE email = ANY($1::text[])`, [
      [
        owner.email,
        accountant.email,
        manager.email,
        hr.email,
        cashier.email,
        'lock@aubergine-atlas.example',
      ],
    ]);
    app = await buildApp({ checkDatabase: async () => true });
  });

  afterAll(async () => {
    await app.close();
    await closePools();
  });

  it('gives a cashier a short httpOnly session and writes the audit actor', async () => {
    const denied = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: cashier?.email,
        password: 'not-the-password',
        tenantSlug: aubergine.slug,
      },
    });
    expect(denied.statusCode).toBe(401);

    const audit = await getAdminPool().query<{ actor_id: string; after_data: { reason: string } }>(
      `SELECT actor_id, after_data
       FROM audit_events
       WHERE action = 'auth.login.failed' AND actor_id = $1
       ORDER BY occurred_at DESC
       LIMIT 1`,
      [cashier?.id],
    );
    expect(audit.rows[0]?.actor_id).toBe(cashier?.id);
    expect(audit.rows[0]?.after_data.reason).toBe('bad_password');

    const signedIn = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: cashier?.email,
        password: DEMO_PASSWORD,
        tenantSlug: aubergine.slug,
      },
    });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json()).toMatchObject({ step: 'session', tenant: { slug: aubergine.slug } });
    const sessionLine = setCookies(signedIn.headers).find((item) =>
      item.startsWith('omnivate_session='),
    );
    expect(sessionLine).toMatch(/HttpOnly/i);
    expect(sessionLine).toMatch(/SameSite=Lax/i);
    const token = cookieValue(signedIn.headers, 'omnivate_session');
    expect(token.length).toBeGreaterThan(20);

    const users = await app.inject({
      method: 'GET',
      url: '/krn/users',
      headers: { cookie: `omnivate_session=${token}`, 'x-tenant-id': crayon.id },
    });
    expect(users.statusCode).toBe(403);

    const expired = newToken();
    await getAdminPool().query(
      `INSERT INTO sessions (tenant_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() - interval '1 minute')`,
      [aubergine.id, cashier?.id, hashToken(expired)],
    );
    const stale = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: `omnivate_session=${expired}` },
    });
    expect(stale.statusCode).toBe(401);

    const loggedOut = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: `omnivate_session=${token}` },
    });
    expect(loggedOut.statusCode).toBe(200);
    const again = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: `omnivate_session=${token}` },
    });
    expect(again.statusCode).toBe(401);
  });

  it('requires MFA before an owner, manager, accountant, or HR person receives a session', async () => {
    for (const person of [manager, hr]) {
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: person?.email,
          password: DEMO_PASSWORD,
          tenantSlug: aubergine.slug,
        },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json()).toMatchObject({ step: 'mfa_enroll' });
      expect(cookieValue(login.headers, 'omnivate_session')).toBe('');
    }

    const accountantLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: accountant?.email,
        password: DEMO_PASSWORD,
        tenantSlug: aubergine.slug,
      },
    });
    expect(accountantLogin.statusCode).toBe(200);
    expect(accountantLogin.json()).toMatchObject({ step: 'mfa_enroll' });
    expect(cookieValue(accountantLogin.headers, 'omnivate_session')).toBe('');

    const ownerLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: owner?.email,
        password: DEMO_PASSWORD,
        tenantSlug: aubergine.slug,
      },
    });
    expect(ownerLogin.json()).toMatchObject({ step: 'mfa_enroll' });
    const pending = cookieValue(ownerLogin.headers, 'omnivate_pending');
    expect(pending.length).toBeGreaterThan(20);

    const setup = await app.inject({
      method: 'GET',
      url: '/auth/mfa/pending',
      headers: { cookie: `omnivate_pending=${pending}` },
    });
    expect(setup.statusCode).toBe(200);
    const secret = (setup.json() as { secret: string }).secret;
    const confirmed = await app.inject({
      method: 'POST',
      url: '/auth/mfa/confirm',
      headers: { cookie: `omnivate_pending=${pending}` },
      payload: { code: generateTotp(secret) },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ step: 'session' });
    const session = cookieValue(confirmed.headers, 'omnivate_session');

    const enrolled = await getAdminPool().query<{ action: string; actor_id: string }>(
      `SELECT action, actor_id FROM audit_events
       WHERE actor_id = $1 AND action = 'auth.mfa.enrolled'`,
      [owner?.id],
    );
    expect(enrolled.rows[0]?.actor_id).toBe(owner?.id);

    const people = await app.inject({
      method: 'GET',
      url: '/krn/users',
      headers: { cookie: `omnivate_session=${session}`, 'x-tenant-id': crayon.id },
    });
    expect(people.statusCode).toBe(200);
    const emails = (people.json() as { users: { email: string }[] }).users.map(
      (user) => user.email,
    );
    expect(emails).toContain('owner@aubergine-atlas.example');
    expect(emails).toContain('cashier@aubergine-atlas.example');
    expect(emails.some((email) => email.endsWith('@blue-crayon-foundry.example'))).toBe(false);
    expect(JSON.stringify(people.json())).not.toMatch(/passwordHash|totpSecret|password_hash/);

    const blocked = await app.inject({
      method: 'POST',
      url: '/modules/KRN-01',
      headers: { cookie: `omnivate_session=${session}` },
      payload: { active: false },
    });
    expect(blocked.statusCode).toBe(409);
    const denial = await getAdminPool().query(
      `SELECT actor_id FROM audit_events
       WHERE action = 'identity.module.deactivate_denied' AND actor_id = $1`,
      [owner?.id],
    );
    expect(denial.rowCount).toBeGreaterThan(0);

    const invite = await app.inject({
      method: 'POST',
      url: '/krn/invites',
      headers: { cookie: `omnivate_session=${session}` },
      payload: { email: `guest-${randomUUID()}@example.com`, roleKey: 'sales_cashier' },
    });
    expect(invite.statusCode).toBe(201);
    const inviteUrl = (invite.json() as { inviteUrl: string }).inviteUrl;
    const token = new URL(inviteUrl).searchParams.get('token');
    expect(token).toBeTruthy();
    const accepted = await app.inject({
      method: 'POST',
      url: '/auth/invites/accept',
      payload: { token, displayName: 'Guest Person', password: 'another-local-password' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ step: 'session' });
  });

  it('locks a password after repeated failures', async () => {
    const id = randomUUID();
    const email = `lock-${id}@example.com`;
    await getAdminPool().query(
      `INSERT INTO users (id, email, display_name, password_hash, status, totp_enabled)
       SELECT $1, $2, 'Lock Test', password_hash, 'active', false
       FROM users WHERE email = 'cashier@aubergine-atlas.example'`,
      [id, email],
    );
    await getAdminPool().query(
      `INSERT INTO memberships (tenant_id, user_id, status) VALUES ($1, $2, 'active')`,
      [aubergine.id, id],
    );
    await getAdminPool().query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id)
       SELECT $1, $2, ur.role_id FROM user_roles ur
       WHERE ur.user_id = $3 AND ur.tenant_id = $1
       LIMIT 1`,
      [aubergine.id, id, cashier?.id],
    );

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email,
          password: 'wrong-password-1',
          tenantSlug: aubergine.slug,
        },
      });
      expect(failed.statusCode).toBe(401);
    }
    const locked = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email,
        password: DEMO_PASSWORD,
        tenantSlug: aubergine.slug,
      },
    });
    expect(locked.statusCode).toBe(429);
  });

  it('signs in from the email when it belongs to one company, and asks when it belongs to several', async () => {
    const direct = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: cashier?.email, password: DEMO_PASSWORD },
    });
    expect(direct.statusCode).toBe(200);
    expect(direct.json()).toMatchObject({ step: 'session', tenant: { slug: aubergine.slug } });
    expect(cookieValue(direct.headers, 'omnivate_session').length).toBeGreaterThan(20);

    const wrongCompany = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: cashier?.email, password: DEMO_PASSWORD, tenantSlug: crayon.slug },
    });
    expect(wrongCompany.statusCode).toBe(401);

    const id = randomUUID();
    const email = `both-${id}@example.com`;
    await getAdminPool().query(
      `INSERT INTO users (id, email, display_name, password_hash, status, totp_enabled)
       SELECT $1, $2, 'Both Companies', password_hash, 'active', false
       FROM users WHERE email = 'cashier@aubergine-atlas.example'`,
      [id, email],
    );
    await getAdminPool().query(
      `INSERT INTO memberships (tenant_id, user_id, status)
       VALUES ($1, $2, 'active'), ($3, $2, 'active')`,
      [aubergine.id, id, crayon.id],
    );
    await getAdminPool().query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id)
       SELECT ur.tenant_id, $1, ur.role_id
       FROM user_roles AS ur
       JOIN users AS u ON u.id = ur.user_id
       WHERE u.email IN ('cashier@aubergine-atlas.example', 'cashier@blue-crayon-foundry.example')`,
      [id],
    );

    const choice = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: DEMO_PASSWORD },
    });
    expect(choice.statusCode).toBe(200);
    expect(choice.json()).toMatchObject({
      step: 'choose_company',
      companies: [
        { slug: aubergine.slug, name: aubergine.displayName },
        { slug: crayon.slug, name: crayon.displayName },
      ],
    });
    expect(cookieValue(choice.headers, 'omnivate_session')).toBe('');
    expect(cookieValue(choice.headers, 'omnivate_pending')).toBe('');

    const picked = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: DEMO_PASSWORD, tenantSlug: crayon.slug },
    });
    expect(picked.statusCode).toBe(200);
    expect(picked.json()).toMatchObject({ step: 'session', tenant: { slug: crayon.slug } });

    const closedId = randomUUID();
    const closedEmail = `closed-${closedId}@example.com`;
    const closedTenant = randomUUID();
    try {
      await getAdminPool().query(
        `INSERT INTO tenants (
           id, slug, display_name, company_name, is_demo, timezone, currency_code, status, suspended_at
         )
         VALUES (
           $1, $2, 'Closed Demo Co', 'Closed Demo Co', false, 'Africa/Johannesburg', 'ZAR', 'suspended', now()
         )`,
        [closedTenant, `closed-${closedTenant.slice(0, 8)}`],
      );
      await getAdminPool().query(
        `INSERT INTO users (id, email, display_name, password_hash, status, totp_enabled)
         SELECT $1, $2, 'Closed Demo', password_hash, 'active', false
         FROM users WHERE email = 'cashier@aubergine-atlas.example'`,
        [closedId, closedEmail],
      );
      await getAdminPool().query(
        `INSERT INTO memberships (tenant_id, user_id, status) VALUES ($1, $2, 'active')`,
        [closedTenant, closedId],
      );
      const closed = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: closedEmail, password: DEMO_PASSWORD },
      });
      expect(closed.statusCode).toBe(403);
    } finally {
      const people = [id, closedId];
      await getAdminPool().query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [
        people,
      ]);
      await getAdminPool().query(`DELETE FROM memberships WHERE user_id = ANY($1::uuid[])`, [
        people,
      ]);
      await getAdminPool().query(`DELETE FROM krn03_branches WHERE tenant_id = $1`, [closedTenant]);
      await getAdminPool().query(`DELETE FROM krn03_legal_entities WHERE tenant_id = $1`, [
        closedTenant,
      ]);
      await getAdminPool().query(`DELETE FROM krn03_settings WHERE tenant_id = $1`, [closedTenant]);
      await getAdminPool().query(`DELETE FROM tenants WHERE id = $1`, [closedTenant]);
    }
  });
});
