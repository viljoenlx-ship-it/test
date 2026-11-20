import {
  ACCESS_SCOPES,
  isModuleId,
  PERMISSION_ACTIONS,
  type ModuleId,
  type PermissionAction,
} from '@omnivate/shared';
import { WorkflowError } from './errors';
import type { MachineState, MachineTransition, MakerChecker } from './registry';

const STATE_KEY = /^[a-z][a-z0-9_]{0,40}$/;
const ACTION_KEY = /^[a-z][a-z0-9_.]{1,78}[a-z0-9]$/;

export type StoredState = MachineState & { origin: 'base' | 'company' };
export type StoredTransition = MachineTransition & { origin: 'base' | 'company' };

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function labelOf(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new WorkflowError('Use a name of up to 80 characters.');
  }
  return trimmed;
}

export function parseStates(value: unknown, origin: 'base' | 'company'): StoredState[] {
  if (!Array.isArray(value)) {
    throw new WorkflowError('Stages are a list.');
  }
  return value.map((item) => {
    const row = record(item);
    if (!row || typeof row.key !== 'string' || !STATE_KEY.test(row.key)) {
      throw new WorkflowError('Each stage needs a short key.');
    }
    const kind = row.kind;
    if (kind !== 'initial' && kind !== 'open' && kind !== 'terminal') {
      throw new WorkflowError('A stage is a starting point, an open stage, or a finishing stage.');
    }
    if (origin === 'company' && kind === 'initial') {
      throw new WorkflowError(
        'The starting stage comes from the module. Add an open stage instead.',
      );
    }
    return { key: row.key, label: labelOf(row.label, row.key), kind, origin };
  });
}

function parsePermission(value: unknown): MachineTransition['permission'] {
  const row = record(value);
  if (!row || typeof row.scope !== 'string' || typeof row.action !== 'string') {
    throw new WorkflowError('Each move needs a permission.');
  }
  if (!ACCESS_SCOPES.some((scope) => scope.scope === row.scope)) {
    throw new WorkflowError('Choose a permission that exists on a role.');
  }
  if (!(PERMISSION_ACTIONS as readonly string[]).includes(row.action)) {
    throw new WorkflowError('Choose a permission that exists on a role.');
  }
  let moduleId: ModuleId | undefined;
  if (row.moduleId !== undefined && row.moduleId !== null) {
    if (typeof row.moduleId !== 'string' || !isModuleId(row.moduleId)) {
      throw new WorkflowError('Choose a module that exists.');
    }
    moduleId = row.moduleId;
  }
  return { scope: row.scope, action: row.action as PermissionAction, moduleId };
}

function parseMakerChecker(value: unknown): MakerChecker | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const row = record(value);
  if (
    !row ||
    typeof row.action !== 'string' ||
    typeof row.oppositeAction !== 'string' ||
    typeof row.description !== 'string'
  ) {
    throw new WorkflowError('Maker-checker needs two actions and a short explanation.');
  }
  if (!ACTION_KEY.test(row.action) || !ACTION_KEY.test(row.oppositeAction)) {
    throw new WorkflowError('Use action keys such as sales.quote.approve.');
  }
  if (row.action === row.oppositeAction) {
    throw new WorkflowError('Maker-checker needs two different actions.');
  }
  const description = row.description.trim();
  if (description.length < 3 || description.length > 200) {
    throw new WorkflowError('Explain the maker-checker rule in a short sentence.');
  }
  return { action: row.action, oppositeAction: row.oppositeAction, description };
}

export function parseTransitions(value: unknown, origin: 'base' | 'company'): StoredTransition[] {
  if (!Array.isArray(value)) {
    throw new WorkflowError('Moves are a list.');
  }
  return value.map((item) => {
    const row = record(item);
    if (!row || typeof row.key !== 'string' || !STATE_KEY.test(row.key)) {
      throw new WorkflowError('Each move needs a short key.');
    }
    if (typeof row.from !== 'string' || typeof row.to !== 'string') {
      throw new WorkflowError('Each move needs a from stage and a to stage.');
    }
    const auditAction =
      typeof row.auditAction === 'string' && row.auditAction.length > 0
        ? row.auditAction
        : undefined;
    if (auditAction && !ACTION_KEY.test(auditAction)) {
      throw new WorkflowError('Use an audit action such as sales.quote.submit.');
    }
    return {
      key: row.key,
      from: row.from,
      to: row.to,
      label: labelOf(row.label, row.key),
      permission: parsePermission(row.permission),
      auditAction,
      makerChecker: parseMakerChecker(row.makerChecker),
      origin,
    };
  });
}

export function mergePipeline(
  baseStates: MachineState[],
  baseTransitions: MachineTransition[],
  extraStates: unknown,
  extraTransitions: unknown,
): { states: StoredState[]; transitions: StoredTransition[] } {
  const states: StoredState[] = baseStates.map((state) => ({ ...state, origin: 'base' as const }));
  const extras = parseStates(extraStates, 'company');
  const seen = new Set(states.map((state) => state.key));
  for (const state of extras) {
    if (seen.has(state.key)) {
      throw new WorkflowError(`The stage ${state.label} is already on this pipeline.`);
    }
    seen.add(state.key);
    states.push(state);
  }
  if (states.filter((state) => state.kind === 'initial').length !== 1) {
    throw new WorkflowError('A pipeline needs exactly one starting stage.');
  }
  const transitions: StoredTransition[] = baseTransitions.map((transition) => ({
    ...transition,
    origin: 'base' as const,
  }));
  const extraMoves = parseTransitions(extraTransitions, 'company');
  const moveKeys = new Set(transitions.map((transition) => transition.key));
  for (const transition of extraMoves) {
    if (moveKeys.has(transition.key)) {
      throw new WorkflowError(`The move ${transition.label} is already on this pipeline.`);
    }
    if (
      !seen.has(transition.from) ||
      !seen.has(transition.to) ||
      transition.from === transition.to
    ) {
      throw new WorkflowError(
        `The move ${transition.label} uses a stage that is not on the pipeline.`,
      );
    }
    moveKeys.add(transition.key);
    transitions.push(transition);
  }
  if (states.length > 30 || transitions.length > 60) {
    throw new WorkflowError('This pipeline has too many stages.');
  }
  return { states, transitions };
}

export function auditActionFor(transition: MachineTransition): string {
  return transition.makerChecker?.action ?? transition.auditAction ?? 'workflow.transition';
}
