import ExcelJS from 'exceljs';
import { sql } from 'drizzle-orm';
import { tenantId } from '@omnivate/shared';
import { withTenant } from '@omnivate/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../apps/api/src/app';
import { closePools, getAdminPool } from '@omnivate/db';
import { enableModule, makeCompany, makeUser, multipart } from './support';

async function upload(
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie: string,
  file: { filename: string; type: string; data: string | Buffer },
  fields: Record<string, string>,
) {
  const body = multipart(fields, file);
  return app.inject({
    method: 'POST',
    url: '/krn/imports',
    headers: { ...body.headers, cookie },
    payload: body.payload,
  });
}

async function finish(app: Awaited<ReturnType<typeof buildApp>>, cookie: string, batchId: string) {
  let status = 'preview';
  let batch: { status: string; counts: Record<string, number>; canUndo: boolean } | null = null;
  for (let step = 0; step < 30 && status !== 'completed' && status !== 'undone'; step += 1) {
    const response = await app.inject({
      method: 'POST',
      url: `/krn/imports/${batchId}/advance`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    batch = response.json().batch;
    status = batch?.status ?? 'preview';
  }
  return batch;
}

describe('KRN-06 import, undo, and export', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie = '';
  let companyId = '';

  beforeAll(async () => {
    app = await buildApp({ checkDatabase: async () => true });
    const company = await makeCompany('import');
    companyId = company.id;
    const owner = await makeUser(company.id, 'tenant_owner', 'importer');
    cookie = owner.cookie;
    await enableModule(company.id, owner.id, 'KRN-02');
  });

  afterAll(async () => {
    await app.close();
    await closePools();
  });

  it('reports a VAT number on the spreadsheet row, then imports the good rows', async () => {
    const lines = ['Name,Email,VAT number'];
    for (let index = 0; index < 12; index += 1) {
      lines.push(`Fictional Contact ${index},contact-${index}@example.com,`);
    }
    lines.push('Bad Vat,bad-vat@example.com,123');
    const uploaded = await upload(
      app,
      cookie,
      { filename: 'contacts.csv', type: 'text/csv', data: `${lines.join('\n')}\n` },
      { targetId: 'contacts', duplicatePolicy: 'skip', vatTreatment: 'exclusive' },
    );
    expect(uploaded.statusCode).toBe(200);
    const preview = uploaded.json();
    const bad = preview.rows.find((row: { rowNumber: number }) => row.rowNumber === 14);
    expect(bad.messages).toContain('Row 14: VAT number should be 10 digits.');
    expect(preview.batch.counts.invalid).toBe(1);
    expect(preview.batch.counts.ready).toBe(12);

    const done = await finish(app, cookie, preview.batch.id);
    expect(done?.status).toBe('completed');
    expect(done?.counts.created).toBe(12);
    expect(done?.canUndo).toBe(true);

    const report = await app.inject({
      method: 'GET',
      url: `/krn/imports/${preview.batch.id}/errors`,
      headers: { cookie },
    });
    expect(report.statusCode).toBe(200);
    expect(report.body).toContain('Row 14: VAT number should be 10 digits.');

    const audit = await getAdminPool().query<{ action: string; after_data: { fileName: string } }>(
      `SELECT action, after_data FROM audit_events
       WHERE entity_id = $1 AND action = 'krn06.import.completed'`,
      [preview.batch.id],
    );
    expect(audit.rows[0]?.after_data.fileName).toBe('contacts.csv');
    expect(JSON.stringify(audit.rows[0]?.after_data)).not.toContain('bad-vat');
  });

  it('remembers a column, updates a duplicate, and undoes until something changes', async () => {
    const first = await upload(
      app,
      cookie,
      {
        filename: 'people.csv',
        type: 'text/csv',
        data: 'Company,Their tax\nNaledi Paper,4123456789\n',
      },
      { targetId: 'contacts', duplicatePolicy: 'skip', vatTreatment: 'exclusive' },
    );
    expect(first.statusCode).toBe(200);
    const batch = first.json().batch;
    expect(
      batch.columns.find((column: { header: string }) => column.header === 'Company').fieldKey,
    ).toBe('display_name');
    expect(
      batch.columns.find((column: { header: string }) => column.header === 'Their tax').fieldKey,
    ).toBeNull();

    const mapped = await app.inject({
      method: 'PUT',
      url: `/krn/imports/${batch.id}/mapping`,
      headers: { cookie, 'content-type': 'application/json' },
      payload: {
        duplicatePolicy: 'skip',
        vatTreatment: 'exclusive',
        columns: {
          Company: 'display_name',
          'Their tax': 'vat_number',
        },
      },
    });
    expect(mapped.statusCode).toBe(200);
    expect(mapped.json().batch.counts.ready).toBe(1);
    await finish(app, cookie, batch.id);

    const second = await upload(
      app,
      cookie,
      {
        filename: 'people-again.csv',
        type: 'text/csv',
        data: 'Company,Their tax\nNaledi Paper Co,4123456789\n',
      },
      { targetId: 'contacts', duplicatePolicy: 'update', vatTreatment: 'exclusive' },
    );
    const again = second.json().batch;
    expect(
      again.columns.find((column: { header: string }) => column.header === 'Their tax').fieldKey,
    ).toBe('vat_number');
    expect(again.counts.duplicate).toBe(1);
    const updated = await finish(app, cookie, again.id);
    expect(updated?.counts.updated).toBe(1);

    const exported = await app.inject({
      method: 'GET',
      url: '/krn/exports/contacts/csv',
      headers: { cookie },
    });
    expect(exported.body).toContain('Naledi Paper Co');

    const touched = await withTenant(tenantId(companyId), async (tx) => {
      await tx.db.execute(sql`
        UPDATE parties
        SET updated_at = updated_at + interval '1 minute'
        WHERE vat_number = '4123456789'
      `);
    });
    expect(touched).toBeUndefined();

    const blocked = await app.inject({
      method: 'POST',
      url: `/krn/imports/${again.id}/undo`,
      headers: { cookie },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().message).toMatch(/changed since the import/);

    const undone = await app.inject({
      method: 'POST',
      url: `/krn/imports/${batch.id}/undo`,
      headers: { cookie },
    });
    expect(undone.statusCode).toBe(409);
  });

  it('stores an inclusive rand price as exclusive cents and reverses opening stock', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Stock');
    sheet.addRow(['SKU', 'Name', 'Opening quantity', 'Unit cost']);
    sheet.addRow(['PAPER-A4', 'A4 copy paper', '1 000,5', 'R 115,00']);
    const file = Buffer.from(await workbook.xlsx.writeBuffer());

    const uploaded = await upload(
      app,
      cookie,
      {
        filename: 'stock.xlsx',
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        data: file,
      },
      { targetId: 'stock-items', duplicatePolicy: 'skip', vatTreatment: 'inclusive' },
    );
    expect(uploaded.statusCode).toBe(200);
    const batchId = uploaded.json().batch.id as string;
    const done = await finish(app, cookie, batchId);
    expect(done?.counts.created).toBe(1);

    const item = await getAdminPool().query<{
      cost_cents: string;
      quantity: string;
      branch: string;
    }>(
      `SELECT i.cost_cents::text,
              b.quantity::text AS quantity,
              br.name AS branch
       FROM scm01_items AS i
       JOIN scm01_balances AS b ON b.item_id = i.id
       JOIN krn03_branches AS br ON br.id = b.branch_id
       WHERE i.sku = 'PAPER-A4' AND i.tenant_id = $1`,
      [companyId],
    );
    expect(item.rows[0]?.cost_cents).toBe('10000');
    expect(item.rows[0]?.quantity).toBe('1000.5000');
    expect(item.rows[0]?.branch).toBe('Head Office');

    const undo = await app.inject({
      method: 'POST',
      url: `/krn/imports/${batchId}/undo`,
      headers: { cookie },
    });
    expect(undo.statusCode).toBe(200);
    expect(undo.json().batch.status).toBe('undone');

    const stillThere = await getAdminPool().query<{ status: string; kinds: string[] }>(
      `SELECT i.status,
              array_agg(m.kind ORDER BY m.kind) AS kinds
       FROM scm01_items AS i
       JOIN scm01_movements AS m ON m.item_id = i.id
       WHERE i.sku = 'PAPER-A4' AND i.tenant_id = $1
       GROUP BY i.id`,
      [companyId],
    );
    expect(stillThere.rows[0]?.status).toBe('archived');
    expect(stillThere.rows[0]?.kinds).toEqual(['receipt', 'reversal']);

    await expect(
      getAdminPool().query(`DELETE FROM scm01_movements WHERE tenant_id = $1`, [companyId]),
    ).rejects.toThrow(/append-only|GOV-03/);
  });

  it('reads a semicolon CSV', async () => {
    const uploaded = await upload(
      app,
      cookie,
      {
        filename: 'semicolon.csv',
        type: 'text/csv',
        data: 'Name;Email\nThabo Mokoena;thabo@example.com\n',
      },
      { targetId: 'contacts', duplicatePolicy: 'skip', vatTreatment: 'exclusive' },
    );
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json().batch.counts.ready).toBe(1);
  });
});
