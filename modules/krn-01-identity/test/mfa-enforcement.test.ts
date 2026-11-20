import { DEMO_PASSWORD, demoAccounts, demoTenants, platformOperator } from '@omnivate/shared';
import { closePools, getAdminPool, seed } from '@omnivate/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateTotp as clientCode } from '@omnivate/module-krn-01';
import { generateTotp as operatorCode } from '@omnivate/module-platform-control';
import { buildApp } from '../../../apps/api/src/app';

const aubergine = demoTenants[0];
const keptSecret = 'JBSWY3DPEHPK3PXP';
const staff = ['owner', 'manager', 'accountant', 'hr'].map((prefix) => {
  const account = demoAccounts.find(
    (person) => person.email === `${prefix}@aubergine-atlas.example`,
  );
  if (!account) {
    throw new Error(`Missing demo account ${prefix}`);
  }
  return account;
});
const ownerAccount = staff[0];
if (!ownerAccount) {
  throw new Error('Missing owner demo account.');
}

function cookieValue(headers: unknown, name: string): string {
  const raw =
    headers && typeof headers === 'object' && 'set-cookie' in headers
      ? (headers as { 'set-cookie'?: string | string[] })['set-cookie']
      : undefined;
  const lines = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const line = lines.find((item) => item.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(';')[0] ?? '';
}

function useEnforcement(value: 'on' | 'off' | undefined): void {
  if (value === undefined) {
    delete process.env.MFA_ENFORCEMENT;
    return;
  }
  process.env.MFA_ENFORCEMENT = value;
}

describe('MFA_ENFORCEMENT on company and operator sign-in', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const previous = process.env.MFA_ENFORCEMENT;

  beforeAll(async () => {
    await seed();
    await getAdminPool().query(
      `UPDATE users SET totp_secret = NULL, totp_enabled = false WHERE email = ANY($1::text[])`,
      [staff.map((person) => person.email)],
    );
    await getAdminPool().query(
      `UPDATE platform_operators SET totp_secret = NULL, totp_enabled = false WHERE email = $1`,
      [platformOperator.email],
    );
    await getAdminPool().query(`DELETE FROM login_attempts WHERE email = ANY($1::text[])`, [
      staff.map((person) => person.email),
    ]);
    await getAdminPool().query(`DELETE FROM platform_login_attempts WHERE email = $1`, [
      platformOperator.email,
    ]);
    app = await buildApp({ checkDatabase: async () => true });
  });

  afterAll(async () => {
    if (previous === undefined) {
      delete process.env.MFA_ENFORCEMENT;
    } else {
      process.env.MFA_ENFORCEMENT = previous;
    }
    await app.close();
    await closePools();
  });

  async function companyLogin(email: string) {
    return app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: DEMO_PASSWORD, tenantSlug: aubergine.slug },
    });
  }

  async function operatorLogin() {
    return app.inject({
      method: 'POST',
      url: '/control/auth/login',
      payload: { email: platformOperator.email, password: DEMO_PASSWORD },
    });
  }

  it('defaults to on for a company owner and an operator', async () => {
    useEnforcement(undefined);
    const owner = await companyLogin(ownerAccount.email);
    expect(owner.statusCode).toBe(200);
    expect(owner.json()).toMatchObject({ step: 'mfa_enroll' });
    expect(cookieValue(owner.headers, 'omnivate_session')).toBe('');

    const operator = await operatorLogin();
    expect(operator.statusCode).toBe(200);
    expect(operator.json()).toMatchObject({ step: 'mfa_enroll' });
    expect(cookieValue(operator.headers, 'omnivate_operator')).toBe('');
  });

  it('stays on when MFA_ENFORCEMENT is on', async () => {
    useEnforcement('on');
    for (const person of staff) {
      const login = await companyLogin(person.email);
      expect(login.statusCode).toBe(200);
      expect(login.json()).toMatchObject({ step: 'mfa_enroll' });
      expect(cookieValue(login.headers, 'omnivate_session')).toBe('');
    }
    const operator = await operatorLogin();
    expect(operator.json()).toMatchObject({ step: 'mfa_enroll' });
    expect(cookieValue(operator.headers, 'omnivate_operator')).toBe('');
  });

  it('opens a company session without a code when off and keeps an enrolled secret', async () => {
    useEnforcement('off');
    for (const person of staff) {
      const login = await companyLogin(person.email);
      expect(login.statusCode).toBe(200);
      expect(login.json()).toMatchObject({ step: 'session' });
      const token = cookieValue(login.headers, 'omnivate_session');
      expect(token.length).toBeGreaterThan(20);
      expect(cookieValue(login.headers, 'omnivate_pending')).toBe('');
      const session = await app.inject({
        method: 'GET',
        url: '/auth/session',
        headers: { cookie: `omnivate_session=${token}` },
      });
      expect(session.statusCode).toBe(200);
      expect(session.json()).toMatchObject({ step: 'session', user: { email: person.email } });
    }

    const before = await getAdminPool().query<{
      totp_secret: string | null;
      totp_enabled: boolean;
    }>(`SELECT totp_secret, totp_enabled FROM users WHERE email = $1`, [ownerAccount.email]);
    expect(before.rows[0]).toMatchObject({ totp_secret: null, totp_enabled: false });

    await getAdminPool().query(
      `UPDATE users SET totp_secret = $2, totp_enabled = true WHERE email = $1`,
      [ownerAccount.email, keptSecret],
    );
    const skipped = await companyLogin(ownerAccount.email);
    expect(skipped.json()).toMatchObject({ step: 'session' });
    const kept = await getAdminPool().query<{ totp_secret: string | null; totp_enabled: boolean }>(
      `SELECT totp_secret, totp_enabled FROM users WHERE email = $1`,
      [ownerAccount.email],
    );
    expect(kept.rows[0]).toEqual({ totp_secret: keptSecret, totp_enabled: true });

    useEnforcement('on');
    const verify = await companyLogin(ownerAccount.email);
    expect(verify.json()).toMatchObject({ step: 'mfa_verify' });
    expect(cookieValue(verify.headers, 'omnivate_session')).toBe('');
    const pending = cookieValue(verify.headers, 'omnivate_pending');
    const confirmed = await app.inject({
      method: 'POST',
      url: '/auth/mfa/confirm',
      headers: { cookie: `omnivate_pending=${pending}` },
      payload: { code: clientCode(keptSecret) },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ step: 'session' });
    const after = await getAdminPool().query<{ totp_secret: string | null }>(
      `SELECT totp_secret FROM users WHERE email = $1`,
      [ownerAccount.email],
    );
    expect(after.rows[0]?.totp_secret).toBe(keptSecret);
  });

  it('opens an operator session without a code when off and keeps an enrolled secret', async () => {
    useEnforcement('off');
    await getAdminPool().query(
      `UPDATE platform_operators SET totp_secret = NULL, totp_enabled = false WHERE email = $1`,
      [platformOperator.email],
    );
    const plain = await operatorLogin();
    expect(plain.statusCode).toBe(200);
    expect(plain.json()).toMatchObject({ step: 'session' });
    const token = cookieValue(plain.headers, 'omnivate_operator');
    expect(token.length).toBeGreaterThan(20);
    expect(cookieValue(plain.headers, 'omnivate_operator_pending')).toBe('');
    const session = await app.inject({
      method: 'GET',
      url: '/control/auth/session',
      headers: { cookie: `omnivate_operator=${token}` },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ step: 'session' });
    const overview = await app.inject({
      method: 'GET',
      url: '/control/dashboard',
      headers: { cookie: `omnivate_operator=${token}` },
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({ mfaEnforcement: 'off' });

    await getAdminPool().query(
      `UPDATE platform_operators SET totp_secret = $2, totp_enabled = true WHERE email = $1`,
      [platformOperator.email, keptSecret],
    );
    const skipped = await operatorLogin();
    expect(skipped.json()).toMatchObject({ step: 'session' });
    const kept = await getAdminPool().query<{ totp_secret: string | null; totp_enabled: boolean }>(
      `SELECT totp_secret, totp_enabled FROM platform_operators WHERE email = $1`,
      [platformOperator.email],
    );
    expect(kept.rows[0]).toEqual({ totp_secret: keptSecret, totp_enabled: true });

    useEnforcement('on');
    const verify = await operatorLogin();
    expect(verify.json()).toMatchObject({ step: 'mfa_verify' });
    expect(cookieValue(verify.headers, 'omnivate_operator')).toBe('');
    const pending = cookieValue(verify.headers, 'omnivate_operator_pending');
    const confirmed = await app.inject({
      method: 'POST',
      url: '/control/auth/mfa/confirm',
      headers: { cookie: `omnivate_operator_pending=${pending}` },
      payload: { code: operatorCode(keptSecret) },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ step: 'session' });
    const again = await getAdminPool().query<{ totp_secret: string | null }>(
      `SELECT totp_secret FROM platform_operators WHERE email = $1`,
      [platformOperator.email],
    );
    expect(again.rows[0]?.totp_secret).toBe(keptSecret);
    const noted = await app.inject({
      method: 'GET',
      url: '/control/dashboard',
      headers: {
        cookie: `omnivate_operator=${cookieValue(confirmed.headers, 'omnivate_operator')}`,
      },
    });
    expect(noted.json()).toMatchObject({ mfaEnforcement: 'on' });
  });
});
