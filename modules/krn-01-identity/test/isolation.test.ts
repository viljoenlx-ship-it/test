import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { tenantId } from '@omnivate/shared';
import { withTenant } from '@omnivate/kernel';
import { afterAll, describe, expect, it } from 'vitest';
import {
  authChallenges,
  closePools,
  getAdminPool,
  getAppPool,
  loginAttempts,
  memberships,
  rolePermissions,
  roles,
  schema,
  sessions,
  sodRules,
  tenantModules,
  userInvites,
  userRoles,
  users,
} from '@omnivate/db';

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current instanceof Error; depth += 1) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join('\n');
}

describe('KRN-01 tenant isolation', () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const roleA = randomUUID();
  const roleB = randomUUID();
  const admin = () => drizzle(getAdminPool(), { schema });

  afterAll(async () => {
    const pool = getAdminPool();
    await pool.query('ALTER TABLE tenant_modules DISABLE TRIGGER tenant_modules_root_required');
    try {
      await pool.query('DELETE FROM login_attempts WHERE tenant_id = ANY($1::uuid[])', [
        [tenantA, tenantB],
      ]);
      await pool.query('DELETE FROM auth_challenges WHERE tenant_id = ANY($1::uuid[])', [
        [tenantA, tenantB],
      ]);
      await pool.query('DELETE FROM sessions WHERE tenant_id = ANY($1::uuid[])', [
        [tenantA, tenantB],
      ]);
      await pool.query('DELETE FROM user_invites WHERE tenant_id = ANY($1::uuid[])', [
        [tenantA, tenantB],
      ]);
      await pool.query('DELETE FROM user_roles WHERE tenant_id = ANY($1::uuid[])', [
        [tenantA, tenantB],
      ]);
      await pool.query('DELETE FROM role_permissions WHERE tenant_id = ANY($1::uuid[])', [
        [tenantA, tenantB],
      ]);
      await pool.query('DELETE FROM sod_rules WHERE tenant_id = ANY($1::uuid[])', [
        [tenantA, tenantB],
      ]);
      await pool.query('DELETE FROM tenant_modules WHERE tenant_id = ANY($1::uuid[])', [
        [tenantA, tenantB],
      ]);
      await pool.query('DELETE FROM memberships WHERE tenant_id = ANY($1::uuid[])', [
        [tenantA, tenantB],
      ]);
      await pool.query('DELETE FROM roles WHERE tenant_id = ANY($1::uuid[])', [[tenantA, tenantB]]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userA, userB]]);
      await pool.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    } finally {
      await pool.query('ALTER TABLE tenant_modules ENABLE TRIGGER tenant_modules_root_required');
      await closePools();
    }
  });

  it('hides every new table from the other tenant and from an unscoped query', async () => {
    const db = admin();
    await db.insert(schema.tenants).values([
      {
        id: tenantA,
        slug: `iso-a-${tenantA.slice(0, 8)}`,
        displayName: 'Isolation A',
        isDemo: false,
        timezone: 'Africa/Johannesburg',
        currencyCode: 'ZAR',
      },
      {
        id: tenantB,
        slug: `iso-b-${tenantB.slice(0, 8)}`,
        displayName: 'Isolation B',
        isDemo: false,
        timezone: 'Africa/Johannesburg',
        currencyCode: 'ZAR',
      },
    ]);
    await db.insert(users).values([
      {
        id: userA,
        email: `a-${userA}@example.com`,
        displayName: 'Person A',
        passwordHash: 'not-a-real-hash',
        status: 'active',
        totpEnabled: false,
      },
      {
        id: userB,
        email: `b-${userB}@example.com`,
        displayName: 'Person B',
        passwordHash: 'not-a-real-hash',
        status: 'active',
        totpEnabled: false,
      },
    ]);
    await db.insert(memberships).values([
      { id: randomUUID(), tenantId: tenantA, userId: userA, status: 'active' },
      { id: randomUUID(), tenantId: tenantB, userId: userB, status: 'active' },
    ]);
    await db.insert(roles).values([
      {
        id: roleA,
        tenantId: tenantA,
        key: 'sales_cashier',
        name: 'Cashier A',
        description: 'Fixture',
        mfaRequired: false,
        isSystem: false,
      },
      {
        id: roleB,
        tenantId: tenantB,
        key: 'sales_cashier',
        name: 'Cashier B',
        description: 'Fixture',
        mfaRequired: false,
        isSystem: false,
      },
    ]);
    await db.insert(rolePermissions).values([
      {
        id: randomUUID(),
        tenantId: tenantA,
        roleId: roleA,
        scope: 'krn',
        modules: ['KRN-01'],
        action: 'read',
        accessLabel: 'Read Only',
        approvalLimitCents: null,
      },
      {
        id: randomUUID(),
        tenantId: tenantB,
        roleId: roleB,
        scope: 'krn',
        modules: ['KRN-01'],
        action: 'read',
        accessLabel: 'Read Only',
        approvalLimitCents: 100n,
      },
    ]);
    await db.insert(userRoles).values([
      { id: randomUUID(), tenantId: tenantA, userId: userA, roleId: roleA, assignedBy: null },
      { id: randomUUID(), tenantId: tenantB, userId: userB, roleId: roleB, assignedBy: null },
    ]);
    await db.insert(userInvites).values([
      {
        id: randomUUID(),
        tenantId: tenantA,
        email: 'invite-a@example.com',
        roleId: roleA,
        tokenHash: `hash-a-${tenantA}`,
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      },
      {
        id: randomUUID(),
        tenantId: tenantB,
        email: 'invite-b@example.com',
        roleId: roleB,
        tokenHash: `hash-b-${tenantB}`,
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      },
    ]);
    await db.insert(sessions).values([
      {
        id: randomUUID(),
        tenantId: tenantA,
        userId: userA,
        tokenHash: `session-a-${tenantA}`,
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      },
      {
        id: randomUUID(),
        tenantId: tenantB,
        userId: userB,
        tokenHash: `session-b-${tenantB}`,
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      },
    ]);
    await db.insert(authChallenges).values([
      {
        id: randomUUID(),
        tenantId: tenantA,
        userId: userA,
        purpose: 'mfa_verify',
        tokenHash: `challenge-a-${tenantA}`,
        failedAttempts: 0,
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      },
      {
        id: randomUUID(),
        tenantId: tenantB,
        userId: userB,
        purpose: 'mfa_verify',
        tokenHash: `challenge-b-${tenantB}`,
        failedAttempts: 0,
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      },
    ]);
    await db.insert(loginAttempts).values([
      {
        id: randomUUID(),
        tenantId: tenantA,
        userId: userA,
        email: 'a@example.com',
        succeeded: false,
      },
      {
        id: randomUUID(),
        tenantId: tenantB,
        userId: userB,
        email: 'b@example.com',
        succeeded: false,
      },
    ]);
    await db.insert(sodRules).values([
      {
        id: randomUUID(),
        tenantId: tenantA,
        actionA: 'fixture.check',
        actionB: 'fixture.make',
        description: 'A',
        enabled: true,
      },
      {
        id: randomUUID(),
        tenantId: tenantB,
        actionA: 'fixture.check',
        actionB: 'fixture.make',
        description: 'B',
        enabled: true,
      },
    ]);
    await db.insert(tenantModules).values([
      { tenantId: tenantA, moduleId: 'KRN-01', active: true },
      { tenantId: tenantB, moduleId: 'KRN-01', active: true },
    ]);

    const visibleUsers = await withTenant(tenantId(tenantA), (tx) =>
      tx.db.select({ id: users.id }).from(users),
    );
    expect(visibleUsers.map((row) => row.id)).toEqual([userA]);

    const checks: [string, () => Promise<{ tenantId?: string; id?: string }[]>][] = [
      [
        'memberships',
        () =>
          withTenant(tenantId(tenantA), (tx) =>
            tx.db.select({ tenantId: memberships.tenantId }).from(memberships),
          ),
      ],
      [
        'roles',
        () => withTenant(tenantId(tenantA), (tx) => tx.db.select({ id: roles.id }).from(roles)),
      ],
      [
        'role_permissions',
        () =>
          withTenant(tenantId(tenantA), (tx) =>
            tx.db.select({ tenantId: rolePermissions.tenantId }).from(rolePermissions),
          ),
      ],
      [
        'user_roles',
        () =>
          withTenant(tenantId(tenantA), (tx) =>
            tx.db.select({ tenantId: userRoles.tenantId }).from(userRoles),
          ),
      ],
      [
        'user_invites',
        () =>
          withTenant(tenantId(tenantA), (tx) =>
            tx.db.select({ tenantId: userInvites.tenantId }).from(userInvites),
          ),
      ],
      [
        'sessions',
        () =>
          withTenant(tenantId(tenantA), (tx) =>
            tx.db.select({ tenantId: sessions.tenantId }).from(sessions),
          ),
      ],
      [
        'auth_challenges',
        () =>
          withTenant(tenantId(tenantA), (tx) =>
            tx.db.select({ tenantId: authChallenges.tenantId }).from(authChallenges),
          ),
      ],
      [
        'login_attempts',
        () =>
          withTenant(tenantId(tenantA), (tx) =>
            tx.db.select({ tenantId: loginAttempts.tenantId }).from(loginAttempts),
          ),
      ],
      [
        'sod_rules',
        () =>
          withTenant(tenantId(tenantA), (tx) =>
            tx.db.select({ tenantId: sodRules.tenantId }).from(sodRules),
          ),
      ],
      [
        'tenant_modules',
        () =>
          withTenant(tenantId(tenantA), (tx) =>
            tx.db.select({ tenantId: tenantModules.tenantId }).from(tenantModules),
          ),
      ],
    ];

    for (const [name, load] of checks) {
      const rows = await load();
      expect(rows.length, name).toBeGreaterThan(0);
      expect(
        rows.every((row) => row.tenantId === tenantA || row.id === roleA),
        name,
      ).toBe(true);
    }

    const hiddenRole = await withTenant(tenantId(tenantA), (tx) =>
      tx.db.select().from(roles).where(eq(roles.id, roleB)),
    );
    expect(hiddenRole).toEqual([]);

    for (const table of [
      'memberships',
      'roles',
      'role_permissions',
      'user_roles',
      'user_invites',
      'sessions',
      'auth_challenges',
      'login_attempts',
      'sod_rules',
      'tenant_modules',
      'users',
    ]) {
      const unscoped = await getAppPool().query(`SELECT 1 FROM ${table}`);
      expect(unscoped.rowCount, table).toBe(0);
    }

    await expect(getAppPool().query('SELECT password_hash FROM users')).rejects.toThrow(
      /permission denied/i,
    );

    try {
      await withTenant(tenantId(tenantA), async (tx) => {
        await tx.db.insert(sodRules).values({
          tenantId: tenantB,
          actionA: 'aaa.one',
          actionB: 'bbb.two',
          description: 'smuggled',
          enabled: true,
        });
      });
      expect.fail('A tenant must not insert a rule for another tenant.');
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('A tenant must not')) {
        throw error;
      }
      expect(errorText(error)).toMatch(/row-level security/i);
    }
  });
});
