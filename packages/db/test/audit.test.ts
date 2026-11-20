import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { tenantId } from '@omnivate/shared';
import { appendAuditEvent, withTenant } from '@omnivate/kernel';
import { afterAll, describe, expect, it } from 'vitest';
import { auditEvents, closePools, getAdminPool, getAppPool } from '@omnivate/db';

describe('GOV-02 append-only audit', () => {
  const tenant = randomUUID();

  afterAll(async () => {
    await getAdminPool().query('DELETE FROM tenants WHERE id = $1', [tenant]);
    await closePools();
  });

  it('inserts through the kernel helper and rejects update and delete', async () => {
    await getAdminPool().query(
      `INSERT INTO tenants (id, slug, display_name, is_demo, timezone, currency_code)
       VALUES ($1, $2, 'Audit fixture', false, 'Africa/Johannesburg', 'ZAR')`,
      [tenant, `audit-${tenant}`],
    );

    const entityId = randomUUID();
    await expect(
      withTenant(tenantId(tenant), async (tx) => {
        const id = await appendAuditEvent(tx, {
          action: 'fixture.create',
          entityType: 'foundation_note',
          entityId,
          actorId: null,
          beforeData: null,
          afterData: { body: 'created' },
          requestIp: '127.0.0.1',
          userAgent: 'vitest',
        });
        const rows = await tx.db.select().from(auditEvents).where(eq(auditEvents.id, id));
        expect(rows).toHaveLength(1);
        expect(rows[0]?.action).toBe('fixture.create');
        throw new Error('rollback audit fixture');
      }),
    ).rejects.toThrow(/rollback audit fixture/);

    const client = await getAppPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenant]);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO audit_events (tenant_id, action, entity_type, entity_id)
         VALUES ($1, 'fixture.create', 'foundation_note', $2)
         RETURNING id`,
        [tenant, entityId],
      );
      const id = inserted.rows[0]?.id;
      expect(id).toBeTruthy();

      await client.query('SAVEPOINT mutation');
      await expect(
        client.query('UPDATE audit_events SET action = $1 WHERE id = $2', ['tamper', id]),
      ).rejects.toThrow(/GOV-02/);
      await client.query('ROLLBACK TO SAVEPOINT mutation');

      await client.query('SAVEPOINT deletion');
      await expect(client.query('DELETE FROM audit_events WHERE id = $1', [id])).rejects.toThrow(
        /GOV-02/,
      );
      await client.query('ROLLBACK TO SAVEPOINT deletion');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
