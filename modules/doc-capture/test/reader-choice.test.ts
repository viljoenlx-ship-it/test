import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { tenantId } from '@omnivate/shared';
import { withTenant } from '@omnivate/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditEvents,
  closePools,
  getAdminPool,
  memberships,
  rolePermissions,
  roles,
  schema,
  tenantModules,
  userRoles,
  users,
} from '@omnivate/db';
import {
  captureDocument,
  captureOverview,
  presentDocument,
  processDocument,
  setCaptureEnabled,
  usagePeriod,
  type Actor,
} from '../src/service';
import { pageUsage } from '../src/schema';
import { memoryDocumentStore, setDocumentStoreForTests } from '../src/storage';
import { invoicePdf } from './invoice-fixture';

const standardTenant = randomUUID();
const premiumTenant = randomUUID();
const standardUser = randomUUID();
const premiumUser = randomUUID();
const operatorId = randomUUID();

function actor(userId: string): Actor {
  return { userId, requestIp: '127.0.0.1', userAgent: 'reader-choice' };
}

describe('per-tenant document reader', () => {
  const admin = () => drizzle(getAdminPool(), { schema });
  const savedKey = process.env.OPENAI_API_KEY;
  const savedProvider = process.env.DOCUMENT_READER_PROVIDER;
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.DOCUMENT_READER_PROVIDER;
    setDocumentStoreForTests(memoryDocumentStore());
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.includes('api.openai.com')) {
        fetchCalls += 1;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    documentType: 'tax_invoice',
                    supplierName: { value: 'Premium Fixture (Pty) Ltd', confidence: 0.99 },
                    supplierVatNumber: { value: '4000000001', confidence: 0.99 },
                    documentNumber: { value: 'PREM-9', confidence: 0.99 },
                    documentDate: { value: '2026-03-04', confidence: 0.99 },
                    dueDate: { value: '', confidence: 0.5 },
                    currency: { value: 'ZAR', confidence: 0.99 },
                    lines: [
                      {
                        description: { value: 'Sample hinge', confidence: 0.99 },
                        supplierCode: { value: '', confidence: 0.5 },
                        quantity: { value: '1', confidence: 0.99 },
                        unit: { value: 'each', confidence: 0.99 },
                        unitPriceExcl: { value: '10.00', confidence: 0.99 },
                        vat: { value: '1.50', confidence: 0.99 },
                        lineTotal: { value: '10.00', confidence: 0.99 },
                      },
                    ],
                    subtotal: { value: '10.00', confidence: 0.99 },
                    vat: { value: '1.50', confidence: 0.99 },
                    total: { value: '11.50', confidence: 0.99 },
                    pageCount: 1,
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const db = admin();
    await db.insert(schema.tenants).values([
      {
        id: standardTenant,
        slug: `std-${standardTenant.slice(0, 8)}`,
        displayName: 'Standard Reader Co',
        isDemo: false,
        timezone: 'Africa/Johannesburg',
        currencyCode: 'ZAR',
      },
      {
        id: premiumTenant,
        slug: `prm-${premiumTenant.slice(0, 8)}`,
        displayName: 'Premium Reader Co',
        isDemo: false,
        timezone: 'Africa/Johannesburg',
        currencyCode: 'ZAR',
      },
    ]);
    await db.insert(tenantModules).values([
      { tenantId: standardTenant, moduleId: 'SCM-01', active: true },
      { tenantId: standardTenant, moduleId: 'KRN-02', active: true },
      { tenantId: premiumTenant, moduleId: 'SCM-01', active: true },
      { tenantId: premiumTenant, moduleId: 'KRN-02', active: true },
    ]);
    const standardRole = randomUUID();
    const premiumRole = randomUUID();
    await db.insert(roles).values([
      {
        id: standardRole,
        tenantId: standardTenant,
        key: 'warehouse_technician',
        name: 'Warehouse',
        description: 'Test role',
        mfaRequired: false,
        isSystem: true,
      },
      {
        id: premiumRole,
        tenantId: premiumTenant,
        key: 'warehouse_technician',
        name: 'Warehouse',
        description: 'Test role',
        mfaRequired: false,
        isSystem: true,
      },
    ]);
    await db.insert(users).values([
      {
        id: standardUser,
        email: `${standardUser}@example.com`,
        displayName: 'Warehouse',
        passwordHash: 'not-a-real-hash',
        status: 'active',
        totpEnabled: false,
      },
      {
        id: premiumUser,
        email: `${premiumUser}@example.com`,
        displayName: 'Warehouse',
        passwordHash: 'not-a-real-hash',
        status: 'active',
        totpEnabled: false,
      },
    ]);
    await db.insert(memberships).values([
      { tenantId: standardTenant, userId: standardUser, status: 'active' },
      { tenantId: premiumTenant, userId: premiumUser, status: 'active' },
    ]);
    await db.insert(userRoles).values([
      { tenantId: standardTenant, userId: standardUser, roleId: standardRole },
      { tenantId: premiumTenant, userId: premiumUser, roleId: premiumRole },
    ]);
    await db.insert(rolePermissions).values([
      {
        tenantId: standardTenant,
        roleId: standardRole,
        scope: 'scm.catalog',
        modules: ['SCM-01'],
        action: 'admin',
        accessLabel: 'admin',
      },
      {
        tenantId: premiumTenant,
        roleId: premiumRole,
        scope: 'scm.catalog',
        modules: ['SCM-01'],
        action: 'admin',
        accessLabel: 'admin',
      },
    ]);
    await getAdminPool().query(
      `INSERT INTO platform_operators (id, email, display_name, password_hash, status, totp_enabled)
       VALUES ($1, $2, 'Reader Test', 'not-a-real-hash', 'active', false)`,
      [operatorId, `${operatorId}@example.com`],
    );
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = savedKey;
    }
    if (savedProvider === undefined) {
      delete process.env.DOCUMENT_READER_PROVIDER;
    } else {
      process.env.DOCUMENT_READER_PROVIDER = savedProvider;
    }
    setDocumentStoreForTests(null);
    const pool = getAdminPool();
    const ids = [standardTenant, premiumTenant];
    await pool.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only');
    try {
      await pool.query('DELETE FROM doc_receipt_links WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM doc_supplier_codes WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM doc_lines WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM doc_documents WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM doc_page_usage WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM doc_settings WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM audit_events WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM user_roles WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM role_permissions WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM memberships WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM roles WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [standardUser, premiumUser],
      ]);
      await pool.query('DELETE FROM tenant_modules WHERE tenant_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM platform_operators WHERE id = $1', [operatorId]);
    } finally {
      await pool.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only');
      await closePools();
    }
  });

  it('keeps each company on its own reader and falls back when premium has no key', async () => {
    const operator = { id: operatorId, requestIp: '127.0.0.1', userAgent: 'reader-choice' };
    const standardOverview = await withTenant(tenantId(standardTenant), (tx) =>
      setCaptureEnabled(tx, operator, true, 'standard'),
    );
    expect(standardOverview).toMatchObject({ reader: 'standard', fellBack: false, note: null });

    const premiumOverview = await withTenant(tenantId(premiumTenant), (tx) =>
      setCaptureEnabled(tx, operator, true, 'premium'),
    );
    expect(premiumOverview.reader).toBe('premium');
    expect(premiumOverview.fellBack).toBe(true);
    expect(premiumOverview.note).toMatch(/Standard Reader/);
    expect(premiumOverview.note).not.toMatch(/openai|gpt|\bai\b/i);

    const audited = await withTenant(tenantId(premiumTenant), async (tx) => {
      const rows = await tx.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, 'document.capture.settings'));
      return rows;
    });
    expect(audited).toHaveLength(1);
    expect(audited[0]?.beforeData).toMatchObject({ reader: 'standard' });
    expect(audited[0]?.afterData).toMatchObject({ reader: 'premium', enabled: true });

    const standardId = await withTenant(tenantId(standardTenant), (tx) =>
      captureDocument(tx, actor(standardUser), {
        filename: 'north-quince.pdf',
        bytes: invoicePdf(),
      }),
    );
    await processDocument(standardTenant, standardId);
    const standardView = await withTenant(tenantId(standardTenant), (tx) =>
      presentDocument(tx, actor(standardUser), standardId),
    );
    expect(fetchCalls).toBe(0);
    expect(standardView.documentNumber).toBe('NQ-2201');
    expect(standardView.supplierName).toBe('North Quince Supplies (Pty) Ltd');
    expect(standardView.lowConfidence.length).toBeGreaterThan(0);

    process.env.OPENAI_API_KEY = 'test-key-not-real';
    const premiumId = await withTenant(tenantId(premiumTenant), (tx) =>
      captureDocument(tx, actor(premiumUser), {
        filename: 'premium.pdf',
        bytes: invoicePdf(),
      }),
    );
    await processDocument(premiumTenant, premiumId);
    const premiumView = await withTenant(tenantId(premiumTenant), (tx) =>
      presentDocument(tx, actor(premiumUser), premiumId),
    );
    expect(fetchCalls).toBe(1);
    expect(premiumView.documentNumber).toBe('PREM-9');

    delete process.env.OPENAI_API_KEY;
    const fallbackId = await withTenant(tenantId(premiumTenant), (tx) =>
      captureDocument(tx, actor(premiumUser), {
        filename: 'fallback.pdf',
        bytes: invoicePdf(),
      }),
    );
    await processDocument(premiumTenant, fallbackId);
    const fallbackView = await withTenant(tenantId(premiumTenant), (tx) =>
      presentDocument(tx, actor(premiumUser), fallbackId),
    );
    expect(fetchCalls).toBe(1);
    expect(fallbackView.documentNumber).toBe('NQ-2201');
    const after = await withTenant(tenantId(premiumTenant), (tx) => captureOverview(tx));
    expect(after.note).toMatch(/no key is configured/);
    expect(after.pagesReadPremium).toBe(1);
    expect(after.pagesReadStandard).toBe(1);

    const usage = await withTenant(tenantId(premiumTenant), async (tx) => {
      return tx.db.select().from(pageUsage).where(eq(pageUsage.period, usagePeriod()));
    });
    expect(usage.find((row) => row.reader === 'premium')?.pages).toBe(1);
    expect(usage.find((row) => row.reader === 'standard')?.pages).toBe(1);

    const standardUsage = await withTenant(tenantId(standardTenant), (tx) => captureOverview(tx));
    expect(standardUsage.pagesReadStandard).toBe(1);
    expect(standardUsage.pagesReadPremium).toBe(0);
    expect(standardUsage.reader).toBe('standard');
  });
});
