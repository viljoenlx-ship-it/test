import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../apps/api/src/app';
import { closePools, getAdminPool } from '@omnivate/db';
import { enableModule, makeCompany, makeUser, multipart } from './support';

describe('KRN-06 large import', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ checkDatabase: async () => true });
  });

  afterAll(async () => {
    await app.close();
    await closePools();
  });

  it('imports 10,000 contacts in one batch', async () => {
    const company = await makeCompany('large');
    const owner = await makeUser(company.id, 'tenant_owner', 'large-owner');
    await enableModule(company.id, owner.id, 'KRN-02');
    const lines = ['Name,Email'];
    for (let index = 0; index < 10_000; index += 1) {
      lines.push(`Fictional Person ${index},person-${index}@large.example`);
    }
    const body = multipart(
      { targetId: 'contacts', duplicatePolicy: 'skip', vatTreatment: 'exclusive' },
      { filename: 'ten-thousand.csv', type: 'text/csv', data: `${lines.join('\n')}\n` },
    );
    const uploaded = await app.inject({
      method: 'POST',
      url: '/krn/imports',
      headers: { ...body.headers, cookie: owner.cookie },
      payload: body.payload,
    });
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json().batch.counts.total).toBe(10_000);
    const batchId = uploaded.json().batch.id as string;

    let status = 'preview';
    let created = 0;
    for (let step = 0; step < 30 && status !== 'completed'; step += 1) {
      const response = await app.inject({
        method: 'POST',
        url: `/krn/imports/${batchId}/advance`,
        headers: { cookie: owner.cookie },
      });
      expect(response.statusCode).toBe(200);
      status = response.json().batch.status;
      created = response.json().batch.counts.created;
    }
    expect(status).toBe('completed');
    expect(created).toBe(10_000);

    const stored = await getAdminPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM parties WHERE tenant_id = $1`,
      [company.id],
    );
    expect(stored.rows[0]?.count).toBe('10000');
  }, 180_000);
});
