import { and, asc, eq, isNull } from 'drizzle-orm';
import { requirePermission, type TenantTransaction } from '@omnivate/kernel';
import { isRoleKey, type CustomFieldValue } from '@omnivate/shared';
import { audit, getWorkflowAction, type Actor, type WorkflowActionContext } from './actions';
import { WorkflowError } from './errors';
import { recordChanged } from './automations';
import { loadDefinitionsForEntity, loadFieldValues, saveFieldValues } from './fields';
import { fieldValues } from './tables';
import { applyTransition, currentState, openInstance, pipelineByMachine } from './machines';
import { workflowRules } from './tables';

const EVENT_KEY = /^[a-z][a-z0-9_.]{1,60}$/;
const OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'is_true', 'is_false'] as const;
type Op = (typeof OPS)[number];

export type RuleCondition = {
  source: 'field' | 'state';
  key?: string;
  op: Op;
  value?: string;
};

export type RuleDraft = {
  name: string;
  entityType: string;
  triggerKind: 'event' | 'transition';
  eventKey: string | null;
  machineKey: string | null;
  transitionKey: string | null;
  conditions: RuleCondition[];
  actionKind: string;
  actionConfig: Record<string, unknown>;
  enabled: boolean;
};

export type RuleView = RuleDraft & {
  id: string;
  archived: boolean;
  summary: string;
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function readConditions(value: unknown): RuleCondition[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const conditions: RuleCondition[] = [];
  for (const item of value) {
    const row = record(item);
    if (!row || (row.source !== 'field' && row.source !== 'state')) {
      continue;
    }
    if (typeof row.op !== 'string' || !(OPS as readonly string[]).includes(row.op)) {
      continue;
    }
    conditions.push({
      source: row.source,
      key: typeof row.key === 'string' ? row.key : undefined,
      op: row.op as Op,
      value: typeof row.value === 'string' ? row.value : undefined,
    });
  }
  return conditions;
}

function scaleDecimal(value: string): bigint | null {
  if (!/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/.test(value)) {
    return null;
  }
  const negative = value.startsWith('-');
  const body = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = body.split('.');
  const scaled = BigInt(`${whole}${fraction.padEnd(4, '0')}`);
  return negative ? -scaled : scaled;
}

function compare(left: string, right: string, op: Op): boolean {
  const leftNumber = scaleDecimal(left);
  const rightNumber = scaleDecimal(right);
  if (leftNumber !== null && rightNumber !== null && op !== 'contains') {
    const delta = leftNumber - rightNumber;
    if (op === 'eq') return delta === 0n;
    if (op === 'neq') return delta !== 0n;
    if (op === 'gt') return delta > 0n;
    if (op === 'gte') return delta >= 0n;
    if (op === 'lt') return delta < 0n;
    if (op === 'lte') return delta <= 0n;
  }
  if (op === 'eq') return left === right;
  if (op === 'neq') return left !== right;
  if (op === 'contains') return left.includes(right);
  return false;
}

function valueText(value: CustomFieldValue | undefined): string {
  if (value === undefined) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.join(',');
  }
  return value;
}

export function conditionsMatch(
  conditions: readonly RuleCondition[],
  fields: Record<string, CustomFieldValue>,
  stateKey: string | null,
): boolean {
  for (const condition of conditions) {
    if (condition.op === 'is_true' || condition.op === 'is_false') {
      const current =
        condition.source === 'field' ? fields[condition.key ?? ''] === true : stateKey === 'true';
      if (condition.op === 'is_true' ? !current : current) {
        return false;
      }
      continue;
    }
    const key = condition.key ?? '';
    const stored = fields[key];
    if (condition.source === 'field' && Array.isArray(stored) && condition.op === 'contains') {
      if (!stored.includes(condition.value ?? '')) {
        return false;
      }
      continue;
    }
    const left = condition.source === 'state' ? (stateKey ?? '') : valueText(stored);
    if (!compare(left, condition.value ?? '', condition.op)) {
      return false;
    }
  }
  return true;
}

function readConfig(value: unknown): Record<string, unknown> {
  const row = record(value);
  return row ?? {};
}

function toView(row: typeof workflowRules.$inferSelect): RuleView {
  const draft: RuleDraft = {
    name: row.name,
    entityType: row.entityType,
    triggerKind: row.triggerKind === 'transition' ? 'transition' : 'event',
    eventKey: row.eventKey,
    machineKey: row.machineKey,
    transitionKey: row.transitionKey,
    conditions: readConditions(row.conditions),
    actionKind: row.actionKind,
    actionConfig: readConfig(row.actionConfig),
    enabled: row.enabled,
  };
  return { ...draft, id: row.id, archived: row.archivedAt !== null, summary: describeRule(draft) };
}

export function describeRule(rule: RuleDraft): string {
  const when =
    rule.triggerKind === 'transition'
      ? `When someone uses the ${rule.transitionKey?.replaceAll('_', ' ')} move`
      : rule.eventKey === 'fields.saved'
        ? 'When the extra details are saved'
        : rule.eventKey === 'record.opened'
          ? 'When a record starts'
          : `When ${rule.eventKey} happens`;
  const action =
    rule.actionKind === 'notify'
      ? `show an in-app alert titled “${String(rule.actionConfig.title ?? '').trim()}”`
      : 'write a log entry';
  const extra = rule.conditions.length === 0 ? '' : ', if the conditions match';
  return `${when}${extra}, ${action}.`;
}

async function assertRule(tx: TenantTransaction, draft: RuleDraft): Promise<void> {
  const name = draft.name.trim();
  if (name.length < 1 || name.length > 80) {
    throw new WorkflowError('Enter an alert name of up to 80 characters.');
  }
  if (!/^[a-z][a-z0-9_.]{1,63}$/.test(draft.entityType)) {
    throw new WorkflowError('Choose a record type.');
  }
  if (draft.conditions.length > 8) {
    throw new WorkflowError('Use up to 8 conditions.');
  }
  const definitions = await loadDefinitionsForEntity(tx, draft.entityType);
  const fieldKeys = new Set(
    definitions
      .filter((definition) => !definition.archived)
      .map((definition) => definition.fieldKey),
  );
  for (const condition of draft.conditions) {
    if (!(OPS as readonly string[]).includes(condition.op)) {
      throw new WorkflowError('That condition is not supported.');
    }
    if (condition.source === 'field') {
      if (!condition.key || !fieldKeys.has(condition.key)) {
        throw new WorkflowError('That condition uses a field this record does not have.');
      }
    }
  }
  if (draft.triggerKind === 'event') {
    if (!draft.eventKey || !EVENT_KEY.test(draft.eventKey)) {
      throw new WorkflowError('Choose an event such as fields.saved.');
    }
  } else {
    if (!draft.machineKey || !draft.transitionKey) {
      throw new WorkflowError('Choose the pipeline move that starts this alert.');
    }
    const pipeline = await pipelineByMachine(tx, draft.machineKey);
    if (!pipeline || pipeline.row.entityType !== draft.entityType || pipeline.row.archivedAt) {
      throw new WorkflowError('That pipeline was not found.');
    }
    if (!pipeline.merged.transitions.some((transition) => transition.key === draft.transitionKey)) {
      throw new WorkflowError('That move is not on the pipeline.');
    }
  }
  const handler = getWorkflowAction(draft.actionKind);
  if (!handler || handler.sendsExternally) {
    throw new WorkflowError(
      'Email and WhatsApp are not sent yet. Choose an in-app alert or a log entry.',
    );
  }
  if (draft.actionKind === 'notify') {
    const title = draft.actionConfig.title;
    const body = draft.actionConfig.body;
    const audience = draft.actionConfig.audience;
    if (typeof title !== 'string' || title.trim().length < 1 || title.length > 120) {
      throw new WorkflowError('Enter an alert title.');
    }
    if (typeof body !== 'string' || body.trim().length < 1 || body.length > 500) {
      throw new WorkflowError('Enter an alert message.');
    }
    if (audience === 'role') {
      if (
        typeof draft.actionConfig.roleKey !== 'string' ||
        !isRoleKey(draft.actionConfig.roleKey)
      ) {
        throw new WorkflowError('Choose who should see the alert.');
      }
    } else if (audience === 'user') {
      if (typeof draft.actionConfig.userId !== 'string') {
        throw new WorkflowError('Choose who should see the alert.');
      }
    } else if (audience !== 'actor') {
      throw new WorkflowError('Choose who should see the alert.');
    }
  }
  if (draft.actionKind === 'audit') {
    const message = draft.actionConfig.message;
    if (typeof message !== 'string' || message.trim().length < 1 || message.length > 500) {
      throw new WorkflowError('Enter the log message.');
    }
  }
}

function rowValues(draft: RuleDraft, tenantId: string) {
  return {
    tenantId,
    name: draft.name.trim(),
    entityType: draft.entityType,
    triggerKind: draft.triggerKind,
    eventKey: draft.triggerKind === 'event' ? draft.eventKey : null,
    machineKey: draft.triggerKind === 'transition' ? draft.machineKey : null,
    transitionKey: draft.triggerKind === 'transition' ? draft.transitionKey : null,
    conditions: draft.conditions,
    actionKind: draft.actionKind,
    actionConfig: draft.actionConfig,
    enabled: draft.enabled,
    updatedAt: new Date(),
  };
}

export async function listRules(tx: TenantTransaction, actorId: string): Promise<RuleView[]> {
  await requirePermission(tx, actorId, { scope: 'krn', action: 'read', moduleId: 'KRN-04' });
  const rows = await tx.db.select().from(workflowRules).orderBy(asc(workflowRules.name));
  return rows.map(toView);
}

export async function createRule(
  tx: TenantTransaction,
  actor: Actor,
  draft: RuleDraft,
): Promise<RuleView> {
  await requirePermission(tx, actor.actorId, {
    scope: 'krn',
    action: 'operate',
    moduleId: 'KRN-04',
  });
  await assertRule(tx, draft);
  const inserted = await tx.db
    .insert(workflowRules)
    .values({ ...rowValues(draft, tx.tenantId), archivedAt: null })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new WorkflowError('The alert was not saved.');
  }
  await audit(tx, {
    action: 'workflow.rule.created',
    entityType: 'krn04_rule',
    entityId: row.id,
    actorId: actor.actorId,
    beforeData: null,
    afterData: { name: row.name, actionKind: row.actionKind, enabled: row.enabled },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  return toView(row);
}

export async function updateRule(
  tx: TenantTransaction,
  actor: Actor,
  id: string,
  draft: RuleDraft,
): Promise<RuleView> {
  await requirePermission(tx, actor.actorId, {
    scope: 'krn',
    action: 'operate',
    moduleId: 'KRN-04',
  });
  const existing = await tx.db.select().from(workflowRules).where(eq(workflowRules.id, id));
  const current = existing[0];
  if (!current || current.archivedAt) {
    throw new WorkflowError('That alert was not found.');
  }
  await assertRule(tx, draft);
  await tx.db
    .update(workflowRules)
    .set(rowValues(draft, tx.tenantId))
    .where(eq(workflowRules.id, id));
  await audit(tx, {
    action: 'workflow.rule.updated',
    entityType: 'krn04_rule',
    entityId: id,
    actorId: actor.actorId,
    beforeData: { name: current.name, enabled: current.enabled },
    afterData: { name: draft.name.trim(), enabled: draft.enabled },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  const again = await tx.db.select().from(workflowRules).where(eq(workflowRules.id, id));
  const next = again[0];
  if (!next) {
    throw new WorkflowError('That alert was not found.');
  }
  return toView(next);
}

export async function archiveRule(tx: TenantTransaction, actor: Actor, id: string): Promise<void> {
  await requirePermission(tx, actor.actorId, {
    scope: 'krn',
    action: 'operate',
    moduleId: 'KRN-04',
  });
  const existing = await tx.db.select().from(workflowRules).where(eq(workflowRules.id, id));
  const current = existing[0];
  if (!current) {
    throw new WorkflowError('That alert was not found.');
  }
  if (current.archivedAt) {
    return;
  }
  const archivedAt = new Date();
  await tx.db
    .update(workflowRules)
    .set({ archivedAt, enabled: false, updatedAt: archivedAt })
    .where(eq(workflowRules.id, id));
  await audit(tx, {
    action: 'workflow.rule.archived',
    entityType: 'krn04_rule',
    entityId: id,
    actorId: actor.actorId,
    beforeData: { archived: false, name: current.name },
    afterData: { archived: true, name: current.name },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
}

export type DispatchInput = {
  entityType: string;
  entityId: string;
  actor: Actor;
  fields?: Record<string, CustomFieldValue>;
  trigger:
    | { kind: 'event'; eventKey: string; stateKey?: string | null }
    | {
        kind: 'transition';
        machineKey: string;
        transitionKey: string;
        fromState: string;
        toState: string;
      };
};

export async function dispatchRules(tx: TenantTransaction, input: DispatchInput): Promise<void> {
  const rows = await tx.db
    .select()
    .from(workflowRules)
    .where(
      and(
        eq(workflowRules.entityType, input.entityType),
        eq(workflowRules.enabled, true),
        isNull(workflowRules.archivedAt),
      ),
    );
  const fields = input.fields ?? (await loadFieldValues(tx, input.entityType, input.entityId));
  const stateKey =
    input.trigger.kind === 'transition'
      ? input.trigger.toState
      : (input.trigger.stateKey ?? (await currentState(tx, input.entityType, input.entityId)));

  for (const row of rows) {
    const matches =
      input.trigger.kind === 'event'
        ? row.triggerKind === 'event' && row.eventKey === input.trigger.eventKey
        : row.triggerKind === 'transition' &&
          row.machineKey === input.trigger.machineKey &&
          row.transitionKey === input.trigger.transitionKey;
    if (!matches) {
      continue;
    }
    if (!conditionsMatch(readConditions(row.conditions), fields, stateKey)) {
      continue;
    }
    const handler = getWorkflowAction(row.actionKind);
    if (!handler || handler.sendsExternally) {
      throw new WorkflowError(
        'Email and WhatsApp are not sent yet. Choose an in-app alert or a log entry.',
      );
    }
    const context: WorkflowActionContext = {
      tx,
      ruleId: row.id,
      ruleName: row.name,
      entityType: input.entityType,
      entityId: input.entityId,
      actorId: input.actor.actorId,
      eventKey: input.trigger.kind === 'event' ? input.trigger.eventKey : null,
      machineKey: input.trigger.kind === 'transition' ? input.trigger.machineKey : null,
      transitionKey: input.trigger.kind === 'transition' ? input.trigger.transitionKey : null,
      fromState: input.trigger.kind === 'transition' ? input.trigger.fromState : null,
      toState: input.trigger.kind === 'transition' ? input.trigger.toState : stateKey,
      fields,
      config: readConfig(row.actionConfig),
      requestIp: input.actor.requestIp,
      userAgent: input.actor.userAgent,
    };
    await handler.run(context);
  }
}

export async function saveCustomFields(
  tx: TenantTransaction,
  actor: Actor,
  input: { entityType: string; entityId: string; values: Record<string, unknown> },
): Promise<Record<string, CustomFieldValue>> {
  const existing = await tx.db
    .select({ id: fieldValues.id })
    .from(fieldValues)
    .where(
      and(eq(fieldValues.entityType, input.entityType), eq(fieldValues.entityId, input.entityId)),
    );
  const previous = await loadFieldValues(tx, input.entityType, input.entityId);
  return saveFieldValues(tx, actor, input, async (values) => {
    await dispatchRules(tx, {
      entityType: input.entityType,
      entityId: input.entityId,
      actor,
      fields: values,
      trigger: { kind: 'event', eventKey: 'fields.saved' },
    });
    const changed = Object.keys({ ...previous, ...values }).filter(
      (key) => JSON.stringify(previous[key] ?? null) !== JSON.stringify(values[key] ?? null),
    );
    await recordChanged(
      tx,
      { actorId: actor.actorId, requestIp: actor.requestIp, userAgent: actor.userAgent },
      {
        entityType: input.entityType,
        entityId: input.entityId,
        event: existing.length === 0 ? 'created' : 'field_changed',
        fieldKeys: changed,
      },
    );
  });
}

export async function startRecord(
  tx: TenantTransaction,
  actor: Actor,
  input: { machineKey: string; entityId: string },
): Promise<{ stateKey: string }> {
  const pipeline = await pipelineByMachine(tx, input.machineKey);
  if (!pipeline) {
    throw new WorkflowError('That pipeline was not found.');
  }
  return openInstance(tx, actor, input, async () => {
    await dispatchRules(tx, {
      entityType: pipeline.row.entityType,
      entityId: input.entityId,
      actor,
      trigger: { kind: 'event', eventKey: 'record.opened' },
    });
  });
}

export async function moveRecord(
  tx: TenantTransaction,
  actor: Actor,
  input: { machineKey: string; entityId: string; transitionKey: string },
): Promise<{ from: string; to: string }> {
  const pipeline = await pipelineByMachine(tx, input.machineKey);
  if (!pipeline) {
    throw new WorkflowError('That pipeline was not found.');
  }
  return applyTransition(tx, actor, input, async (from, to) => {
    await dispatchRules(tx, {
      entityType: pipeline.row.entityType,
      entityId: input.entityId,
      actor,
      trigger: {
        kind: 'transition',
        machineKey: input.machineKey,
        transitionKey: input.transitionKey,
        fromState: from,
        toState: to,
      },
    });
  });
}
