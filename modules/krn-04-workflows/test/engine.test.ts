import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
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
import { pipelines } from '../src/tables';
import {
  createFieldDefinition,
  createRule,
  installMachine,
  moveRecord,
  registerEntityType,
  registerStateMachine,
  registerWorkflowAction,
  rejectBaseReplacement,
  resetRegistryForTests,
  saveCustomFields,
  startRecord,
  updatePipelineExtras,
  type Actor,
} from '../src/index';

const meta = (actorId: string): Actor => ({
  actorId,
  requestIp: null,
  userAgent: 'krn04-test',
});

describe('KRN-04 engine', () => {
  const company = randomUUID();
  const owner = randomUUID();
  const colleague = randomUUID();
  const manager = randomUUID();
  const entityId = randomUUID();

  beforeAll(async () => {
    resetRegistryForTests();
    registerEntityType({
      key: 'krn04.demo_record',
      moduleId: 'KRN-04',
      label: 'Demo record',
      description: 'Registered in this test only. Not a business module.',
    });
    registerStateMachine({
      key: 'krn04.demo_record',
      entityType: 'krn04.demo_record',
      moduleId: 'KRN-04',
      label: 'Demo pipeline',
      states: [
        { key: 'draft', label: 'Draft', kind: 'initial' },
        { key: 'submitted', label: 'Submitted', kind: 'open' },
        { key: 'approved', label: 'Approved', kind: 'terminal' },
      ],
      transitions: [
        {
          key: 'submit',
          from: 'draft',
          to: 'submitted',
          label: 'Submit',
          permission: { scope: 'krn', action: 'operate', moduleId: 'KRN-04' },
          auditAction: 'krn04.demo.submit',
        },
        {
          key: 'approve',
          from: 'submitted',
          to: 'approved',
          label: 'Approve',
          permission: { scope: 'krn', action: 'approve', moduleId: 'KRN-04' },
          makerChecker: {
            action: 'krn04.demo.approve',
            oppositeAction: 'krn04.demo.submit',
            description: 'The person who submits a demo record cannot approve it.',
          },
        },
      ],
    });

    const admin = drizzle(getAdminPool(), { schema });
    await admin.insert(schema.tenants).values({
      id: company,
      slug: `demo-${company.slice(0, 8)}`,
      displayName: 'Demo engine company',
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
        id: colleague,
        email: `colleague-${colleague}@example.com`,
        displayName: 'Colleague',
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
      { tenantId: company, userId: colleague, status: 'active' },
      { tenantId: company, userId: manager, status: 'active' },
    ]);
    await admin.insert(userRoles).values([
      { tenantId: company, userId: owner, roleId: ownerRole },
      { tenantId: company, userId: colleague, roleId: ownerRole },
      { tenantId: company, userId: manager, roleId: managerRole },
    ]);
  });

  afterAll(async () => {
    await closePools();
  });

  it('validates fields, keeps the module stages, and enforces maker-checker', async () => {
    expect(() =>
      registerWorkflowAction({
        kind: 'email',
        label: 'Email',
        sendsExternally: true,
        run: async () => undefined,
      }),
    ).toThrow(/WhatsApp/);

    const calls = { network: 0 };
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls.network += 1;
      throw new Error('KRN-04 must not call the network.');
    }) as typeof fetch;

    try {
      await withTenant(tenantId(company), async (tx) => {
        const installed = await installMachine(tx, meta(owner), 'krn04.demo_record');
        expect(installed.states.map((state) => state.key)).toEqual([
          'draft',
          'submitted',
          'approved',
        ]);
        const before = await tx.db
          .select({ base: pipelines.baseStates })
          .from(pipelines)
          .where(eq(pipelines.id, installed.id));

        const updated = await updatePipelineExtras(tx, meta(owner), installed.id, {
          extraStates: [{ key: 'review', label: 'In review', kind: 'open' }],
          extraTransitions: [
            {
              key: 'send_review',
              from: 'submitted',
              to: 'review',
              label: 'Send for review',
              permission: { scope: 'krn', action: 'operate', moduleId: 'KRN-04' },
            },
          ],
        });
        expect(updated.states.map((state) => state.label)).toContain('In review');
        expect(
          updated.states.filter((state) => state.origin === 'base').map((state) => state.key),
        ).toEqual(['draft', 'submitted', 'approved']);
        const after = await tx.db
          .select({ base: pipelines.baseStates })
          .from(pipelines)
          .where(eq(pipelines.id, installed.id));
        expect(after[0]?.base).toEqual(before[0]?.base);
        expect(() => rejectBaseReplacement()).toThrow(/stay on the pipeline/);

        await getAdminPool().query(
          `INSERT INTO platform_operators (id, email, display_name, password_hash, status, totp_enabled)
           VALUES ($1, $2, 'Platform Owner', 'not-a-real-hash', 'active', true)
           ON CONFLICT (id) DO NOTHING`,
          [platformOperator.id, platformOperator.email],
        );
        await createFieldDefinition(
          tx,
          {
            operatorId: platformOperator.id,
            requestIp: null,
            userAgent: 'krn04-test',
          },
          {
            entityType: 'krn04.demo_record',
            fieldKey: 'priority',
            label: 'Priority',
            fieldType: 'select',
            required: true,
            description: '',
            minLength: null,
            maxLength: null,
            minNumber: null,
            maxNumber: null,
            minCents: null,
            maxCents: null,
            formula: null,
            formulaPlaces: null,
            formulaDisplay: null,
            formulaUnit: '',
            options: [
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' },
            ],
          },
        );
        await expect(
          saveCustomFields(tx, meta(owner), {
            entityType: 'krn04.demo_record',
            entityId,
            values: { priority: 'urgent' },
          }),
        ).rejects.toThrow(/options/);

        await saveCustomFields(tx, meta(owner), {
          entityType: 'krn04.demo_record',
          entityId,
          values: { priority: 'high' },
        });

        await createRule(tx, meta(owner), {
          name: 'High priority approved',
          entityType: 'krn04.demo_record',
          triggerKind: 'transition',
          eventKey: null,
          machineKey: 'krn04.demo_record',
          transitionKey: 'approve',
          conditions: [{ source: 'field', key: 'priority', op: 'eq', value: 'high' }],
          actionKind: 'notify',
          actionConfig: {
            title: 'Please look',
            body: 'A demo record was approved. This stays in the app.',
            audience: 'role',
            roleKey: 'tenant_owner',
          },
          enabled: true,
        });
        await expect(
          createRule(tx, meta(owner), {
            name: 'Email someone',
            entityType: 'krn04.demo_record',
            triggerKind: 'event',
            eventKey: 'fields.saved',
            machineKey: null,
            transitionKey: null,
            conditions: [],
            actionKind: 'email',
            actionConfig: { title: 'Hi', body: 'There' },
            enabled: true,
          }),
        ).rejects.toThrow(/Email and WhatsApp/);

        await startRecord(tx, meta(owner), { machineKey: 'krn04.demo_record', entityId });
        await moveRecord(tx, meta(owner), {
          machineKey: 'krn04.demo_record',
          entityId,
          transitionKey: 'submit',
        });
        await expect(
          moveRecord(tx, meta(manager), {
            machineKey: 'krn04.demo_record',
            entityId,
            transitionKey: 'approve',
          }),
        ).rejects.toThrow(/permission/);
        await expect(
          moveRecord(tx, meta(owner), {
            machineKey: 'krn04.demo_record',
            entityId,
            transitionKey: 'approve',
          }),
        ).rejects.toThrow(/Segregation of duties/);
        const moved = await moveRecord(tx, meta(colleague), {
          machineKey: 'krn04.demo_record',
          entityId,
          transitionKey: 'approve',
        });
        expect(moved).toEqual({ from: 'submitted', to: 'approved' });

        const inbox = await listNotifications(tx, owner);
        expect(inbox.items.some((item) => item.title === 'Please look')).toBe(true);
        const managerInbox = await listNotifications(tx, manager);
        expect(managerInbox.items.some((item) => item.title === 'Please look')).toBe(false);
      });
    } finally {
      globalThis.fetch = original;
    }
    expect(calls.network).toBe(0);
  });
});
