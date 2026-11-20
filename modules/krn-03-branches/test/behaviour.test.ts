import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { activationClosure, getModule, tenantId } from '@omnivate/shared';
import { BranchAccessError, requireBranchAccess, withTenant } from '@omnivate/kernel';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../apps/api/src/app';
import { closePools, getAdminPool, getAppPool, schema, seedTenantRbac } from '@omnivate/db';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

describe('KRN-03 catalog', () => {
  it('matches the blueprint prerequisite and the modules it feeds', () => {
    expect(getModule('KRN-03')).toMatchObject({
      name: 'Multi-Branch & Inter-Company Structure',
      prerequisites: ['KRN-01'],
      packaging: 'Core Platform (Included)',
    });
    expect(getModule('FIN-01').prerequisites).toEqual(['KRN-01', 'KRN-03']);
    expect(getModule('SCM-01').prerequisites).toContain('KRN-03');
    expect(activationClosure('SAL-03')).toContain('KRN-03');
    expect(activationClosure('ANA-03')).toContain('KRN-01');
  });
});

describe('KRN-03 branches', () => {
  const tenant = randomUUID();
  const other = randomUUID();
  const owner = randomUUID();
  const cashier = randomUUID();
  const ownerToken = `owner-${randomUUID()}`;
  const cashierToken = `cashier-${randomUUID()}`;
  let app: Awaited<ReturnType<typeof buildApp>>;

  afterAll(async () => {
    await app?.close();
    const pool = getAdminPool();
    await pool.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only');
    await pool.query('ALTER TABLE tenant_modules DISABLE TRIGGER tenant_modules_root_required');
    try {
      await pool.query('DELETE FROM audit_events WHERE tenant_id = ANY($1::uuid[])', [
        [tenant, other],
      ]);
      await pool.query('DELETE FROM sessions WHERE tenant_id = ANY($1::uuid[])', [[tenant, other]]);
      await pool.query('DELETE FROM user_roles WHERE tenant_id = ANY($1::uuid[])', [
        [tenant, other],
      ]);
      await pool.query('DELETE FROM role_permissions WHERE tenant_id = ANY($1::uuid[])', [
        [tenant, other],
      ]);
      await pool.query('DELETE FROM tenant_modules WHERE tenant_id = ANY($1::uuid[])', [
        [tenant, other],
      ]);
      await pool.query('DELETE FROM memberships WHERE tenant_id = ANY($1::uuid[])', [
        [tenant, other],
      ]);
      await pool.query('DELETE FROM roles WHERE tenant_id = ANY($1::uuid[])', [[tenant, other]]);
      await pool.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[tenant, other]]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[owner, cashier]]);
    } finally {
      await pool.query('ALTER TABLE tenant_modules ENABLE TRIGGER tenant_modules_root_required');
      await pool.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only');
      await closePools();
    }
  });

  it('provisions Head Office, gates access, archives, and audits', async () => {
    const pool = getAdminPool();
    await pool.query(
      `INSERT INTO tenants (id, slug, display_name, company_name, is_demo, timezone, currency_code, address_city)
       VALUES ($1, $2, 'Branch behaviour', 'Branch behaviour', false, 'Africa/Johannesburg', 'ZAR', 'Cape Town'),
              ($3, $4, 'Other company', 'Other company', false, 'Africa/Johannesburg', 'ZAR', 'Durban')`,
      [tenant, `beh-${tenant.slice(0, 8)}`, other, `oth-${other.slice(0, 8)}`],
    );
    const db = drizzle(pool, { schema });
    const roles = await seedTenantRbac(db, tenant);
    for (const [id, roleKey, label] of [
      [owner, 'tenant_owner', 'owner'],
      [cashier, 'sales_cashier', 'cashier'],
    ] as const) {
      await pool.query(
        `INSERT INTO users (id, email, display_name, password_hash, status)
         VALUES ($1, $2, $3, 'x', 'active')`,
        [id, `${label}-${id.slice(0, 8)}@example.com`, label],
      );
      await pool.query(
        `INSERT INTO memberships (tenant_id, user_id, status) VALUES ($1, $2, 'active')`,
        [tenant, id],
      );
      await pool.query(`INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`, [
        tenant,
        id,
        roles.get(roleKey),
      ]);
    }
    await pool.query(
      `INSERT INTO sessions (tenant_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '15 minutes'),
              ($1, $4, $5, now() + interval '15 minutes')`,
      [tenant, owner, hashToken(ownerToken), cashier, hashToken(cashierToken)],
    );

    const head = await withTenant(tenantId(tenant), async (tx) => {
      const rows = await tx.db.execute<{ id: string; code: string; city: string }>(sql`
        SELECT id, code, city FROM krn03_branches WHERE is_head_office
      `);
      return rows.rows[0];
    });
    expect(head?.code).toBe('HO');
    expect(head?.city).toBe('Cape Town');
    if (!head) {
      throw new Error('Head Office missing.');
    }

    const single = await withTenant(tenantId(tenant), (tx) =>
      requireBranchAccess(tx, cashier, null),
    );
    expect(single.id).toBe(head.id);
    await expect(
      withTenant(tenantId(tenant), (tx) => requireBranchAccess(tx, cashier, randomUUID())),
    ).rejects.toBeInstanceOf(BranchAccessError);

    app = await buildApp({ checkDatabase: async () => true });
    const cashierList = await app.inject({
      method: 'GET',
      url: '/krn/branches',
      cookies: { omnivate_session: cashierToken },
    });
    expect(cashierList.statusCode).toBe(403);

    const context = await app.inject({
      method: 'GET',
      url: '/krn/branches/context',
      cookies: { omnivate_session: ownerToken },
    });
    expect(context.statusCode).toBe(200);
    expect(context.json()).toMatchObject({ multiBranch: false, branches: [] });

    const blocked = await app.inject({
      method: 'POST',
      url: '/krn/branches',
      cookies: { omnivate_session: ownerToken },
      payload: { name: 'Durban', code: 'DBN', city: 'Durban', country: 'ZA', active: true },
    });
    expect(blocked.statusCode).toBe(409);

    const toggled = await app.inject({
      method: 'POST',
      url: '/krn/multi-branch',
      cookies: { omnivate_session: ownerToken },
      payload: { enabled: true },
    });
    expect(toggled.statusCode).toBe(200);

    const created = await app.inject({
      method: 'POST',
      url: '/krn/branches',
      cookies: { omnivate_session: ownerToken },
      payload: {
        name: 'Durban',
        code: 'dbn',
        city: 'Durban',
        province: 'KwaZulu-Natal',
        country: 'ZA',
        contactEmail: 'durban@example.com',
        active: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const durbanId = created.json().branch.id as string;
    expect(created.json().branch.code).toBe('DBN');

    const audit = await pool.query<{
      before_data: null;
      after_data: { name: string; code: string };
    }>(
      `SELECT before_data, after_data FROM audit_events
       WHERE tenant_id = $1 AND action = 'krn03.branch.created' AND entity_id = $2`,
      [tenant, durbanId],
    );
    expect(audit.rows[0]?.before_data).toBeNull();
    expect(audit.rows[0]?.after_data).toMatchObject({ name: 'Durban', code: 'DBN' });

    await expect(
      withTenant(tenantId(tenant), (tx) => requireBranchAccess(tx, cashier, durbanId)),
    ).rejects.toBeInstanceOf(BranchAccessError);
    const ownerAtDurban = await withTenant(tenantId(tenant), (tx) =>
      requireBranchAccess(tx, owner, durbanId),
    );
    expect(ownerAtDurban.name).toBe('Durban');

    const granted = await app.inject({
      method: 'POST',
      url: '/krn/branch-access',
      cookies: { omnivate_session: ownerToken },
      payload: { userId: cashier, branchId: durbanId },
    });
    expect(granted.statusCode).toBe(201);
    const allowed = await withTenant(tenantId(tenant), (tx) =>
      requireBranchAccess(tx, cashier, durbanId),
    );
    expect(allowed.code).toBe('DBN');

    const hidden = await withTenant(tenantId(other), async (tx) => {
      const rows = await tx.db.execute<{ id: string }>(sql`
        SELECT id FROM krn03_branches WHERE id = ${durbanId}
      `);
      return rows.rows;
    });
    expect(hidden).toEqual([]);

    const archived = await app.inject({
      method: 'POST',
      url: `/krn/branches/${durbanId}/archive`,
      cookies: { omnivate_session: ownerToken },
      payload: {},
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().branch.archivedAt).toEqual(expect.any(String));
    const stillThere = await pool.query<{ archived_at: Date }>(
      'SELECT archived_at FROM krn03_branches WHERE id = $1',
      [durbanId],
    );
    expect(stillThere.rows[0]?.archived_at).toBeTruthy();

    await expect(
      getAppPool().query('DELETE FROM krn03_branches WHERE id = $1', [durbanId]),
    ).rejects.toThrow(/permission denied/i);

    const headArchive = await app.inject({
      method: 'POST',
      url: `/krn/branches/${head.id}/archive`,
      cookies: { omnivate_session: ownerToken },
      payload: {},
    });
    expect(headArchive.statusCode).toBe(409);
  });
});
