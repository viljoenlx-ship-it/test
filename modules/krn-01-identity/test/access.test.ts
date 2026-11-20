import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { APPROVAL_LIMITS, COUNSELING_PERMISSION, tenantId } from '@omnivate/shared';
import {
  appendAuditEvent,
  assertSegregation,
  loadPermissionKeys,
  maskFields,
  PermissionDeniedError,
  requirePermission,
  setTenantModuleActive,
  SodConflictError,
  withTenant,
} from '@omnivate/kernel';
import { afterAll, describe, expect, it } from 'vitest';
import { closePools, getAdminPool, schema, seedTenantRbac, sodRules } from '@omnivate/db';

describe('KRN-01 permissions, MFA flags, and segregation', () => {
  const tenant = randomUUID();
  const owner = randomUUID();
  const manager = randomUUID();
  const cashier = randomUUID();
  const hr = randomUUID();
  const bare = randomUUID();

  afterAll(async () => {
    const pool = getAdminPool();
    await pool.query('ALTER TABLE tenant_modules DISABLE TRIGGER tenant_modules_root_required');
    try {
      await pool.query('DELETE FROM user_roles WHERE tenant_id = $1', [tenant]);
      await pool.query('DELETE FROM role_permissions WHERE tenant_id = $1', [tenant]);
      await pool.query('DELETE FROM memberships WHERE tenant_id = $1', [tenant]);
      await pool.query('DELETE FROM roles WHERE tenant_id = $1', [tenant]);
      await pool.query('DELETE FROM tenant_modules WHERE tenant_id = $1', [tenant]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [owner, manager, cashier, hr, bare],
      ]);
      await pool.query('DELETE FROM tenants WHERE id = $1', [tenant]);
    } finally {
      await pool.query('ALTER TABLE tenant_modules ENABLE TRIGGER tenant_modules_root_required');
      await closePools();
    }
  });

  async function provision(): Promise<void> {
    await getAdminPool().query(
      `INSERT INTO tenants (id, slug, display_name, is_demo, timezone, currency_code)
       VALUES ($1, $2, 'Access fixture', false, 'Africa/Johannesburg', 'ZAR')`,
      [tenant, `access-${tenant.slice(0, 8)}`],
    );
    const db = drizzle(getAdminPool(), { schema });
    const roleIds = await seedTenantRbac(db, tenant);
    const people = [
      [owner, 'tenant_owner', 'owner'],
      [manager, 'branch_manager', 'manager'],
      [cashier, 'sales_cashier', 'cashier'],
      [hr, 'hr_compliance', 'hr'],
    ] as const;
    for (const [id, roleKey, label] of people) {
      await getAdminPool().query(
        `INSERT INTO users (id, email, display_name, password_hash, status)
         VALUES ($1, $2, $3, 'x', 'active')`,
        [id, `${label}-${id}@example.com`, label],
      );
      await getAdminPool().query(
        `INSERT INTO memberships (tenant_id, user_id, status) VALUES ($1, $2, 'active')`,
        [tenant, id],
      );
      await getAdminPool().query(
        `INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`,
        [tenant, id, roleIds.get(roleKey)],
      );
    }
    await getAdminPool().query(
      `INSERT INTO users (id, email, display_name, password_hash, status)
       VALUES ($1, $2, 'Bare', 'x', 'active')`,
      [bare, `bare-${bare}@example.com`],
    );
    await getAdminPool().query(
      `INSERT INTO memberships (tenant_id, user_id, status) VALUES ($1, $2, 'active')`,
      [tenant, bare],
    );
  }

  it('denies by default, allows the matrix, and enforces approval caps', async () => {
    await provision();
    const scoped = tenantId(tenant);

    await withTenant(scoped, async (tx) => {
      await expect(
        requirePermission(tx, bare, { scope: 'fin.ledger', action: 'read', moduleId: 'FIN-01' }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);

      await requirePermission(tx, cashier, {
        scope: 'fin.ledger',
        action: 'read',
        moduleId: 'FIN-02',
      });
      await expect(
        requirePermission(tx, cashier, { scope: 'fin.ledger', action: 'post', moduleId: 'FIN-01' }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);

      await requirePermission(tx, manager, {
        scope: 'scm.procurement',
        action: 'approve',
        moduleId: 'SCM-02',
        amountCents: APPROVAL_LIMITS.managerCents,
      });
      await expect(
        requirePermission(tx, manager, {
          scope: 'scm.procurement',
          action: 'approve',
          moduleId: 'SCM-02',
          amountCents: APPROVAL_LIMITS.managerCents + 1n,
        }),
      ).rejects.toThrow(/approval limit/);

      await requirePermission(tx, owner, {
        scope: 'scm.procurement',
        action: 'approve',
        moduleId: 'SCM-02',
        amountCents: APPROVAL_LIMITS.managerCents + 1n,
      });

      const ownerKeys = await loadPermissionKeys(tx, owner);
      const hrKeys = await loadPermissionKeys(tx, hr);
      expect(ownerKeys.has(COUNSELING_PERMISSION)).toBe(false);
      expect(hrKeys.has(COUNSELING_PERMISSION)).toBe(true);
      const note = { body: 'counseling note' };
      expect(maskFields(note, ['body'], ownerKeys, COUNSELING_PERMISSION).body).toBe('••••');
      expect(maskFields(note, ['body'], hrKeys, COUNSELING_PERMISSION).body).toBe(
        'counseling note',
      );
    });
  });

  it('blocks the maker from being the checker on the same record', async () => {
    const entity = randomUUID();
    const other = randomUUID();
    await expect(
      withTenant(tenantId(tenant), async (tx) => {
        await tx.db.insert(sodRules).values({
          tenantId: tenant,
          actionA: 'fixture.check',
          actionB: 'fixture.make',
          description: 'Maker cannot check',
          enabled: true,
        });
        await appendAuditEvent(tx, {
          action: 'fixture.make',
          entityType: 'fixture',
          entityId: entity,
          actorId: owner,
          beforeData: null,
          afterData: { made: true },
          requestIp: null,
          userAgent: 'vitest',
        });
        await expect(
          assertSegregation(tx, { actorId: owner, action: 'fixture.check', entityId: entity }),
        ).rejects.toBeInstanceOf(SodConflictError);
        await assertSegregation(tx, {
          actorId: manager,
          action: 'fixture.check',
          entityId: entity,
        });
        await assertSegregation(tx, { actorId: owner, action: 'fixture.check', entityId: other });
        throw new Error('rollback sod fixture');
      }),
    ).rejects.toThrow(/rollback sod fixture/);
  });

  it('refuses to deactivate KRN-01 and refuses to drop MFA on owner and accountant', async () => {
    await expect(
      withTenant(tenantId(tenant), (tx) =>
        setTenantModuleActive(tx, {
          actorId: owner,
          moduleId: 'KRN-01',
          active: false,
          requestIp: null,
          userAgent: 'vitest',
        }),
      ),
    ).rejects.toThrow(/cannot be disabled/);

    await expect(
      getAdminPool().query(
        `UPDATE tenant_modules SET active = false WHERE tenant_id = $1 AND module_id = 'KRN-01'`,
        [tenant],
      ),
    ).rejects.toThrow(/cannot be disabled/);

    await expect(
      getAdminPool().query(
        `DELETE FROM tenant_modules WHERE tenant_id = $1 AND module_id = 'KRN-01'`,
        [tenant],
      ),
    ).rejects.toThrow(/cannot be disabled/);

    for (const key of ['tenant_owner', 'branch_manager', 'accountant', 'hr_compliance']) {
      await expect(
        getAdminPool().query(
          `UPDATE roles SET mfa_required = false WHERE tenant_id = $1 AND key = $2`,
          [tenant, key],
        ),
      ).rejects.toThrow(/MFA is mandatory/);
    }

    await getAdminPool().query(
      `UPDATE roles SET mfa_required = false WHERE tenant_id = $1 AND key = 'sales_cashier'`,
      [tenant],
    );
  });
});
