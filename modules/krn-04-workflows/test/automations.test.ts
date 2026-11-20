import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { platformOperator, tenantId } from '@omnivate/shared';
import { withTenant } from '@omnivate/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closePools,
  getAdminPool,
  memberships,
  schema,
  seedTenantRbac,
  userRoles,
  users,
} from '@omnivate/db';
import { listNotifications } from '../src/notifications';
import {
  AUTOMATION_MAX_DEPTH,
  createAutomation,
  createFieldDefinition,
  installMachine,
  loadFieldValues,
  recordChanged,
  registerEntityType,
  registerStateMachine,
  resetRegistryForTests,
  saveCustomFields,
  startRecord,
  updateFieldDefinition,
  type Actor,
  type FieldDraft,
} from '../src/index';

const meta = (actorId: string): Actor => ({
  actorId,
  requestIp: null,
  userAgent: 'automation-test',
});

const operator = {
  operatorId: platformOperator.id,
  requestIp: null,
  userAgent: 'automation-test',
};

function draft(
  partial: Partial<FieldDraft> & Pick<FieldDraft, 'fieldKey' | 'label' | 'fieldType'>,
): FieldDraft {
  return {
    entityType: 'krn04.calc',
    required: false,
    description: '',
    minLength: null,
    maxLength: null,
    minNumber: null,
    maxNumber: null,
    minCents: null,
    maxCents: null,
    options: [],
    formula: null,
    formulaPlaces: null,
    formulaDisplay: null,
    formulaUnit: '',
    ...partial,
  };
}

describe('calculated fields and automations', () => {
  const company = randomUUID();
  const owner = randomUUID();
  const manager = randomUUID();
  const recordId = randomUUID();

  beforeAll(async () => {
    resetRegistryForTests();
    registerEntityType({
      key: 'krn04.calc',
      moduleId: 'KRN-04',
      label: 'Calc record',
      description: 'Test record.',
    });
    registerStateMachine({
      key: 'krn04.calc',
      entityType: 'krn04.calc',
      moduleId: 'KRN-04',
      label: 'Calc pipeline',
      states: [
        { key: 'draft', label: 'Draft', kind: 'initial' },
        { key: 'review', label: 'Review', kind: 'open' },
      ],
      transitions: [
        {
          key: 'send',
          from: 'draft',
          to: 'review',
          label: 'Send',
          permission: { scope: 'krn', action: 'operate', moduleId: 'KRN-04' },
        },
      ],
    });
    const admin = drizzle(getAdminPool(), { schema });
    await admin.insert(schema.tenants).values({
      id: company,
      slug: `calc-${company.slice(0, 8)}`,
      displayName: 'Calc company',
      isDemo: false,
      timezone: 'Africa/Johannesburg',
      currencyCode: 'ZAR',
    });
    const roles = await seedTenantRbac(admin, company);
    const ownerRole = roles.get('tenant_owner');
    const managerRole = roles.get('branch_manager');
    if (!ownerRole || !managerRole) {
      throw new Error('Roles were not seeded.');
    }
    await admin.insert(users).values([
      {
        id: owner,
        email: `owner-${owner}@example.com`,
        displayName: 'Owner',
        passwordHash: 'not-a-real-hash',
        status: 'active',
        totpEnabled: false,
      },
      {
        id: manager,
        email: `manager-${manager}@example.com`,
        displayName: 'Manager',
        passwordHash: 'not-a-real-hash',
        status: 'active',
        totpEnabled: false,
      },
    ]);
    await admin.insert(memberships).values([
      { tenantId: company, userId: owner, status: 'active' },
      { tenantId: company, userId: manager, status: 'active' },
    ]);
    await admin.insert(userRoles).values([
      { tenantId: company, userId: owner, roleId: ownerRole },
      { tenantId: company, userId: manager, roleId: managerRole },
    ]);
    await getAdminPool().query(
      `INSERT INTO platform_operators (id, email, display_name, password_hash, status, totp_enabled)
       VALUES ($1, $2, 'Platform Owner', 'not-a-real-hash', 'active', true)
       ON CONFLICT (id) DO NOTHING`,
      [platformOperator.id, platformOperator.email],
    );
    await withTenant(tenantId(company), async (tx) => {
      await createFieldDefinition(
        tx,
        operator,
        draft({ fieldKey: 'qty', label: 'Quantity', fieldType: 'number' }),
      );
      await createFieldDefinition(
        tx,
        operator,
        draft({ fieldKey: 'price', label: 'Price', fieldType: 'money' }),
      );
      await createFieldDefinition(
        tx,
        operator,
        draft({
          fieldKey: 'line_total',
          label: 'Line Total',
          fieldType: 'calculated',
          formula: 'qty * price',
          formulaPlaces: 0,
          formulaDisplay: 'money',
        }),
      );
      await createFieldDefinition(
        tx,
        operator,
        draft({ fieldKey: 'split', label: 'Split', fieldType: 'number' }),
      );
      await installMachine(tx, meta(owner), 'krn04.calc');
    });
  });

  afterAll(async () => {
    await closePools();
  });

  it('recomputes a line total in cents and refuses a typed value', async () => {
    await withTenant(tenantId(company), async (tx) => {
      await expect(
        saveCustomFields(tx, meta(owner), {
          entityType: 'krn04.calc',
          entityId: recordId,
          values: { qty: '4', price: '12.50', line_total: 1 },
        }),
      ).rejects.toThrow(/cannot type/i);

      const saved = await saveCustomFields(tx, meta(owner), {
        entityType: 'krn04.calc',
        entityId: recordId,
        values: { qty: '4', price: '12.50' },
      });
      expect(saved.line_total).toBe(5000);
    });
  });

  it('stops a formula that divides by zero', async () => {
    await withTenant(tenantId(company), async (tx) => {
      const fields = await tx.db.execute<{ id: string }>(
        sql`select id from krn04_field_definitions where field_key = 'line_total'`,
      );
      const id = fields.rows[0]?.id;
      if (!id) {
        throw new Error('Line total is missing.');
      }
      await updateFieldDefinition(tx, operator, id, { formula: 'price / split' });
      await expect(
        saveCustomFields(tx, meta(owner), {
          entityType: 'krn04.calc',
          entityId: recordId,
          values: { qty: '4', price: '12.50', split: '0' },
        }),
      ).rejects.toThrow(/divide by zero/i);
      await updateFieldDefinition(tx, operator, id, { formula: 'qty * price' });
    });
  });

  it('rejects a circular formula', async () => {
    await withTenant(tenantId(company), async (tx) => {
      await createFieldDefinition(
        tx,
        operator,
        draft({ fieldKey: 'side', label: 'Side', fieldType: 'number' }),
      );
      const area = await createFieldDefinition(
        tx,
        operator,
        draft({
          fieldKey: 'area',
          label: 'Area',
          fieldType: 'calculated',
          formula: 'side * side',
          formulaPlaces: 2,
          formulaDisplay: 'number',
          formulaUnit: 'm²',
        }),
      );
      await createFieldDefinition(
        tx,
        operator,
        draft({
          fieldKey: 'copy',
          label: 'Copy',
          fieldType: 'calculated',
          formula: 'area * 2',
          formulaPlaces: 2,
          formulaDisplay: 'number',
        }),
      );
      await expect(
        updateFieldDefinition(tx, operator, area.id, { formula: 'copy * 2' }),
      ).rejects.toThrow(/Area uses Copy/);
    });
  });

  it('runs rules in order, writes an audit row, and stops a loop', async () => {
    await withTenant(tenantId(company), async (tx) => {
      await createFieldDefinition(
        tx,
        operator,
        draft({ fieldKey: 'marker', label: 'Marker', fieldType: 'number' }),
      );
      const first = await createAutomation(tx, operator, {
        name: 'First',
        entityType: 'krn04.calc',
        triggerKind: 'field_changed',
        fieldKey: 'qty',
        conditions: [],
        actions: [
          { kind: 'set_field', fieldKey: 'marker', mode: 'value', value: '1', formula: null },
        ],
        enabled: true,
      });
      await createAutomation(tx, operator, {
        name: 'Second',
        entityType: 'krn04.calc',
        triggerKind: 'field_changed',
        fieldKey: 'qty',
        conditions: [],
        actions: [
          { kind: 'set_field', fieldKey: 'marker', mode: 'value', value: '2', formula: null },
        ],
        enabled: true,
      });
      await saveCustomFields(tx, meta(owner), {
        entityType: 'krn04.calc',
        entityId: recordId,
        values: { qty: '5', price: '12.50' },
      });
      const values = await loadFieldValues(tx, 'krn04.calc', recordId);
      expect(values.marker).toBe('2');

      const runs = await tx.db.execute<{ name: string; status: string }>(
        sql`select a.name, r.status
            from krn04_automation_runs r
            join krn04_automations a on a.id = r.automation_id
            where r.entity_id = ${recordId}
            order by r.occurred_at`,
      );
      expect(runs.rows.map((row) => row.name)).toEqual(['First', 'Second']);

      const audit = await tx.db.execute<{ action: string }>(
        sql`select action from audit_events
            where entity_id = ${recordId} and action = 'workflow.automation.ran'`,
      );
      expect(audit.rows.length).toBeGreaterThanOrEqual(2);

      await createAutomation(tx, operator, {
        name: 'Loop',
        entityType: 'krn04.calc',
        triggerKind: 'field_changed',
        fieldKey: 'marker',
        conditions: [],
        actions: [
          {
            kind: 'set_field',
            fieldKey: 'marker',
            mode: 'formula',
            value: null,
            formula: 'marker + 1',
          },
        ],
        enabled: true,
      });
      await saveCustomFields(tx, meta(owner), {
        entityType: 'krn04.calc',
        entityId: recordId,
        values: { qty: '5', price: '12.50', marker: '1' },
      });
      const afterLoop = await loadFieldValues(tx, 'krn04.calc', recordId);
      expect(afterLoop.marker).toBe('2');
      const stopped = await tx.db.execute<{ summary: string }>(
        sql`select summary from krn04_automation_runs where automation_id = (
              select id from krn04_automations where name = 'Loop' and tenant_id = ${company}
            ) and status = 'stopped'`,
      );
      expect(stopped.rows.length).toBeGreaterThan(0);
      expect(first.id).toBeTruthy();
    });
  });

  it('stops a chain at the maximum depth', async () => {
    const entityId = randomUUID();
    await withTenant(tenantId(company), async (tx) => {
      for (let index = 0; index <= AUTOMATION_MAX_DEPTH + 1; index += 1) {
        await createFieldDefinition(
          tx,
          operator,
          draft({ fieldKey: `step_${index}`, label: `Step ${index}`, fieldType: 'number' }),
        );
      }
      for (let index = 0; index <= AUTOMATION_MAX_DEPTH; index += 1) {
        await createAutomation(tx, operator, {
          name: `Step ${index}`,
          entityType: 'krn04.calc',
          triggerKind: 'field_changed',
          fieldKey: `step_${index}`,
          conditions: [],
          actions: [
            {
              kind: 'set_field',
              fieldKey: `step_${index + 1}`,
              mode: 'value',
              value: '1',
              formula: null,
            },
          ],
          enabled: true,
        });
      }
      await saveCustomFields(tx, meta(owner), {
        entityType: 'krn04.calc',
        entityId,
        values: { step_0: '1' },
      });
      await recordChanged(
        tx,
        { actorId: owner, requestIp: null, userAgent: 'automation-test' },
        { entityType: 'krn04.calc', entityId, event: 'field_changed', fieldKeys: ['step_0'] },
      );
      const values = await loadFieldValues(tx, 'krn04.calc', entityId);
      expect(values[`step_${AUTOMATION_MAX_DEPTH}`]).toBe('1');
      expect(values[`step_${AUTOMATION_MAX_DEPTH + 1}`]).toBeUndefined();
      const stopped = await tx.db.execute<{ depth: number }>(
        sql`select depth from krn04_automation_runs
            where entity_id = ${entityId} and status = 'stopped'`,
      );
      expect(stopped.rows.some((row) => row.depth >= AUTOMATION_MAX_DEPTH)).toBe(true);
    });
  });

  it('alerts a role and moves a record to a stage', async () => {
    const entityId = randomUUID();
    await withTenant(tenantId(company), async (tx) => {
      await createFieldDefinition(
        tx,
        operator,
        draft({ fieldKey: 'level', label: 'Level', fieldType: 'number' }),
      );
      await createAutomation(tx, operator, {
        name: 'Low level',
        entityType: 'krn04.calc',
        triggerKind: 'field_changed',
        fieldKey: 'level',
        conditions: [{ fieldKey: 'level', op: 'lt', otherField: null, value: '5' }],
        actions: [
          {
            kind: 'notify',
            audience: 'role',
            roleKey: 'branch_manager',
            userId: null,
            title: 'Level is low',
            body: 'Please look at this record.',
          },
          { kind: 'move_stage', machineKey: 'krn04.calc', toState: 'review' },
        ],
        enabled: true,
      });
      await saveCustomFields(tx, meta(owner), {
        entityType: 'krn04.calc',
        entityId,
        values: { level: '9' },
      });
      await startRecord(tx, meta(owner), { machineKey: 'krn04.calc', entityId });
      await saveCustomFields(tx, meta(owner), {
        entityType: 'krn04.calc',
        entityId,
        values: { level: '2' },
      });
      const inbox = await listNotifications(tx, manager);
      expect(inbox.items.some((item) => item.title === 'Level is low')).toBe(true);
      const ownerInbox = await listNotifications(tx, owner);
      expect(ownerInbox.items.some((item) => item.title === 'Level is low')).toBe(false);
      const state = await tx.db.execute<{ state_key: string }>(
        sql`select state_key from krn04_instances where entity_id = ${entityId}`,
      );
      expect(state.rows[0]?.state_key).toBe('review');
    });
  });
});
