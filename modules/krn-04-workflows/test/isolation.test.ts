import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { tenantId } from '@omnivate/shared';
import { withTenant } from '@omnivate/kernel';
import { afterAll, describe, expect, it } from 'vitest';
import { closePools, getAdminPool, getAppPool } from '@omnivate/db';
import { fieldDefinitions } from '../src/tables';

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current instanceof Error; depth += 1) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join('\n');
}

describe('KRN-04 tenant isolation', () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = randomUUID();
  const fieldA = randomUUID();
  const fieldB = randomUUID();
  const valueA = randomUUID();
  const pipelineA = randomUUID();
  const pipelineB = randomUUID();
  const instanceA = randomUUID();
  const logA = randomUUID();
  const ruleA = randomUUID();
  const noteA = randomUUID();
  const entityA = randomUUID();
  const automationA = randomUUID();
  const runA = randomUUID();

  afterAll(async () => {
    const pool = getAdminPool();
    const tenants = [tenantA, tenantB];
    await pool.query('DELETE FROM krn04_automation_runs WHERE tenant_id = ANY($1::uuid[])', [
      tenants,
    ]);
    await pool.query('DELETE FROM krn04_automations WHERE tenant_id = ANY($1::uuid[])', [tenants]);
    await pool.query('DELETE FROM krn04_notifications WHERE tenant_id = ANY($1::uuid[])', [
      tenants,
    ]);
    await pool.query('DELETE FROM krn04_transition_log WHERE tenant_id = ANY($1::uuid[])', [
      tenants,
    ]);
    await pool.query('DELETE FROM krn04_instances WHERE tenant_id = ANY($1::uuid[])', [tenants]);
    await pool.query('DELETE FROM krn04_workflow_rules WHERE tenant_id = ANY($1::uuid[])', [
      tenants,
    ]);
    await pool.query('DELETE FROM krn04_field_values WHERE tenant_id = ANY($1::uuid[])', [tenants]);
    await pool.query('DELETE FROM krn04_field_definitions WHERE tenant_id = ANY($1::uuid[])', [
      tenants,
    ]);
    await pool.query('DELETE FROM krn04_pipelines WHERE tenant_id = ANY($1::uuid[])', [tenants]);
    await pool.query('DELETE FROM users WHERE id = $1', [userA]);
    await pool.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [tenants]);
    await closePools();
  });

  it('hides every KRN-04 table from the other tenant, from a query with no tenant, and blocks a hard delete', async () => {
    const pool = getAdminPool();
    await pool.query(
      `INSERT INTO tenants (id, slug, display_name, is_demo, timezone, currency_code)
       VALUES ($1, $2, 'Isolation A', false, 'Africa/Johannesburg', 'ZAR'),
              ($3, $4, 'Isolation B', false, 'Africa/Johannesburg', 'ZAR')`,
      [tenantA, `iso-a-${tenantA.slice(0, 8)}`, tenantB, `iso-b-${tenantB.slice(0, 8)}`],
    );
    await pool.query(
      `INSERT INTO users (id, email, display_name, password_hash, status, totp_enabled)
       VALUES ($1, $2, 'Person A', 'not-a-real-hash', 'active', false)`,
      [userA, `a-${userA}@example.com`],
    );
    await pool.query(
      `INSERT INTO krn04_field_definitions (
         id, tenant_id, entity_type, entity_label, field_key, label, field_type, required, sort_order, options
       ) VALUES
       ($1, $2, 'krn04.sample_job', 'Sample job card', 'note_a', 'Note A', 'text', false, 0, '[]'),
       ($3, $4, 'krn04.sample_job', 'Sample job card', 'note_b', 'Note B', 'text', false, 0, '[]')`,
      [fieldA, tenantA, fieldB, tenantB],
    );
    await pool.query(
      `INSERT INTO krn04_field_values (id, tenant_id, entity_type, entity_id, values)
       VALUES ($1, $2, 'krn04.sample_job', $3, '{"note_a":"only A"}')`,
      [valueA, tenantA, entityA],
    );
    await pool.query(
      `INSERT INTO krn04_pipelines (
         id, tenant_id, machine_key, entity_type, entity_label, label, base_states, base_transitions
       ) VALUES
       ($1, $2, 'krn04.sample_job', 'krn04.sample_job', 'Sample job card', 'A', '[]', '[]'),
       ($3, $4, 'krn04.sample_job', 'krn04.sample_job', 'Sample job card', 'B', '[]', '[]')`,
      [pipelineA, tenantA, pipelineB, tenantB],
    );
    await pool.query(
      `INSERT INTO krn04_instances (id, tenant_id, pipeline_id, entity_id, state_key)
       VALUES ($1, $2, $3, $4, 'draft')`,
      [instanceA, tenantA, pipelineA, entityA],
    );
    await pool.query(
      `INSERT INTO krn04_transition_log (
         id, tenant_id, pipeline_id, entity_id, transition_key, from_state, to_state
       ) VALUES ($1, $2, $3, $4, 'start', 'draft', 'in_progress')`,
      [logA, tenantA, pipelineA, entityA],
    );
    await pool.query(
      `INSERT INTO krn04_workflow_rules (
         id, tenant_id, name, entity_type, trigger_kind, event_key, conditions, action_kind, action_config
       ) VALUES (
         $1, $2, 'A only', 'krn04.sample_job', 'event', 'fields.saved', '[]', 'audit', '{"message":"A"}'
       )`,
      [ruleA, tenantA],
    );
    await pool.query(
      `INSERT INTO krn04_notifications (id, tenant_id, user_id, title, body)
       VALUES ($1, $2, $3, 'Only A', 'Hidden from everyone else.')`,
      [noteA, tenantA, userA],
    );
    await pool.query(
      `INSERT INTO krn04_automations (
         id, tenant_id, name, entity_type, trigger_kind, field_key, conditions, actions, enabled, sort_order
       ) VALUES (
         $1, $2, 'Only A', 'krn04.sample_job', 'field_changed', 'note_a', '[]',
         '[{"kind":"notify","audience":"role","roleKey":"tenant_owner","userId":null,"title":"Hi","body":"There"}]',
         true, 0
       )`,
      [automationA, tenantA],
    );
    await pool.query(
      `INSERT INTO krn04_automation_runs (
         id, tenant_id, automation_id, entity_type, entity_id, status, summary, depth
       ) VALUES ($1, $2, $3, 'krn04.sample_job', $4, 'ran', 'Ran for A.', 0)`,
      [runA, tenantA, automationA, entityA],
    );

    const asA = await withTenant(tenantId(tenantA), async (tx) =>
      tx.db.select({ id: fieldDefinitions.id }).from(fieldDefinitions),
    );
    expect(asA.map((row) => row.id)).toEqual([fieldA]);

    const hidden = await withTenant(tenantId(tenantA), async (tx) => {
      const fields = await tx.db.execute<{ id: string }>(
        sql`select id from krn04_field_values where id = ${valueA}`,
      );
      const other = await tx.db.execute<{ id: string }>(
        sql`select id from krn04_pipelines where id = ${pipelineB}`,
      );
      const rules = await tx.db.execute<{ id: string }>(sql`select id from krn04_workflow_rules`);
      const logs = await tx.db.execute<{ id: string }>(sql`select id from krn04_transition_log`);
      const instances = await tx.db.execute<{ id: string }>(sql`select id from krn04_instances`);
      return {
        values: fields.rows.length,
        otherPipeline: other.rows.length,
        rules: rules.rows.length,
        logs: logs.rows.length,
        instances: instances.rows.length,
      };
    });
    expect(hidden).toEqual({ values: 1, otherPipeline: 0, rules: 1, logs: 1, instances: 1 });

    const notes = await withTenant(tenantId(tenantA), async (tx) => {
      await tx.db.execute(sql`select set_config('app.current_user_id', ${userA}, true)`);
      return tx.db.execute<{ title: string }>(sql`select title from krn04_notifications`);
    });
    expect(notes.rows.map((row) => row.title)).toEqual(['Only A']);

    const hiddenNotes = await withTenant(tenantId(tenantB), async (tx) => {
      await tx.db.execute(sql`select set_config('app.current_user_id', ${userA}, true)`);
      return tx.db.execute(sql`select id from krn04_notifications`);
    });
    expect(hiddenNotes.rows).toEqual([]);

    const unscoped = await getAppPool().query('SELECT id FROM krn04_field_definitions');
    expect(unscoped.rowCount).toBe(0);
    const unscopedNotes = await getAppPool().query('SELECT id FROM krn04_notifications');
    expect(unscopedNotes.rowCount).toBe(0);
    const unscopedAutomations = await getAppPool().query('SELECT id FROM krn04_automations');
    expect(unscopedAutomations.rowCount).toBe(0);
    const asARuns = await withTenant(tenantId(tenantA), async (tx) =>
      tx.db.execute<{ id: string }>(sql`select id from krn04_automation_runs`),
    );
    expect(asARuns.rows).toHaveLength(1);
    const hiddenRuns = await withTenant(tenantId(tenantB), async (tx) =>
      tx.db.execute(sql`select id from krn04_automations`),
    );
    expect(hiddenRuns.rows).toEqual([]);

    try {
      await withTenant(tenantId(tenantA), async (tx) => {
        await tx.db.insert(fieldDefinitions).values({
          tenantId: tenantB,
          entityType: 'krn04.sample_job',
          entityLabel: 'Sample job card',
          fieldKey: 'smuggled',
          label: 'Smuggled',
          fieldType: 'text',
          required: false,
          description: '',
          sortOrder: 3,
          options: [],
        });
      });
      expect.fail('A tenant must not insert a field for another tenant.');
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('A tenant must not')) {
        throw error;
      }
      expect(errorText(error)).toMatch(/row-level security/i);
    }

    try {
      await withTenant(tenantId(tenantA), async (tx) => {
        await tx.db.delete(fieldDefinitions);
      });
      expect.fail('Definitions are archived, not deleted.');
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Definitions are')) {
        throw error;
      }
      expect(errorText(error)).toMatch(/archive this row/i);
    }

    const stillThere = await pool.query('SELECT id FROM krn04_field_definitions WHERE id = $1', [
      fieldA,
    ]);
    expect(stillThere.rowCount).toBe(1);

    try {
      await withTenant(tenantId(tenantA), async (tx) => {
        await tx.db.execute(sql`delete from krn04_automations where id = ${automationA}`);
      });
      expect.fail('Automations are archived, not deleted.');
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Automations are')) {
        throw error;
      }
      expect(errorText(error)).toMatch(/archive this row/i);
    }

    try {
      await withTenant(tenantId(tenantA), async (tx) => {
        await tx.db.execute(
          sql`update krn04_automation_runs set summary = 'changed' where id = ${runA}`,
        );
      });
      expect.fail('Runs are append-only.');
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Runs are')) {
        throw error;
      }
      expect(errorText(error)).toMatch(/append-only/i);
    }
  });
});
