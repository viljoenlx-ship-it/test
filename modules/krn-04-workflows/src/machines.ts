import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  addSodRule,
  assertSegregation,
  orderedSodActions,
  requirePermission,
  sodRules,
  type TenantTransaction,
} from '@omnivate/kernel';
import { audit, type Actor } from './actions';
import { WorkflowError } from './errors';
import { getEntityType, getStateMachine } from './registry';
import {
  auditActionFor,
  mergePipeline,
  parseStates,
  parseTransitions,
  type StoredTransition,
} from './shape';
import { instances, pipelines, transitionLog } from './tables';

type PipelineRow = typeof pipelines.$inferSelect;

async function ensureMakerChecker(
  tx: TenantTransaction,
  actor: Actor,
  transitions: StoredTransition[],
): Promise<void> {
  const seen = new Set<string>();
  for (const transition of transitions) {
    const pair = transition.makerChecker;
    if (!pair) {
      continue;
    }
    const [actionA, actionB] = orderedSodActions(pair.action, pair.oppositeAction);
    const key = `${actionA}|${actionB}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const existing = await tx.db
      .select({ id: sodRules.id, enabled: sodRules.enabled })
      .from(sodRules)
      .where(and(eq(sodRules.actionA, actionA), eq(sodRules.actionB, actionB)));
    if (existing[0]?.enabled) {
      continue;
    }
    await addSodRule(tx, {
      actorId: actor.actorId,
      actionA,
      actionB,
      description: pair.description,
      requestIp: actor.requestIp,
      userAgent: actor.userAgent,
    });
  }
}

function resolved(row: PipelineRow) {
  const registered = getStateMachine(row.machineKey);
  const baseStates = registered ? registered.states : parseStates(row.baseStates, 'base');
  const baseTransitions = registered
    ? registered.transitions
    : parseTransitions(row.baseTransitions, 'base');
  return mergePipeline(baseStates, baseTransitions, row.extraStates, row.extraTransitions);
}

export type PipelineView = {
  id: string;
  machineKey: string;
  entityType: string;
  entityLabel: string;
  label: string;
  archived: boolean;
  fromModule: boolean;
  states: { key: string; label: string; kind: string; origin: 'base' | 'company' }[];
  transitions: {
    key: string;
    from: string;
    to: string;
    label: string;
    origin: 'base' | 'company';
    makerChecker: boolean;
  }[];
  records: {
    entityId: string;
    stateKey: string;
    stateLabel: string;
    history: { transitionKey: string; label: string; from: string; to: string; at: string }[];
  }[];
};

async function viewOf(tx: TenantTransaction, row: PipelineRow): Promise<PipelineView> {
  const merged = resolved(row);
  const records = await tx.db
    .select()
    .from(instances)
    .where(eq(instances.pipelineId, row.id))
    .limit(5);
  const history = await tx.db
    .select()
    .from(transitionLog)
    .where(eq(transitionLog.pipelineId, row.id))
    .orderBy(asc(transitionLog.occurredAt));
  const labelByKey = new Map(
    merged.transitions.map((transition) => [transition.key, transition.label]),
  );
  const stateLabel = new Map(merged.states.map((state) => [state.key, state.label]));
  return {
    id: row.id,
    machineKey: row.machineKey,
    entityType: row.entityType,
    entityLabel: row.entityLabel,
    label: row.label,
    archived: row.archivedAt !== null,
    fromModule: getStateMachine(row.machineKey) !== undefined,
    states: merged.states.map((state) => ({
      key: state.key,
      label: state.label,
      kind: state.kind,
      origin: state.origin,
    })),
    transitions: merged.transitions.map((transition) => ({
      key: transition.key,
      from: transition.from,
      to: transition.to,
      label: transition.label,
      origin: transition.origin,
      makerChecker: Boolean(transition.makerChecker),
    })),
    records: records.map((record) => ({
      entityId: record.entityId,
      stateKey: record.stateKey,
      stateLabel: stateLabel.get(record.stateKey) ?? record.stateKey,
      history: history
        .filter((entry) => entry.entityId === record.entityId)
        .map((entry) => ({
          transitionKey: entry.transitionKey,
          label: labelByKey.get(entry.transitionKey) ?? entry.transitionKey,
          from: stateLabel.get(entry.fromState) ?? entry.fromState,
          to: stateLabel.get(entry.toState) ?? entry.toState,
          at: entry.occurredAt.toISOString(),
        })),
    })),
  };
}

export async function listPipelines(
  tx: TenantTransaction,
  actorId: string,
): Promise<PipelineView[]> {
  await requirePermission(tx, actorId, { scope: 'krn', action: 'read', moduleId: 'KRN-04' });
  const rows = await tx.db.select().from(pipelines).orderBy(asc(pipelines.label));
  const views: PipelineView[] = [];
  for (const row of rows) {
    views.push(await viewOf(tx, row));
  }
  return views;
}

export async function installMachine(
  tx: TenantTransaction,
  actor: Actor,
  machineKey: string,
): Promise<PipelineView> {
  await requirePermission(tx, actor.actorId, {
    scope: 'krn',
    action: 'operate',
    moduleId: 'KRN-04',
  });
  const machine = getStateMachine(machineKey);
  if (!machine) {
    throw new WorkflowError('That pipeline is not registered by a module yet.');
  }
  const entity = getEntityType(machine.entityType);
  if (!entity) {
    throw new WorkflowError('Register the entity type before installing its pipeline.');
  }
  const existing = await tx.db.select().from(pipelines).where(eq(pipelines.machineKey, machineKey));
  const now = new Date();
  let row = existing[0];
  if (!row) {
    const inserted = await tx.db
      .insert(pipelines)
      .values({
        tenantId: tx.tenantId,
        machineKey,
        entityType: machine.entityType,
        entityLabel: entity.label,
        label: machine.label,
        baseStates: machine.states,
        baseTransitions: machine.transitions,
        extraStates: [],
        extraTransitions: [],
        updatedAt: now,
      })
      .returning();
    row = inserted[0];
  } else {
    await tx.db
      .update(pipelines)
      .set({
        entityType: machine.entityType,
        entityLabel: entity.label,
        baseStates: machine.states,
        baseTransitions: machine.transitions,
        archivedAt: null,
        updatedAt: now,
      })
      .where(eq(pipelines.id, row.id));
    row = {
      ...row,
      baseStates: machine.states,
      baseTransitions: machine.transitions,
      archivedAt: null,
    };
  }
  if (!row) {
    throw new WorkflowError('The pipeline was not saved.');
  }
  const merged = resolved(row);
  await ensureMakerChecker(tx, actor, merged.transitions);
  await audit(tx, {
    action: 'workflow.pipeline.updated',
    entityType: 'krn04_pipeline',
    entityId: row.id,
    actorId: actor.actorId,
    beforeData: null,
    afterData: { machineKey, label: row.label, states: merged.states.map((state) => state.key) },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  return viewOf(tx, row);
}

export async function updatePipelineExtras(
  tx: TenantTransaction,
  actor: Actor,
  id: string,
  input: { label?: string; extraStates: unknown; extraTransitions: unknown },
): Promise<PipelineView> {
  await requirePermission(tx, actor.actorId, {
    scope: 'krn',
    action: 'operate',
    moduleId: 'KRN-04',
  });
  const rows = await tx.db.select().from(pipelines).where(eq(pipelines.id, id));
  const current = rows[0];
  if (!current || current.archivedAt) {
    throw new WorkflowError('That pipeline was not found.');
  }
  const registered = getStateMachine(current.machineKey);
  const baseStates = registered ? registered.states : parseStates(current.baseStates, 'base');
  const baseTransitions = registered
    ? registered.transitions
    : parseTransitions(current.baseTransitions, 'base');
  const merged = mergePipeline(
    baseStates,
    baseTransitions,
    input.extraStates,
    input.extraTransitions,
  );
  const label = input.label?.trim() || current.label;
  if (label.length < 1 || label.length > 80) {
    throw new WorkflowError('Enter a pipeline name of up to 80 characters.');
  }
  const companyTransitions = merged.transitions.filter(
    (transition) => transition.origin === 'company',
  );
  await ensureMakerChecker(tx, actor, companyTransitions);
  const now = new Date();
  await tx.db
    .update(pipelines)
    .set({
      label,
      extraStates: input.extraStates,
      extraTransitions: input.extraTransitions,
      updatedAt: now,
    })
    .where(eq(pipelines.id, id));
  await audit(tx, {
    action: 'workflow.pipeline.updated',
    entityType: 'krn04_pipeline',
    entityId: id,
    actorId: actor.actorId,
    beforeData: { label: current.label, extraStates: current.extraStates },
    afterData: { label, extraStates: input.extraStates, baseUntouched: true },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  return viewOf(tx, {
    ...current,
    label,
    extraStates: input.extraStates,
    extraTransitions: input.extraTransitions,
  });
}

/** Base stages are part of the module. Company settings cannot remove them. */
export function rejectBaseReplacement(): never {
  throw new WorkflowError('Stages that came with the module stay on the pipeline.');
}

export async function archivePipeline(
  tx: TenantTransaction,
  actor: Actor,
  id: string,
): Promise<void> {
  await requirePermission(tx, actor.actorId, {
    scope: 'krn',
    action: 'operate',
    moduleId: 'KRN-04',
  });
  const rows = await tx.db.select().from(pipelines).where(eq(pipelines.id, id));
  const current = rows[0];
  if (!current) {
    throw new WorkflowError('That pipeline was not found.');
  }
  if (current.archivedAt) {
    return;
  }
  const archivedAt = new Date();
  await tx.db
    .update(pipelines)
    .set({ archivedAt, updatedAt: archivedAt })
    .where(eq(pipelines.id, id));
  await audit(tx, {
    action: 'workflow.pipeline.archived',
    entityType: 'krn04_pipeline',
    entityId: id,
    actorId: actor.actorId,
    beforeData: { archived: false, label: current.label },
    afterData: { archived: true, label: current.label },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
}

async function loadPipeline(tx: TenantTransaction, machineKey: string): Promise<PipelineRow> {
  const rows = await tx.db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.machineKey, machineKey), isNull(pipelines.archivedAt)));
  const row = rows[0];
  if (!row) {
    throw new WorkflowError('That pipeline is not set up for this company yet.');
  }
  return row;
}

export async function openInstance(
  tx: TenantTransaction,
  actor: Actor,
  input: { machineKey: string; entityId: string },
  dispatch: (stateKey: string) => Promise<void>,
): Promise<{ stateKey: string }> {
  await requirePermission(tx, actor.actorId, {
    scope: 'krn',
    action: 'operate',
    moduleId: 'KRN-04',
  });
  const row = await loadPipeline(tx, input.machineKey);
  const merged = resolved(row);
  const initial = merged.states.find((state) => state.kind === 'initial');
  if (!initial) {
    throw new WorkflowError('This pipeline has no starting stage.');
  }
  const existing = await tx.db
    .select({ id: instances.id })
    .from(instances)
    .where(and(eq(instances.pipelineId, row.id), eq(instances.entityId, input.entityId)));
  if (existing[0]) {
    throw new WorkflowError('This record is already on the pipeline.');
  }
  await tx.db.insert(instances).values({
    tenantId: tx.tenantId,
    pipelineId: row.id,
    entityId: input.entityId,
    stateKey: initial.key,
  });
  await audit(tx, {
    action: 'workflow.transition',
    entityType: row.entityType,
    entityId: input.entityId,
    actorId: actor.actorId,
    beforeData: null,
    afterData: { kind: 'transition', label: initial.label, state: initial.key },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  await dispatch(initial.key);
  return { stateKey: initial.key };
}

export async function applyTransition(
  tx: TenantTransaction,
  actor: Actor,
  input: { machineKey: string; entityId: string; transitionKey: string },
  dispatch: (from: string, to: string) => Promise<void>,
): Promise<{ from: string; to: string }> {
  const row = await loadPipeline(tx, input.machineKey);
  const merged = resolved(row);
  const current = await tx.db
    .select()
    .from(instances)
    .where(and(eq(instances.pipelineId, row.id), eq(instances.entityId, input.entityId)));
  const instance = current[0];
  if (!instance) {
    throw new WorkflowError('This record has not been started.');
  }
  const transition = merged.transitions.find(
    (item) => item.key === input.transitionKey && item.from === instance.stateKey,
  );
  if (!transition) {
    throw new WorkflowError('That move is not available from the current stage.');
  }
  await requirePermission(tx, actor.actorId, {
    scope: transition.permission.scope,
    action: transition.permission.action,
    moduleId: transition.permission.moduleId,
  });
  const action = auditActionFor(transition);
  if (transition.makerChecker) {
    await assertSegregation(tx, {
      actorId: actor.actorId,
      action: transition.makerChecker.action,
      entityId: input.entityId,
    });
  }
  const now = new Date();
  await tx.db
    .update(instances)
    .set({ stateKey: transition.to, updatedAt: now })
    .where(eq(instances.id, instance.id));
  await tx.db.insert(transitionLog).values({
    tenantId: tx.tenantId,
    pipelineId: row.id,
    entityId: input.entityId,
    transitionKey: transition.key,
    fromState: instance.stateKey,
    toState: transition.to,
    actorId: actor.actorId,
    occurredAt: now,
  });
  await audit(tx, {
    action,
    entityType: row.entityType,
    entityId: input.entityId,
    actorId: actor.actorId,
    beforeData: { kind: 'transition', state: instance.stateKey, label: transition.label },
    afterData: {
      kind: 'transition',
      state: transition.to,
      from: instance.stateKey,
      to: transition.to,
      label: transition.label,
    },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  await dispatch(instance.stateKey, transition.to);
  return { from: instance.stateKey, to: transition.to };
}

/**
 * Moves a record because an operator automation said so.
 * The person's own permission is not checked again. Maker-checker still applies.
 */
export async function moveToStage(
  tx: TenantTransaction,
  actor: Actor | null,
  input: { machineKey: string; entityId: string; toState: string },
): Promise<{ ok: true; from: string; to: string; label: string } | { ok: false; message: string }> {
  const rows = await tx.db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.machineKey, input.machineKey), isNull(pipelines.archivedAt)));
  const row = rows[0];
  if (!row) {
    return { ok: false, message: 'That pipeline was not found.' };
  }
  const merged = resolved(row);
  const target = merged.states.find((state) => state.key === input.toState);
  if (!target) {
    return { ok: false, message: 'That stage is not on the pipeline.' };
  }
  const current = await tx.db
    .select()
    .from(instances)
    .where(and(eq(instances.pipelineId, row.id), eq(instances.entityId, input.entityId)));
  const instance = current[0];
  if (!instance) {
    return { ok: false, message: 'This record is not on the pipeline yet.' };
  }
  if (instance.stateKey === input.toState) {
    return { ok: true, from: instance.stateKey, to: input.toState, label: target.label };
  }
  const transition = merged.transitions.find(
    (item) => item.from === instance.stateKey && item.to === input.toState,
  );
  if (!transition) {
    return { ok: false, message: 'There is no move from the current stage to that stage.' };
  }
  if (transition.makerChecker && actor) {
    try {
      await assertSegregation(tx, {
        actorId: actor.actorId,
        action: transition.makerChecker.action,
        entityId: input.entityId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Maker-checker stopped this move.';
      return { ok: false, message };
    }
  }
  const now = new Date();
  await tx.db
    .update(instances)
    .set({ stateKey: transition.to, updatedAt: now })
    .where(eq(instances.id, instance.id));
  await tx.db.insert(transitionLog).values({
    tenantId: tx.tenantId,
    pipelineId: row.id,
    entityId: input.entityId,
    transitionKey: transition.key,
    fromState: instance.stateKey,
    toState: transition.to,
    actorId: actor?.actorId ?? null,
    occurredAt: now,
  });
  await audit(tx, {
    action: auditActionFor(transition),
    entityType: row.entityType,
    entityId: input.entityId,
    actorId: actor?.actorId ?? null,
    beforeData: { kind: 'transition', state: instance.stateKey },
    afterData: {
      kind: 'transition',
      state: transition.to,
      from: instance.stateKey,
      to: transition.to,
      label: transition.label,
      automation: true,
    },
    requestIp: actor?.requestIp ?? null,
    userAgent: actor?.userAgent ?? null,
  });
  return { ok: true, from: instance.stateKey, to: transition.to, label: target.label };
}

export async function currentState(
  tx: TenantTransaction,
  entityType: string,
  entityId: string,
): Promise<string | null> {
  const rows = await tx.db
    .select({ stateKey: instances.stateKey })
    .from(instances)
    .innerJoin(pipelines, eq(pipelines.id, instances.pipelineId))
    .where(and(eq(pipelines.entityType, entityType), eq(instances.entityId, entityId)))
    .limit(1);
  return rows[0]?.stateKey ?? null;
}

export async function pipelineByMachine(tx: TenantTransaction, machineKey: string) {
  const rows = await tx.db.select().from(pipelines).where(eq(pipelines.machineKey, machineKey));
  const row = rows[0];
  if (!row) {
    return null;
  }
  return { row, merged: resolved(row) };
}
