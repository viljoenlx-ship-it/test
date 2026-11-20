import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { memberships, users, type TenantTransaction } from '@omnivate/kernel';
import {
  evaluateFormula,
  formulaCents,
  formulaDecimal,
  isRoleKey,
  parseFormula,
  zarFromDecimal,
  type CustomFieldValue,
  type FormulaNumber,
} from '@omnivate/shared';
import { audit } from './actions';
import { WorkflowError } from './errors';
import {
  formulaValuesForRecord,
  loadDefinitionsForEntity,
  loadFieldValues,
  mergeCalculated,
  numericFieldList,
  type NumericInput,
} from './fields';
import { moveToStage } from './machines';
import { audienceUserIds } from './notifications';
import { getEntityType } from './registry';
import { automationRuns, automations, fieldValues, notifications, pipelines } from './tables';
import type { FieldAdmin } from './fields';

export const AUTOMATION_MAX_DEPTH = 5;

const OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const;
type Op = (typeof OPS)[number];

const ROLE_LABEL: Record<string, string> = {
  tenant_owner: 'Owner',
  branch_manager: 'Manager',
  accountant: 'Accountant',
  sales_cashier: 'Cashier',
  warehouse_technician: 'Warehouse',
  hr_compliance: 'HR',
  external_portal: 'Portal User',
};

const OP_LABEL: Record<Op, string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
};

export type AutomationCondition = {
  fieldKey: string;
  op: Op;
  otherField: string | null;
  value: string | null;
};

export type AutomationAction =
  | {
      kind: 'set_field';
      fieldKey: string;
      mode: 'value' | 'formula';
      value: string | null;
      formula: string | null;
    }
  | {
      kind: 'notify';
      audience: 'role' | 'user';
      roleKey: string | null;
      userId: string | null;
      title: string;
      body: string;
    }
  | { kind: 'move_stage'; machineKey: string; toState: string };

export type AutomationDraft = {
  name: string;
  entityType: string;
  triggerKind: 'created' | 'field_changed';
  fieldKey: string | null;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  enabled: boolean;
};

export type AutomationRunView = {
  id: string;
  status: 'ran' | 'skipped' | 'stopped';
  summary: string;
  depth: number;
  occurredAt: string;
};

export type AutomationView = AutomationDraft & {
  id: string;
  sortOrder: number;
  archived: boolean;
  summary: string;
  runs: AutomationRunView[];
};

export type ChangeActor = {
  actorId: string | null;
  operatorId?: string | null;
  requestIp: string | null;
  userAgent: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function readAutomationConditions(value: unknown): AutomationCondition[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const conditions: AutomationCondition[] = [];
  for (const item of value) {
    const row = record(item);
    if (!row || typeof row.fieldKey !== 'string') {
      continue;
    }
    if (typeof row.op !== 'string' || !(OPS as readonly string[]).includes(row.op)) {
      continue;
    }
    conditions.push({
      fieldKey: row.fieldKey,
      op: row.op as Op,
      otherField: typeof row.otherField === 'string' ? row.otherField : null,
      value: typeof row.value === 'string' ? row.value : null,
    });
  }
  return conditions;
}

export function readAutomationActions(value: unknown): AutomationAction[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const actions: AutomationAction[] = [];
  for (const item of value) {
    const row = record(item);
    if (!row || typeof row.kind !== 'string') {
      continue;
    }
    if (row.kind === 'set_field' && typeof row.fieldKey === 'string') {
      actions.push({
        kind: 'set_field',
        fieldKey: row.fieldKey,
        mode: row.mode === 'formula' ? 'formula' : 'value',
        value: typeof row.value === 'string' ? row.value : null,
        formula: typeof row.formula === 'string' ? row.formula : null,
      });
    } else if (row.kind === 'notify') {
      actions.push({
        kind: 'notify',
        audience: row.audience === 'user' ? 'user' : 'role',
        roleKey: typeof row.roleKey === 'string' ? row.roleKey : null,
        userId: typeof row.userId === 'string' ? row.userId : null,
        title: typeof row.title === 'string' ? row.title : '',
        body: typeof row.body === 'string' ? row.body : '',
      });
    } else if (
      row.kind === 'move_stage' &&
      typeof row.machineKey === 'string' &&
      typeof row.toState === 'string'
    ) {
      actions.push({ kind: 'move_stage', machineKey: row.machineKey, toState: row.toState });
    }
  }
  return actions;
}

function labelOf(inputs: readonly NumericInput[], key: string): string {
  return inputs.find((field) => field.key === key)?.label ?? key;
}

export function describeAutomation(
  draft: AutomationDraft,
  inputs: readonly NumericInput[],
): string {
  const recordLabel = draft.entityType;
  const when =
    draft.triggerKind === 'created'
      ? `When a record is created`
      : `When ${labelOf(inputs, draft.fieldKey ?? '')} changes`;
  const conditions = draft.conditions
    .map((condition) => {
      const right = condition.otherField
        ? labelOf(inputs, condition.otherField)
        : (condition.value ?? '');
      return `${labelOf(inputs, condition.fieldKey)} ${OP_LABEL[condition.op]} ${right}`;
    })
    .join(', and ');
  const actions = draft.actions
    .map((action) => {
      if (action.kind === 'set_field') {
        return action.mode === 'formula'
          ? `set ${labelOf(inputs, action.fieldKey)} from a formula`
          : `set ${labelOf(inputs, action.fieldKey)}`;
      }
      if (action.kind === 'notify') {
        const who =
          action.audience === 'role' ? (ROLE_LABEL[action.roleKey ?? ''] ?? 'a role') : 'a person';
        return `alert ${who}`;
      }
      return `move the record to ${action.toState.replaceAll('_', ' ')}`;
    })
    .join(', then ');
  const extra = conditions ? `, and ${conditions}` : '';
  return `${when}${extra}, then ${actions}.`.replace(recordLabel, recordLabel);
}

async function toView(
  tx: TenantTransaction,
  row: typeof automations.$inferSelect,
): Promise<AutomationView> {
  const inputs = await numericFieldList(tx, row.entityType);
  const draft: AutomationDraft = {
    name: row.name,
    entityType: row.entityType,
    triggerKind: row.triggerKind === 'created' ? 'created' : 'field_changed',
    fieldKey: row.fieldKey,
    conditions: readAutomationConditions(row.conditions),
    actions: readAutomationActions(row.actions),
    enabled: row.enabled,
  };
  const runs = await tx.db
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.automationId, row.id))
    .orderBy(desc(automationRuns.occurredAt))
    .limit(20);
  return {
    ...draft,
    id: row.id,
    sortOrder: row.sortOrder,
    archived: row.archivedAt !== null,
    summary: describeAutomation(draft, inputs),
    runs: runs.map((run) => ({
      id: run.id,
      status: run.status === 'skipped' || run.status === 'stopped' ? run.status : 'ran',
      summary: run.summary,
      depth: run.depth,
      occurredAt: run.occurredAt.toISOString(),
    })),
  };
}

async function assertAutomation(tx: TenantTransaction, draft: AutomationDraft): Promise<void> {
  const name = draft.name.trim();
  if (name.length < 1 || name.length > 80) {
    throw new WorkflowError('Enter an automation name of up to 80 characters.');
  }
  if (!/^[a-z][a-z0-9_.]{1,63}$/.test(draft.entityType)) {
    throw new WorkflowError('Choose a record type.');
  }
  const inputs = await numericFieldList(tx, draft.entityType);
  const known = new Set(inputs.map((field) => field.key));
  if (inputs.length === 0 && !getEntityType(draft.entityType)) {
    const definitions = await loadDefinitionsForEntity(tx, draft.entityType);
    if (definitions.length === 0) {
      throw new WorkflowError('That record type is not available yet.');
    }
  }
  if (draft.triggerKind === 'field_changed') {
    if (!draft.fieldKey || !known.has(draft.fieldKey)) {
      throw new WorkflowError('Choose the field that starts this automation.');
    }
  } else if (draft.fieldKey) {
    throw new WorkflowError('A created automation does not watch a field.');
  }
  if (draft.conditions.length > 8) {
    throw new WorkflowError('Use up to 8 conditions.');
  }
  for (const condition of draft.conditions) {
    if (!known.has(condition.fieldKey)) {
      throw new WorkflowError('That condition uses a field this record does not have.');
    }
    if (!(OPS as readonly string[]).includes(condition.op)) {
      throw new WorkflowError('That condition is not supported.');
    }
    if (condition.otherField) {
      if (!known.has(condition.otherField)) {
        throw new WorkflowError('Compare with a field on this record.');
      }
    } else if (!condition.value || !/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/.test(condition.value)) {
      throw new WorkflowError('Enter a number to compare with.');
    }
  }
  if (draft.actions.length < 1 || draft.actions.length > 5) {
    throw new WorkflowError('Add between 1 and 5 actions.');
  }
  const definitions = await loadDefinitionsForEntity(tx, draft.entityType);
  for (const action of draft.actions) {
    if (action.kind === 'set_field') {
      const target = definitions.find(
        (definition) => definition.fieldKey === action.fieldKey && !definition.archived,
      );
      if (!target || (target.fieldType !== 'number' && target.fieldType !== 'money')) {
        throw new WorkflowError('Set a number or money field. Calculated fields fill themselves.');
      }
      if (action.mode === 'formula') {
        if (!action.formula) {
          throw new WorkflowError('Add the formula to set.');
        }
        const parsed = parseFormula(action.formula, known);
        if (!parsed.ok) {
          throw new WorkflowError(parsed.message);
        }
      } else if (!action.value || action.value.trim().length < 1) {
        throw new WorkflowError('Enter the value to set.');
      }
    } else if (action.kind === 'notify') {
      if (action.title.trim().length < 1 || action.title.length > 120) {
        throw new WorkflowError('Enter an alert title.');
      }
      if (action.body.trim().length < 1 || action.body.length > 500) {
        throw new WorkflowError('Enter an alert message.');
      }
      if (action.audience === 'role') {
        if (!action.roleKey || !isRoleKey(action.roleKey)) {
          throw new WorkflowError('Choose who should see the alert.');
        }
      } else {
        const people = await tx.db
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(
            and(eq(memberships.userId, action.userId ?? ''), eq(memberships.status, 'active')),
          );
        if (people.length === 0) {
          throw new WorkflowError('Choose a person at this company.');
        }
      }
    } else {
      const pipes = await tx.db
        .select()
        .from(pipelines)
        .where(and(eq(pipelines.machineKey, action.machineKey), isNull(pipelines.archivedAt)));
      const pipe = pipes[0];
      if (!pipe || pipe.entityType !== draft.entityType) {
        throw new WorkflowError('Choose a pipeline for this record.');
      }
      const states = [...readStateKeys(pipe.baseStates), ...readStateKeys(pipe.extraStates)];
      if (!states.includes(action.toState)) {
        throw new WorkflowError('Choose a stage on that pipeline.');
      }
    }
  }
}

function readStateKeys(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const row = record(item);
    return row && typeof row.key === 'string' ? [row.key] : [];
  });
}

function stored(draft: AutomationDraft, tenantId: string, sortOrder: number) {
  return {
    tenantId,
    name: draft.name.trim(),
    entityType: draft.entityType,
    triggerKind: draft.triggerKind,
    fieldKey: draft.triggerKind === 'field_changed' ? draft.fieldKey : null,
    conditions: draft.conditions,
    actions: draft.actions,
    enabled: draft.enabled,
    sortOrder,
    updatedAt: new Date(),
  };
}

export async function listAutomations(tx: TenantTransaction): Promise<AutomationView[]> {
  const rows = await tx.db
    .select()
    .from(automations)
    .orderBy(asc(automations.sortOrder), asc(automations.name));
  const views: AutomationView[] = [];
  for (const row of rows) {
    views.push(await toView(tx, row));
  }
  return views;
}

export async function createAutomation(
  tx: TenantTransaction,
  actor: FieldAdmin,
  draft: AutomationDraft,
): Promise<AutomationView> {
  await assertAutomation(tx, draft);
  const existing = await tx.db.select({ sortOrder: automations.sortOrder }).from(automations);
  const sortOrder = existing.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
  const inserted = await tx.db
    .insert(automations)
    .values({ ...stored(draft, tx.tenantId, sortOrder), archivedAt: null })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new WorkflowError('The automation was not saved.');
  }
  await audit(tx, {
    action: 'workflow.automation.created',
    entityType: 'krn04_automation',
    entityId: row.id,
    actorId: null,
    operatorId: actor.operatorId,
    beforeData: null,
    afterData: { name: row.name, enabled: row.enabled },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  return toView(tx, row);
}

export async function updateAutomation(
  tx: TenantTransaction,
  actor: FieldAdmin,
  id: string,
  draft: AutomationDraft,
): Promise<AutomationView> {
  const existing = await tx.db.select().from(automations).where(eq(automations.id, id));
  const current = existing[0];
  if (!current || current.archivedAt) {
    throw new WorkflowError('That automation was not found.');
  }
  await assertAutomation(tx, draft);
  await tx.db
    .update(automations)
    .set(stored(draft, tx.tenantId, current.sortOrder))
    .where(eq(automations.id, id));
  await audit(tx, {
    action: 'workflow.automation.updated',
    entityType: 'krn04_automation',
    entityId: id,
    actorId: null,
    operatorId: actor.operatorId,
    beforeData: { name: current.name, enabled: current.enabled },
    afterData: { name: draft.name.trim(), enabled: draft.enabled },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  const again = await tx.db.select().from(automations).where(eq(automations.id, id));
  const next = again[0];
  if (!next) {
    throw new WorkflowError('That automation was not found.');
  }
  return toView(tx, next);
}

export async function archiveAutomation(
  tx: TenantTransaction,
  actor: FieldAdmin,
  id: string,
): Promise<void> {
  const existing = await tx.db.select().from(automations).where(eq(automations.id, id));
  const current = existing[0];
  if (!current) {
    throw new WorkflowError('That automation was not found.');
  }
  if (current.archivedAt) {
    return;
  }
  const archivedAt = new Date();
  await tx.db
    .update(automations)
    .set({ archivedAt, enabled: false, updatedAt: archivedAt })
    .where(eq(automations.id, id));
  await audit(tx, {
    action: 'workflow.automation.archived',
    entityType: 'krn04_automation',
    entityId: id,
    actorId: null,
    operatorId: actor.operatorId,
    beforeData: { archived: false, name: current.name },
    afterData: { archived: true, name: current.name },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
}

export async function reorderAutomations(
  tx: TenantTransaction,
  actor: FieldAdmin,
  ids: string[],
): Promise<void> {
  const rows = await tx.db.select().from(automations).where(isNull(automations.archivedAt));
  const known = new Set(rows.map((row) => row.id));
  if (ids.length !== rows.length || ids.some((id) => !known.has(id))) {
    throw new WorkflowError('Include every automation, once.');
  }
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    if (!id) {
      continue;
    }
    await tx.db
      .update(automations)
      .set({ sortOrder: index, updatedAt: new Date() })
      .where(eq(automations.id, id));
  }
  const anchor = rows[0];
  if (anchor) {
    await audit(tx, {
      action: 'workflow.automation.updated',
      entityType: 'krn04_automation',
      entityId: anchor.id,
      actorId: null,
      operatorId: actor.operatorId,
      beforeData: { order: rows.map((row) => row.name) },
      afterData: { order: ids.map((id) => rows.find((row) => row.id === id)?.name ?? id) },
      requestIp: actor.requestIp,
      userAgent: actor.userAgent,
    });
  }
}

async function writeValues(
  tx: TenantTransaction,
  entityType: string,
  entityId: string,
  values: Record<string, CustomFieldValue>,
): Promise<void> {
  const existing = await tx.db
    .select({ id: fieldValues.id })
    .from(fieldValues)
    .where(and(eq(fieldValues.entityType, entityType), eq(fieldValues.entityId, entityId)));
  if (existing[0]) {
    await tx.db
      .update(fieldValues)
      .set({ values, updatedAt: new Date() })
      .where(eq(fieldValues.id, existing[0].id));
  } else if (Object.keys(values).length > 0) {
    await tx.db.insert(fieldValues).values({
      tenantId: tx.tenantId,
      entityType,
      entityId,
      values,
      updatedAt: new Date(),
    });
  }
}

function sameValue(
  left: CustomFieldValue | undefined,
  right: CustomFieldValue | undefined,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

async function logRun(
  tx: TenantTransaction,
  actor: ChangeActor,
  input: {
    automationId: string;
    name: string;
    entityType: string;
    entityId: string;
    status: 'ran' | 'skipped' | 'stopped';
    summary: string;
    depth: number;
  },
): Promise<void> {
  await tx.db.insert(automationRuns).values({
    tenantId: tx.tenantId,
    automationId: input.automationId,
    entityType: input.entityType,
    entityId: input.entityId,
    status: input.status,
    summary: input.summary.slice(0, 500),
    depth: input.depth,
  });
  await audit(tx, {
    action: 'workflow.automation.ran',
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: actor.operatorId ? null : actor.actorId,
    operatorId: actor.operatorId ?? null,
    beforeData: null,
    afterData: {
      automation: input.name,
      status: input.status,
      summary: input.summary.slice(0, 500),
      depth: input.depth,
    },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
}

function numberOf(
  map: Record<string, FormulaNumber>,
  key: string,
  literal: string | null,
): FormulaNumber | null {
  if (literal !== null) {
    return { kind: 'number', text: literal };
  }
  return map[key] ?? null;
}

function holds(condition: AutomationCondition, map: Record<string, FormulaNumber>): boolean {
  const left = map[condition.fieldKey];
  const right = condition.otherField
    ? (map[condition.otherField] ?? null)
    : numberOf(map, '', condition.value);
  if (!left?.text || !right?.text) {
    return false;
  }
  const delta = evaluateFormula('left - right', new Set(['left', 'right']), { left, right });
  if (!delta.ok) {
    return false;
  }
  const value = delta.scaled;
  if (condition.op === 'eq') return value === 0n;
  if (condition.op === 'neq') return value !== 0n;
  if (condition.op === 'gt') return value > 0n;
  if (condition.op === 'gte') return value >= 0n;
  if (condition.op === 'lt') return value < 0n;
  return value <= 0n;
}

async function setFieldValue(
  tx: TenantTransaction,
  entityType: string,
  entityId: string,
  action: Extract<AutomationAction, { kind: 'set_field' }>,
  map: Record<string, FormulaNumber>,
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const definitions = await loadDefinitionsForEntity(tx, entityType);
  const target = definitions.find(
    (definition) => definition.fieldKey === action.fieldKey && !definition.archived,
  );
  if (!target || (target.fieldType !== 'number' && target.fieldType !== 'money')) {
    return { ok: false, message: 'That field cannot be set by an automation.' };
  }
  const inputs = await numericFieldList(tx, entityType);
  const allowed = new Set(inputs.map((field) => field.key));
  let stored: CustomFieldValue;
  if (action.mode === 'formula') {
    const result = evaluateFormula(action.formula ?? '', allowed, map);
    if (!result.ok) {
      return { ok: false, message: result.message };
    }
    if (target.fieldType === 'money') {
      const cents = formulaCents(result.scaled);
      if (!cents.ok) {
        return cents;
      }
      stored = cents.cents;
    } else {
      const decimal = formulaDecimal(result.scaled, 4);
      if (!decimal.ok) {
        return decimal;
      }
      stored = decimal.text.includes('.')
        ? decimal.text.replace(/0+$/, '').replace(/\.$/, '')
        : decimal.text;
    }
  } else if (target.fieldType === 'money') {
    try {
      stored = Number(zarFromDecimal((action.value ?? '').trim()).amountCents);
    } catch {
      return { ok: false, message: 'Enter a rand amount such as 10.50.' };
    }
  } else {
    const text = (action.value ?? '').trim();
    if (!/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/.test(text)) {
      return { ok: false, message: 'Enter a number to set.' };
    }
    stored = text;
  }
  const current = await loadFieldValues(tx, entityType, entityId);
  current[action.fieldKey] = stored;
  const merged = await mergeCalculated(tx, entityType, entityId, current);
  await writeValues(tx, entityType, entityId, merged);
  const shown = typeof stored === 'number' ? String(stored) : stored;
  return { ok: true, text: shown };
}

export async function recordChanged(
  tx: TenantTransaction,
  actor: ChangeActor,
  input: {
    entityType: string;
    entityId: string;
    event: 'created' | 'field_changed';
    fieldKeys: string[];
  },
  depth = 0,
  chain: readonly string[] = [],
): Promise<void> {
  const before = await loadFieldValues(tx, input.entityType, input.entityId);
  const merged = await mergeCalculated(tx, input.entityType, input.entityId, before);
  const calculatedKeys = (await loadDefinitionsForEntity(tx, input.entityType))
    .filter((definition) => definition.fieldType === 'calculated' && !definition.archived)
    .map((definition) => definition.fieldKey)
    .filter((key) => !sameValue(before[key], merged[key]));
  if (calculatedKeys.length > 0) {
    await writeValues(tx, input.entityType, input.entityId, merged);
  }
  const changed = new Set([...input.fieldKeys, ...calculatedKeys]);
  const rows = await tx.db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.entityType, input.entityType),
        eq(automations.enabled, true),
        isNull(automations.archivedAt),
      ),
    )
    .orderBy(asc(automations.sortOrder), asc(automations.name));

  for (const row of rows) {
    const matches =
      input.event === 'created'
        ? row.triggerKind === 'created'
        : row.triggerKind === 'field_changed' && row.fieldKey !== null && changed.has(row.fieldKey);
    if (!matches) {
      continue;
    }
    const draftActions = readAutomationActions(row.actions);
    const conditions = readAutomationConditions(row.conditions);
    if (depth >= AUTOMATION_MAX_DEPTH) {
      await logRun(tx, actor, {
        automationId: row.id,
        name: row.name,
        entityType: input.entityType,
        entityId: input.entityId,
        status: 'stopped',
        summary: `Stopped after ${AUTOMATION_MAX_DEPTH} steps so this cannot loop forever.`,
        depth,
      });
      continue;
    }
    if (chain.includes(row.id)) {
      await logRun(tx, actor, {
        automationId: row.id,
        name: row.name,
        entityType: input.entityType,
        entityId: input.entityId,
        status: 'stopped',
        summary: 'Stopped because this automation was already running in this chain.',
        depth,
      });
      continue;
    }
    const map = await formulaValuesForRecord(tx, input.entityType, input.entityId);
    if (conditions.some((condition) => !holds(condition, map))) {
      await logRun(tx, actor, {
        automationId: row.id,
        name: row.name,
        entityType: input.entityType,
        entityId: input.entityId,
        status: 'skipped',
        summary: 'The conditions did not match.',
        depth,
      });
      continue;
    }
    const notes: string[] = [];
    let stopped: string | null = null;
    const touched: string[] = [];
    for (const action of draftActions) {
      if (action.kind === 'set_field') {
        const fresh = await formulaValuesForRecord(tx, input.entityType, input.entityId);
        const set = await setFieldValue(tx, input.entityType, input.entityId, action, fresh);
        if (!set.ok) {
          stopped = set.message;
          break;
        }
        notes.push(`Set ${action.fieldKey}.`);
        touched.push(action.fieldKey);
      } else if (action.kind === 'notify') {
        const people = await audienceUserIds(tx, actor.actorId, {
          audience: action.audience,
          roleKey: action.roleKey,
          userId: action.userId,
        });
        for (const userId of people) {
          await tx.db.insert(notifications).values({
            tenantId: tx.tenantId,
            userId,
            title: action.title.trim().slice(0, 120),
            body: action.body.trim().slice(0, 500),
            entityType: input.entityType,
            entityId: input.entityId,
          });
        }
        notes.push(
          people.length === 0 ? 'Nobody was signed up for that alert.' : 'Sent an in-app alert.',
        );
      } else {
        const moved = await moveToStage(
          tx,
          actor.actorId
            ? { actorId: actor.actorId, requestIp: actor.requestIp, userAgent: actor.userAgent }
            : null,
          {
            machineKey: action.machineKey,
            entityId: input.entityId,
            toState: action.toState,
          },
        );
        if (!moved.ok) {
          stopped = moved.message;
          break;
        }
        notes.push(`Moved the record to ${moved.label}.`);
      }
    }
    await logRun(tx, actor, {
      automationId: row.id,
      name: row.name,
      entityType: input.entityType,
      entityId: input.entityId,
      status: stopped ? 'stopped' : 'ran',
      summary: stopped ? `${notes.join(' ')} ${stopped}`.trim() : notes.join(' ') || 'Ran.',
      depth,
    });
    if (!stopped && touched.length > 0) {
      await recordChanged(
        tx,
        actor,
        {
          entityType: input.entityType,
          entityId: input.entityId,
          event: 'field_changed',
          fieldKeys: touched,
        },
        depth + 1,
        [...chain, row.id],
      );
    }
  }
}

export async function listAutomationStages(tx: TenantTransaction): Promise<
  {
    machineKey: string;
    entityType: string;
    label: string;
    states: { key: string; label: string }[];
  }[]
> {
  const rows = await tx.db.select().from(pipelines);
  return rows
    .filter((row) => !row.archivedAt)
    .map((row) => ({
      machineKey: row.machineKey,
      entityType: row.entityType,
      label: row.label,
      states: [...stagePairs(row.baseStates), ...stagePairs(row.extraStates)],
    }));
}

function stagePairs(value: unknown): { key: string; label: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const row = record(item);
    if (!row || typeof row.key !== 'string' || typeof row.label !== 'string') {
      return [];
    }
    return [{ key: row.key, label: row.label }];
  });
}

export async function listAutomationPeople(
  tx: TenantTransaction,
): Promise<{ id: string; name: string; email: string }[]> {
  const rows = await tx.db
    .select({ id: users.id, name: users.displayName, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.status, 'active'))
    .orderBy(asc(users.displayName));
  return rows;
}
