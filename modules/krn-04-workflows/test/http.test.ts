import { randomBytes } from 'node:crypto';
import { demoAccounts, demoTenants, platformOperator } from '@omnivate/shared';
import { closePools, getAdminPool, seed } from '@omnivate/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../apps/api/src/app';
import { hashToken } from '../src/http';

const atlas = demoTenants[0];
const crayon = demoTenants[1];
const manager = demoAccounts.find((account) => account.email === 'manager@aubergine-atlas.example');
const owner = demoAccounts.find((account) => account.email === 'owner@aubergine-atlas.example');
const cashier = demoAccounts.find((account) => account.email === 'cashier@aubergine-atlas.example');
const crayonOwner = demoAccounts.find(
  (account) => account.email === 'owner@blue-crayon-foundry.example',
);

async function sessionCookie(tenant: string, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await getAdminPool().query(
    `INSERT INTO sessions (tenant_id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '10 minutes')`,
    [tenant, userId, hashToken(token)],
  );
  return `omnivate_session=${token}`;
}

describe('KRN-04 over HTTP', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let managerCookie = '';
  let ownerCookie = '';
  let cashierCookie = '';
  let crayonCookie = '';
  let operatorCookie = '';

  beforeAll(async () => {
    if (!manager || !owner || !cashier || !crayonOwner) {
      throw new Error('Demo accounts missing.');
    }
    await seed();
    managerCookie = await sessionCookie(atlas.id, manager.id);
    ownerCookie = await sessionCookie(atlas.id, owner.id);
    cashierCookie = await sessionCookie(atlas.id, cashier.id);
    crayonCookie = await sessionCookie(crayon.id, crayonOwner.id);
    const operatorToken = randomBytes(32).toString('base64url');
    await getAdminPool().query(
      `INSERT INTO platform_sessions (operator_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '10 minutes')`,
      [platformOperator.id, hashToken(operatorToken)],
    );
    operatorCookie = `omnivate_operator=${operatorToken}`;
    app = await buildApp({ checkDatabase: async () => true });
  });

  afterAll(async () => {
    await app.close();
    await closePools();
  });

  it('lets a manager read fictional fields and hides them from a cashier and the other company', async () => {
    const seen = await app.inject({
      method: 'GET',
      url: '/krn/workflows/fields',
      headers: { cookie: managerCookie },
    });
    expect(seen.statusCode).toBe(200);
    expect(seen.body).toContain('Delivery bay');
    expect(seen.body).toContain('Old counter code');

    const denied = await app.inject({
      method: 'GET',
      url: '/krn/workflows/fields',
      headers: { cookie: cashierCookie },
    });
    expect(denied.statusCode).toBe(403);

    const other = await app.inject({
      method: 'GET',
      url: '/krn/workflows/fields',
      headers: { cookie: crayonCookie },
    });
    expect(other.statusCode).toBe(200);
    expect(other.body).toContain('Alloy note');
    expect(other.body).not.toContain('Delivery bay');

    const alerts = await app.inject({
      method: 'GET',
      url: '/krn/workflows/notifications',
      headers: { cookie: managerCookie },
    });
    expect(alerts.statusCode).toBe(200);
    expect(alerts.body).toContain('Sample job card is waiting');

    const summary = await app.inject({
      method: 'GET',
      url: `/control/tenants/${atlas.id}/workflows`,
      headers: { cookie: operatorCookie },
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.body).toContain('Delivery bay');
    expect(summary.body).toContain('Waiting for parts');
    expect(summary.body).not.toContain('Alloy note');

    const blocked = await app.inject({
      method: 'POST',
      url: '/krn/workflows/fields',
      headers: { cookie: ownerCookie },
      payload: {
        entityType: 'krn04.sample_job',
        fieldKey: 'owner_only',
        label: 'Owner only',
        fieldType: 'text',
      },
    });
    expect(blocked.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: `/control/tenants/${atlas.id}/fields`,
      headers: { cookie: operatorCookie },
      payload: {
        entityType: 'krn04.sample_job',
        fieldKey: `gate_${randomBytes(4).toString('hex')}`,
        label: 'Gate note',
        fieldType: 'text',
      },
    });
    expect(created.statusCode).toBe(201);
    const audit = await getAdminPool().query(
      `SELECT actor_kind, operator_id, actor_id
       FROM audit_events
       WHERE action = 'workflow.field.created' AND after_data->>'label' = 'Gate note'
       ORDER BY occurred_at DESC
       LIMIT 1`,
    );
    expect(audit.rows[0]).toMatchObject({
      actor_kind: 'operator',
      operator_id: platformOperator.id,
      actor_id: null,
    });
  });

  it('moves the sample job card and stops the same person finishing it', async () => {
    const blocked = await app.inject({
      method: 'POST',
      url: '/krn/workflows/move',
      headers: { cookie: cashierCookie },
      payload: {
        machineKey: 'krn04.sample_job',
        entityId: 'c4111111-1111-4111-8111-111111111040',
        transitionKey: 'start',
      },
    });
    expect(blocked.statusCode).toBe(403);

    const started = await app.inject({
      method: 'POST',
      url: '/krn/workflows/move',
      headers: { cookie: managerCookie },
      payload: {
        machineKey: 'krn04.sample_job',
        entityId: 'c4111111-1111-4111-8111-111111111040',
        transitionKey: 'start',
      },
    });
    expect(started.statusCode).toBe(200);

    const samePerson = await app.inject({
      method: 'POST',
      url: '/krn/workflows/move',
      headers: { cookie: managerCookie },
      payload: {
        machineKey: 'krn04.sample_job',
        entityId: 'c4111111-1111-4111-8111-111111111040',
        transitionKey: 'finish',
      },
    });
    expect(samePerson.statusCode).toBe(409);

    const finished = await app.inject({
      method: 'POST',
      url: '/krn/workflows/move',
      headers: { cookie: ownerCookie },
      payload: {
        machineKey: 'krn04.sample_job',
        entityId: 'c4111111-1111-4111-8111-111111111040',
        transitionKey: 'finish',
      },
    });
    expect(finished.statusCode).toBe(200);

    const stillThere = await getAdminPool().query(
      `SELECT id FROM krn04_field_definitions WHERE field_key = 'old_counter_code' AND archived_at IS NOT NULL`,
    );
    expect(stillThere.rowCount).toBe(1);

    const ownerAlerts = await app.inject({
      method: 'GET',
      url: '/krn/workflows/notifications',
      headers: { cookie: ownerCookie },
    });
    expect(ownerAlerts.statusCode).toBe(200);
    expect(ownerAlerts.body).toContain('Rush job finished');
  });

  it('keeps calculated fields and automations for the operator', async () => {
    const blocked = await app.inject({
      method: 'POST',
      url: `/control/tenants/${atlas.id}/automations`,
      headers: { cookie: ownerCookie },
      payload: { name: 'Owner rule' },
    });
    expect(blocked.statusCode).toBe(401);

    const listed = await app.inject({
      method: 'GET',
      url: `/control/tenants/${atlas.id}/automations`,
      headers: { cookie: operatorCookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.body).toContain('Reorder Alert');
    expect(listed.body).toContain('On Hand');
    expect(listed.body).toContain('Alerted the manager');

    const spoofed = await app.inject({
      method: 'POST',
      url: '/krn/workflows/values',
      headers: { cookie: ownerCookie },
      payload: {
        entityType: 'krn04.sample_job',
        entityId: 'c4111111-1111-4111-8111-111111111040',
        values: { site_contact: 'Nomsa', qty: '2', price: '12.50', line_total: 1 },
      },
    });
    expect(spoofed.statusCode).toBe(400);
    expect(spoofed.body).toMatch(/cannot type/i);

    const saved = await app.inject({
      method: 'POST',
      url: '/krn/workflows/values',
      headers: { cookie: ownerCookie },
      payload: {
        entityType: 'krn04.sample_job',
        entityId: 'c4111111-1111-4111-8111-111111111040',
        values: { site_contact: 'Nomsa', qty: '2', price: '12.50' },
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ values: { line_total: 2500 } });

    const cashier = await app.inject({
      method: 'POST',
      url: '/krn/workflows/values',
      headers: { cookie: cashierCookie },
      payload: {
        entityType: 'krn04.sample_job',
        entityId: 'c4111111-1111-4111-8111-111111111040',
        values: { site_contact: 'Nomsa' },
      },
    });
    expect(cashier.statusCode).toBe(403);
  });

  it('shows stock-style custom fields for a record, with calculated values filled in', async () => {
    if (!owner) {
      throw new Error('Demo accounts missing.');
    }
    const accountant = demoAccounts.find(
      (account) => account.email === 'accountant@aubergine-atlas.example',
    );
    if (!accountant) {
      throw new Error('Demo accounts missing.');
    }
    const accountantCookie = await sessionCookie(atlas.id, accountant.id);
    const entityId = 'c4111111-1111-4111-8111-111111111040';
    const saved = await app.inject({
      method: 'POST',
      url: '/krn/workflows/values',
      headers: { cookie: ownerCookie },
      payload: {
        entityType: 'krn04.sample_job',
        entityId,
        values: { site_contact: 'Nomsa', qty: '4', price: '10.00' },
      },
    });
    expect(saved.statusCode).toBe(200);

    const loaded = await app.inject({
      method: 'GET',
      url: `/krn/workflows/values?entityType=krn04.sample_job&entityId=${entityId}`,
      headers: { cookie: ownerCookie },
    });
    expect(loaded.statusCode).toBe(200);
    const body = loaded.json() as {
      canEdit: boolean;
      values: Record<string, unknown>;
      fields: { fieldKey: string; fieldType: string }[];
    };
    expect(body.canEdit).toBe(true);
    expect(body.values.site_contact).toBe('Nomsa');
    expect(body.values.line_total).toBe(4000);
    expect(body.fields.some((field) => field.fieldKey === 'line_total')).toBe(true);
    expect(body.fields.some((field) => field.fieldKey === 'old_counter_code')).toBe(false);
    expect(body.fields.find((field) => field.fieldKey === 'line_total')?.fieldType).toBe(
      'calculated',
    );

    const readOnly = await app.inject({
      method: 'GET',
      url: `/krn/workflows/values?entityType=krn04.sample_job&entityId=${entityId}`,
      headers: { cookie: accountantCookie },
    });
    expect(readOnly.statusCode).toBe(200);
    expect((readOnly.json() as { canEdit: boolean }).canEdit).toBe(false);

    const hidden = await app.inject({
      method: 'GET',
      url: `/krn/workflows/values?entityType=krn04.sample_job&entityId=${entityId}`,
      headers: { cookie: cashierCookie },
    });
    expect(hidden.statusCode).toBe(403);
  });
});
