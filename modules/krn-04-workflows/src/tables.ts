import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Column names mirror modules/krn-04-workflows/migrations.
 * These tables live with the module so a parallel kernel module can add its own.
 */

export const fieldDefinitions = pgTable(
  'krn04_field_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    entityType: text('entity_type').notNull(),
    entityLabel: text('entity_label').notNull(),
    fieldKey: text('field_key').notNull(),
    label: text('label').notNull(),
    fieldType: text('field_type').notNull(),
    required: boolean('required').notNull(),
    description: text('description').notNull(),
    sortOrder: integer('sort_order').notNull(),
    minLength: integer('min_length'),
    maxLength: integer('max_length'),
    minNumber: text('min_number'),
    maxNumber: text('max_number'),
    minCents: bigint('min_cents', { mode: 'bigint' }),
    maxCents: bigint('max_cents', { mode: 'bigint' }),
    options: jsonb('options').notNull(),
    formula: text('formula'),
    formulaPlaces: integer('formula_places'),
    formulaDisplay: text('formula_display'),
    formulaUnit: text('formula_unit').notNull().default(''),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('krn04_field_definitions_tenant_id_entity_type_field_key_unique').on(
      table.tenantId,
      table.entityType,
      table.fieldKey,
    ),
  ],
);

export const fieldValues = pgTable('krn04_field_values', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  values: jsonb('values').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const pipelines = pgTable('krn04_pipelines', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  machineKey: text('machine_key').notNull(),
  entityType: text('entity_type').notNull(),
  entityLabel: text('entity_label').notNull(),
  label: text('label').notNull(),
  baseStates: jsonb('base_states').notNull(),
  baseTransitions: jsonb('base_transitions').notNull(),
  extraStates: jsonb('extra_states').notNull(),
  extraTransitions: jsonb('extra_transitions').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const instances = pgTable('krn04_instances', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  pipelineId: uuid('pipeline_id').notNull(),
  entityId: uuid('entity_id').notNull(),
  stateKey: text('state_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const transitionLog = pgTable('krn04_transition_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  pipelineId: uuid('pipeline_id').notNull(),
  entityId: uuid('entity_id').notNull(),
  transitionKey: text('transition_key').notNull(),
  fromState: text('from_state').notNull(),
  toState: text('to_state').notNull(),
  actorId: uuid('actor_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const workflowRules = pgTable('krn04_workflow_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  entityType: text('entity_type').notNull(),
  triggerKind: text('trigger_kind').notNull(),
  eventKey: text('event_key'),
  machineKey: text('machine_key'),
  transitionKey: text('transition_key'),
  conditions: jsonb('conditions').notNull(),
  actionKind: text('action_kind').notNull(),
  actionConfig: jsonb('action_config').notNull(),
  enabled: boolean('enabled').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const automations = pgTable('krn04_automations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  entityType: text('entity_type').notNull(),
  triggerKind: text('trigger_kind').notNull(),
  fieldKey: text('field_key'),
  conditions: jsonb('conditions').notNull(),
  actions: jsonb('actions').notNull(),
  enabled: boolean('enabled').notNull(),
  sortOrder: integer('sort_order').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const automationRuns = pgTable('krn04_automation_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  automationId: uuid('automation_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  status: text('status').notNull(),
  summary: text('summary').notNull(),
  depth: integer('depth').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const notifications = pgTable('krn04_notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  ruleId: uuid('rule_id'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
