import type pg from 'pg';
import { and, eq } from 'drizzle-orm';
import {
  brandColours,
  DEMO_PASSWORD,
  demoAccounts,
  demoTenants,
  platformOperator,
  PLATFORM_ROLES,
  presetTenantSettings,
  southAfricaPreset,
} from '@omnivate/shared';
import { hashPassword } from './password';
import { createAdminDatabase } from './pools';
import { seedDemoBranches } from './seed-branches';
import { seedKrn04 } from './seed-krn04';
import { seedParties } from './seed-parties';
import { seedGoodsReceipts } from './seed-goods-receipts';
import { seedReadyReports } from './seed-reports';
import { clearSalesDemo, seedSales } from './seed-sales';
import { seedScm01 } from './scm01-seed';
import { seedTenantRbac } from './seed-access';
import {
  auditEvents,
  foundationNotes,
  foundationPostings,
  memberships,
  platformOperatorRoles,
  platformOperators,
  tenants,
  userRoles,
  users,
} from './schema';

/**
 * Posted journals point at contacts. Clear them before the contact seed replaces those rows.
 * USER skips the foreign-key triggers. A database owner that is not a superuser cannot
 * disable those, and the append-only triggers are the only ones this seed needs off.
 */
async function clearLedgerDemo(pool: pg.Pool): Promise<void> {
  const ids = demoTenants.map((tenant) => tenant.id);
  const tables = ['fin01_journal_lines', 'fin01_journals', 'fin01_cost_snapshots'] as const;
  for (const table of tables) {
    await pool.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
  }
  try {
    await pool.query(`DELETE FROM fin01_journal_lines WHERE tenant_id = ANY($1::uuid[])`, [ids]);
    await pool.query(
      `UPDATE fin01_journals SET reverses_journal_id = NULL WHERE tenant_id = ANY($1::uuid[])`,
      [ids],
    );
    await pool.query(`DELETE FROM fin01_journals WHERE tenant_id = ANY($1::uuid[])`, [ids]);
    await pool.query(`DELETE FROM fin01_cost_snapshots WHERE tenant_id = ANY($1::uuid[])`, [ids]);
    await pool.query(`DELETE FROM fin01_party_codes WHERE tenant_id = ANY($1::uuid[])`, [ids]);
  } finally {
    for (const table of tables) {
      await pool.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    }
  }
}

const fixtures = [
  {
    tenant: demoTenants[0],
    industryPreset: 'retail_hardware',
    noteId: '33333333-3333-4333-8333-333333333333',
    postingId: '55555555-5555-4555-8555-555555555555',
    auditId: '77777777-7777-4777-8777-777777777777',
    amountCents: 125_000n,
  },
  {
    tenant: demoTenants[1],
    industryPreset: 'manufacturing',
    noteId: '44444444-4444-4444-8444-444444444444',
    postingId: '66666666-6666-4666-8666-666666666666',
    auditId: '88888888-8888-4888-8888-888888888888',
    amountCents: 8_800n,
  },
] as const;

const postedAt = new Date('2026-03-01T00:00:00.000Z');

/**
 * Inserts the two fictional demo tenants. Safe to run more than once.
 * Uses the admin connection because seeding writes rows for every tenant.
 */
const demoSeedAudits = {
  '11111111-1111-4111-8111-111111111111': 'a9999999-9999-4999-8999-999999999991',
  '22222222-2222-4222-8222-222222222222': 'b9999999-9999-4999-8999-999999999992',
} as const;

export async function seed(): Promise<void> {
  const { pool, db } = createAdminDatabase();
  try {
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const settings = presetTenantSettings();
    for (const fixture of fixtures) {
      const tenant = fixture.tenant;
      const particulars = {
        slug: tenant.slug,
        displayName: tenant.displayName,
        companyName: tenant.displayName,
        legalName: tenant.displayName,
        tradingName: tenant.displayName,
        addressCity: tenant.city,
        addressCountry: 'ZA',
        industryPreset: fixture.industryPreset,
        status: 'active',
        suspendedAt: null,
        archivedAt: null,
        packageKey: 'core',
        isDemo: true,
        timezone: settings.timeZone,
        currencyCode: settings.currencyCode,
        vatRateBasisPoints: settings.vatRateBasisPoints,
        financialYearStartMonth: settings.financialYearStartMonth,
        brandPrimary: brandColours.indigo,
        brandAccent: brandColours.teal,
        vatNumber: tenant.id.startsWith('1111') ? '4999999991' : '4999999992',
      };
      await db
        .insert(tenants)
        .values({
          id: tenant.id,
          ...particulars,
        })
        .onConflictDoUpdate({
          target: tenants.id,
          set: particulars,
        });

      await db
        .insert(foundationNotes)
        .values({
          id: fixture.noteId,
          tenantId: tenant.id,
          body: tenant.note,
        })
        .onConflictDoUpdate({
          target: foundationNotes.id,
          set: { body: tenant.note },
        });

      await db
        .insert(foundationPostings)
        .values({
          id: fixture.postingId,
          tenantId: tenant.id,
          status: 'posted',
          description: 'Fictional opening marker',
          amountCents: fixture.amountCents,
          currencyCode: southAfricaPreset.currency,
          postedAt,
        })
        .onConflictDoNothing();

      await db
        .insert(auditEvents)
        .values({
          id: fixture.auditId,
          tenantId: tenant.id,
          actorId: null,
          action: 'seed.demo_tenant',
          entityType: 'tenant',
          entityId: tenant.id,
          beforeData: null,
          afterData: { slug: tenant.slug, fictional: true },
          requestIp: null,
          userAgent: 'omnivate-seed',
        })
        .onConflictDoNothing();

      const roleIds = await seedTenantRbac(db, tenant.id);
      const people = demoAccounts.filter((account) => account.tenantId === tenant.id);
      for (const person of people) {
        await db
          .insert(users)
          .values({
            id: person.id,
            email: person.email,
            displayName: person.displayName,
            passwordHash,
            status: 'active',
            totpEnabled: false,
          })
          .onConflictDoUpdate({
            target: users.id,
            set: {
              email: person.email,
              displayName: person.displayName,
              passwordHash,
              status: 'active',
            },
          });

        await db
          .insert(memberships)
          .values({
            tenantId: tenant.id,
            userId: person.id,
            status: 'active',
          })
          .onConflictDoUpdate({
            target: [memberships.tenantId, memberships.userId],
            set: { status: 'active' },
          });

        const roleId = roleIds.get(person.roleKey);
        if (!roleId) {
          throw new Error(`No seeded role ${person.roleKey}.`);
        }
        await db
          .delete(userRoles)
          .where(and(eq(userRoles.tenantId, tenant.id), eq(userRoles.userId, person.id)));
        await db.insert(userRoles).values({
          tenantId: tenant.id,
          userId: person.id,
          roleId,
          assignedBy: null,
        });
      }

      const auditId = demoSeedAudits[tenant.id];
      await db
        .insert(auditEvents)
        .values({
          id: auditId,
          tenantId: tenant.id,
          actorId: null,
          action: 'seed.demo_users',
          entityType: 'tenant',
          entityId: tenant.id,
          beforeData: null,
          afterData: {
            fictional: true,
            emails: people.map((person) => person.email),
          },
          requestIp: null,
          userAgent: 'omnivate-seed',
        })
        .onConflictDoNothing();
    }

    await seedDemoBranches(pool);
    await seedKrn04(pool);
    await seedKrn04(pool);

    const ownerRole = PLATFORM_ROLES.find((role) => role.key === 'platform_owner');
    if (!ownerRole) {
      throw new Error('Platform owner role is missing from the catalog.');
    }
    await db
      .insert(platformOperators)
      .values({
        id: platformOperator.id,
        email: platformOperator.email,
        displayName: platformOperator.displayName,
        passwordHash,
        status: 'active',
        totpEnabled: false,
      })
      .onConflictDoUpdate({
        target: platformOperators.id,
        set: {
          email: platformOperator.email,
          displayName: platformOperator.displayName,
          passwordHash,
          status: 'active',
        },
      });
    await db
      .insert(platformOperatorRoles)
      .values({ operatorId: platformOperator.id, roleId: ownerRole.id })
      .onConflictDoNothing();
    await pool.query(
      'ALTER TABLE scm01_goods_receipt_lines DISABLE TRIGGER scm01_goods_receipt_lines_append_only',
    );
    await pool.query(
      'ALTER TABLE scm01_goods_receipts DISABLE TRIGGER scm01_goods_receipts_append_only',
    );
    await pool.query(
      `DELETE FROM scm01_goods_receipt_lines
       WHERE goods_receipt_id IN (
         'a4111111-1111-4111-8111-111111111301',
         'a4111111-1111-4111-8111-111111111302',
         'a4111111-1111-4111-8111-111111111303'
       )`,
    );
    await pool.query(
      `DELETE FROM scm01_goods_receipts
       WHERE id IN (
         'a4111111-1111-4111-8111-111111111301',
         'a4111111-1111-4111-8111-111111111302',
         'a4111111-1111-4111-8111-111111111303'
       )`,
    );
    await pool.query(
      'ALTER TABLE scm01_goods_receipt_lines ENABLE TRIGGER scm01_goods_receipt_lines_append_only',
    );
    await pool.query(
      'ALTER TABLE scm01_goods_receipts ENABLE TRIGGER scm01_goods_receipts_append_only',
    );
    await clearSalesDemo(pool);
    await clearLedgerDemo(pool);
    await seedParties(pool);
    await seedScm01(pool);
    await seedGoodsReceipts(pool);
    await pool.query(
      `INSERT INTO tenant_modules (tenant_id, module_id, active)
       SELECT tenant.id, module.id, true
       FROM (VALUES
         ('11111111-1111-4111-8111-111111111111'::uuid),
         ('22222222-2222-4222-8222-222222222222'::uuid)
       ) AS tenant(id)
       CROSS JOIN (VALUES
         ('KRN-03'),
         ('KRN-04'),
         ('KRN-06'),
         ('FIN-01'),
         ('SCM-01'),
         ('SAL-01'),
         ('FIN-02'),
         ('ANA-03')
       ) AS module(id)
       ON CONFLICT (tenant_id, module_id) DO UPDATE
       SET active = true, updated_at = now()`,
    );
    await seedReadyReports(pool);
    await seedSales(pool);
  } finally {
    await pool.end();
  }
}
