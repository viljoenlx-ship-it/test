import { randomUUID } from 'node:crypto';
import { DEMO_PASSWORD, demoAccounts, demoTenants } from '@omnivate/shared';
import { closePools, getAdminPool, seed } from '@omnivate/db';
import { tenantId, withTenant } from '@omnivate/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../apps/api/src/app';
import { generateTotp } from '@omnivate/module-krn-01';
import { countParties } from '../src/index';

const aubergine = demoTenants[0];
const cashier = demoAccounts.find((account) => account.email === 'cashier@aubergine-atlas.example');
const accountant = demoAccounts.find(
  (account) => account.email === 'accountant@aubergine-atlas.example',
);
const manager = demoAccounts.find((account) => account.email === 'manager@aubergine-atlas.example');
const owner = demoAccounts.find((account) => account.email === 'owner@aubergine-atlas.example');

function cookieValue(headers: unknown, name: string): string {
  const raw =
    headers && typeof headers === 'object' && 'set-cookie' in headers
      ? (headers as { 'set-cookie'?: string | string[] })['set-cookie']
      : undefined;
  const lines = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const line = lines.find((item) => item.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(';')[0] ?? '';
}

async function sessionFor(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
  slug: string,
): Promise<string> {
  await getAdminPool().query(
    `UPDATE users SET totp_secret = NULL, totp_enabled = false WHERE email = $1`,
    [email],
  );
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: DEMO_PASSWORD, tenantSlug: slug },
  });
  expect(login.statusCode).toBe(200);
  const direct = cookieValue(login.headers, 'omnivate_session');
  if (direct) {
    return direct;
  }
  expect(login.json()).toMatchObject({ step: 'mfa_enroll' });
  const pending = cookieValue(login.headers, 'omnivate_pending');
  const setup = await app.inject({
    method: 'GET',
    url: '/auth/mfa/pending',
    headers: { cookie: `omnivate_pending=${pending}` },
  });
  const secret = (setup.json() as { secret: string }).secret;
  const confirmed = await app.inject({
    method: 'POST',
    url: '/auth/mfa/confirm',
    headers: { cookie: `omnivate_pending=${pending}` },
    payload: { code: generateTotp(secret) },
  });
  expect(confirmed.statusCode).toBe(200);
  const token = cookieValue(confirmed.headers, 'omnivate_session');
  expect(token.length).toBeGreaterThan(20);
  return token;
}

describe('KRN-02 parties', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    if (!cashier || !accountant || !manager || !owner) {
      throw new Error('Demo accounts missing.');
    }
    await seed();
    app = await buildApp({ checkDatabase: async () => true });
  });

  afterAll(async () => {
    await getAdminPool().query(
      `DELETE FROM parties
       WHERE tenant_id = $1
         AND display_name ~ '^(Fictional Depot|Owner Only|Payout Clash|Test Person) '`,
      [aubergine.id],
    );
    await app.close();
    await closePools();
  });

  it('seeds fictional contacts and keeps the role matrix', async () => {
    const counts = await withTenant(tenantId(aubergine.id), (tx) => countParties(tx));
    expect(counts.active).toBeGreaterThanOrEqual(5);
    expect(counts.customers).toBeGreaterThanOrEqual(2);
    expect(counts.suppliers).toBeGreaterThanOrEqual(2);
    expect(counts.staff).toBeGreaterThanOrEqual(1);

    const cashierCookie = await sessionFor(app, cashier!.email, aubergine.slug);
    const denied = await app.inject({
      method: 'GET',
      url: '/krn/parties',
      headers: { cookie: `omnivate_session=${cashierCookie}` },
    });
    expect(denied.statusCode).toBe(403);

    const accountantCookie = await sessionFor(app, accountant!.email, aubergine.slug);
    const listed = await app.inject({
      method: 'GET',
      url: '/krn/parties?q=cedar',
      headers: { cookie: `omnivate_session=${accountantCookie}` },
    });
    expect(listed.statusCode).toBe(200);
    const body = listed.json() as {
      canEdit: boolean;
      parties: { displayName: string }[];
    };
    expect(body.canEdit).toBe(false);
    expect(body.parties.map((party) => party.displayName)).toContain(
      'Cedar Kite Grocers (Pty) Ltd',
    );

    const blocked = await app.inject({
      method: 'POST',
      url: '/krn/parties',
      headers: { cookie: `omnivate_session=${accountantCookie}` },
      payload: {
        kind: 'organisation',
        displayName: 'Should not save',
        roles: ['customer'],
        popiaConsent: false,
      },
    });
    expect(blocked.statusCode).toBe(403);
  });

  it('detects duplicates, masks identity, archives, and writes a redacted audit', async () => {
    const managerCookie = await sessionFor(app, manager!.email, aubergine.slug);
    const ownerCookie = await sessionFor(app, owner!.email, aubergine.slug);
    const name = `Fictional Depot ${randomUUID().slice(0, 8)}`;
    const email = `depot-${randomUUID().slice(0, 8)}@example.com`;
    const vatNumber = `4${String(Date.now()).slice(-9)}`;
    const draft = {
      kind: 'organisation',
      displayName: name,
      roles: ['customer', 'supplier'],
      popiaConsent: true,
      vatNumber,
      channels: [{ kind: 'email', value: email, isPrimary: true }],
      tags: ['depot'],
      note: 'Created in a test. Not a real business.',
    };

    const clash = await app.inject({
      method: 'POST',
      url: '/krn/parties',
      headers: { cookie: `omnivate_session=${managerCookie}` },
      payload: { ...draft, displayName: 'Cedar Kite Grocers (Pty) Ltd', confirmDuplicate: false },
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error).toBe('duplicate');

    const created = await app.inject({
      method: 'POST',
      url: '/krn/parties',
      headers: { cookie: `omnivate_session=${managerCookie}` },
      payload: draft,
    });
    expect(created.statusCode).toBe(201);
    const partyId = (created.json() as { party: { id: string } }).party.id;

    const hidden = await app.inject({
      method: 'GET',
      url: `/krn/parties/c2222222-2222-4222-8222-222222222201`,
      headers: { cookie: `omnivate_session=${managerCookie}`, 'x-tenant-id': demoTenants[1].id },
    });
    expect(hidden.statusCode).toBe(404);

    const withId = await app.inject({
      method: 'POST',
      url: '/krn/parties',
      headers: { cookie: `omnivate_session=${managerCookie}` },
      payload: {
        kind: 'person',
        givenName: 'Test',
        familyName: 'Person',
        displayName: `Test Person ${randomUUID().slice(0, 8)}`,
        roles: ['staff'],
        popiaConsent: true,
        idNumber: '9204144800082',
      },
    });
    expect(withId.statusCode).toBe(403);

    const owned = await app.inject({
      method: 'POST',
      url: '/krn/parties',
      headers: { cookie: `omnivate_session=${ownerCookie}` },
      payload: {
        kind: 'person',
        givenName: 'Test',
        familyName: 'Owneronly',
        displayName: `Owner Only ${randomUUID().slice(0, 8)}`,
        roles: ['staff'],
        popiaConsent: false,
        idNumber: '9204144800082',
      },
    });
    expect(owned.statusCode).toBe(201);
    const ownedId = (owned.json() as { party: { id: string; idNumber: string } }).party.id;
    expect((owned.json() as { party: { idNumber: string } }).party.idNumber).toBe('9204144800082');

    const masked = await app.inject({
      method: 'GET',
      url: `/krn/parties/${ownedId}`,
      headers: { cookie: `omnivate_session=${managerCookie}` },
    });
    expect(masked.statusCode).toBe(200);
    expect((masked.json() as { party: { idNumber: string } }).party.idNumber).toBe('••••');
    expect(JSON.stringify(masked.json())).not.toContain('9204144800082');

    const audit = await getAdminPool().query<{ after_data: { idNumberPresent?: boolean } }>(
      `SELECT after_data FROM audit_events
       WHERE entity_id = $1 AND action = 'party.created'`,
      [ownedId],
    );
    expect(audit.rows[0]?.after_data.idNumberPresent).toBe(true);
    expect(JSON.stringify(audit.rows)).not.toContain('9204144800082');

    const archived = await app.inject({
      method: 'POST',
      url: `/krn/parties/${partyId}/archive`,
      headers: { cookie: `omnivate_session=${managerCookie}` },
      payload: {},
    });
    expect(archived.statusCode).toBe(200);
    const active = await app.inject({
      method: 'GET',
      url: `/krn/parties?q=${encodeURIComponent(name)}`,
      headers: { cookie: `omnivate_session=${managerCookie}` },
    });
    expect((active.json() as { parties: unknown[] }).parties).toEqual([]);
    const found = await app.inject({
      method: 'GET',
      url: `/krn/parties?status=archived&q=${encodeURIComponent(name)}`,
      headers: { cookie: `omnivate_session=${managerCookie}` },
    });
    expect((found.json() as { parties: { id: string }[] }).parties[0]?.id).toBe(partyId);
  });

  it('blocks the person who would both add a supplier and approve the payout', async () => {
    const managerCookie = await sessionFor(app, manager!.email, aubergine.slug);
    const created = await app.inject({
      method: 'POST',
      url: '/krn/parties',
      headers: { cookie: `omnivate_session=${managerCookie}` },
      payload: {
        kind: 'organisation',
        displayName: `Payout Clash ${randomUUID().slice(0, 8)}`,
        roles: ['customer'],
        popiaConsent: false,
      },
    });
    expect(created.statusCode).toBe(201);
    const partyId = (created.json() as { party: { id: string } }).party.id;
    await getAdminPool().query(
      `INSERT INTO audit_events (tenant_id, actor_id, action, entity_type, entity_id, after_data)
       VALUES ($1, $2, 'fin.creditor.payout.approve', 'party', $3, '{"fictional":true}'::jsonb)`,
      [aubergine.id, manager!.id, partyId],
    );
    const blocked = await app.inject({
      method: 'PUT',
      url: `/krn/parties/${partyId}`,
      headers: { cookie: `omnivate_session=${managerCookie}` },
      payload: {
        kind: 'organisation',
        displayName: `Payout Clash ${partyId.slice(0, 8)}`,
        roles: ['customer', 'supplier'],
        popiaConsent: false,
      },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe('sod_conflict');
  });
});
