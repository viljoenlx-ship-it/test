import type { TenantTransaction } from '@omnivate/kernel';
import type { FormulaNumber, ModuleId, PermissionAction } from '@omnivate/shared';
import { WorkflowError } from './errors';

/**
 * Modules call these when they load. The maps are process memory, not tenant data.
 * A company cannot invent an entity type. It can add fields and stages to one a module registered,
 * or to a type that already has rows (the fictional sample seed).
 */

const ENTITY_KEY = /^[a-z][a-z0-9_.]{1,63}$/;
const STATE_KEY = /^[a-z][a-z0-9_]{0,40}$/;
const ACTION_KEY = /^[a-z][a-z0-9_.]{1,78}[a-z0-9]$/;

export type BuiltinNumericField = {
  key: string;
  label: string;
  kind: 'number' | 'money' | 'decimal';
};

export type BuiltinReader = (
  tx: TenantTransaction,
  entityId: string,
) => Promise<Record<string, FormulaNumber>>;

export type EntityTypeRegistration = {
  key: string;
  moduleId: ModuleId;
  label: string;
  description: string;
  /** Number, money, and decimal columns that already exist on the record. */
  numericFields?: readonly BuiltinNumericField[];
};

export type MachineState = {
  key: string;
  label: string;
  kind: 'initial' | 'open' | 'terminal';
};

export type TransitionPermission = {
  scope: string;
  action: PermissionAction;
  moduleId?: ModuleId;
};

export type MakerChecker = {
  /** Audit action written when this transition runs. Segregation looks for this string. */
  action: string;
  /** Audit action the same person must not already have on this record. */
  oppositeAction: string;
  description: string;
};

export type MachineTransition = {
  key: string;
  from: string;
  to: string;
  label: string;
  permission: TransitionPermission;
  /**
   * Audit action when this move is the "maker" side and does not itself check segregation.
   * When makerChecker is set, makerChecker.action is the audit action.
   */
  auditAction?: string;
  makerChecker?: MakerChecker;
};

export type StateMachineRegistration = {
  key: string;
  entityType: string;
  moduleId: ModuleId;
  label: string;
  states: MachineState[];
  transitions: MachineTransition[];
};

const entityTypes = new Map<string, EntityTypeRegistration>();
const machines = new Map<string, StateMachineRegistration>();
const builtinReaders = new Map<string, BuiltinReader>();

function requireLabel(label: string, what: string): string {
  const trimmed = label.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new WorkflowError(`Enter a ${what} of up to 80 characters.`);
  }
  return trimmed;
}

export function registerEntityType(definition: EntityTypeRegistration): void {
  if (!ENTITY_KEY.test(definition.key)) {
    throw new WorkflowError(
      'An entity type key looks like sales.quote. Use lowercase letters, digits, dots, and underscores.',
    );
  }
  const label = requireLabel(definition.label, 'name');
  const description = definition.description.trim();
  if (description.length > 240) {
    throw new WorkflowError('Keep the entity description under 240 characters.');
  }
  const numericFields = definition.numericFields ?? [];
  const seen = new Set<string>();
  for (const field of numericFields) {
    if (!STATE_KEY.test(field.key) || seen.has(field.key)) {
      throw new WorkflowError('Each built-in number field needs its own short key.');
    }
    requireLabel(field.label, 'field name');
    if (field.kind !== 'number' && field.kind !== 'money' && field.kind !== 'decimal') {
      throw new WorkflowError('A built-in field is a number, money, or a decimal.');
    }
    seen.add(field.key);
  }
  const existing = entityTypes.get(definition.key);
  if (existing && existing.moduleId !== definition.moduleId) {
    throw new WorkflowError(`${definition.key} is already registered by ${existing.moduleId}.`);
  }
  entityTypes.set(definition.key, {
    key: definition.key,
    moduleId: definition.moduleId,
    label,
    description,
    numericFields,
  });
}

export function registerBuiltinReader(entityType: string, reader: BuiltinReader): void {
  if (!getEntityType(entityType)) {
    throw new WorkflowError(`Register ${entityType} before its built-in values.`);
  }
  builtinReaders.set(entityType, reader);
}

export function getBuiltinReader(entityType: string): BuiltinReader | undefined {
  return builtinReaders.get(entityType);
}

export function listEntityTypes(): EntityTypeRegistration[] {
  return [...entityTypes.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export function getEntityType(key: string): EntityTypeRegistration | undefined {
  return entityTypes.get(key);
}

function checkMachine(definition: StateMachineRegistration): StateMachineRegistration {
  if (!ENTITY_KEY.test(definition.key)) {
    throw new WorkflowError('A state machine key looks like sales.quote.');
  }
  if (!getEntityType(definition.entityType)) {
    throw new WorkflowError(
      `Register the entity type ${definition.entityType} before its state machine.`,
    );
  }
  const label = requireLabel(definition.label, 'pipeline name');
  if (definition.states.length < 2 || definition.states.length > 30) {
    throw new WorkflowError('A pipeline needs between 2 and 30 stages.');
  }
  const stateKeys = new Set<string>();
  let initials = 0;
  for (const state of definition.states) {
    if (!STATE_KEY.test(state.key) || stateKeys.has(state.key)) {
      throw new WorkflowError('Each stage needs its own short key.');
    }
    requireLabel(state.label, 'stage name');
    if (state.kind !== 'initial' && state.kind !== 'open' && state.kind !== 'terminal') {
      throw new WorkflowError('A stage is a starting point, an open stage, or a finishing stage.');
    }
    if (state.kind === 'initial') {
      initials += 1;
    }
    stateKeys.add(state.key);
  }
  if (initials !== 1) {
    throw new WorkflowError('A pipeline needs exactly one starting stage.');
  }
  const transitionKeys = new Set<string>();
  for (const transition of definition.transitions) {
    if (!STATE_KEY.test(transition.key) || transitionKeys.has(transition.key)) {
      throw new WorkflowError('Each move needs its own short key.');
    }
    if (!stateKeys.has(transition.from) || !stateKeys.has(transition.to)) {
      throw new WorkflowError(
        `The move ${transition.label} uses a stage that is not on the pipeline.`,
      );
    }
    if (transition.from === transition.to) {
      throw new WorkflowError('A move has to change the stage.');
    }
    requireLabel(transition.label, 'move name');
    if (transition.auditAction && !ACTION_KEY.test(transition.auditAction)) {
      throw new WorkflowError('Use an audit action such as sales.quote.submit.');
    }
    if (transition.makerChecker) {
      if (
        !ACTION_KEY.test(transition.makerChecker.action) ||
        !ACTION_KEY.test(transition.makerChecker.oppositeAction)
      ) {
        throw new WorkflowError(
          'Maker-checker needs two action keys, such as sales.quote.approve.',
        );
      }
      if (transition.makerChecker.action === transition.makerChecker.oppositeAction) {
        throw new WorkflowError('Maker-checker needs two different actions.');
      }
      const description = transition.makerChecker.description.trim();
      if (description.length < 3 || description.length > 200) {
        throw new WorkflowError('Explain the maker-checker rule in a short sentence.');
      }
    }
    transitionKeys.add(transition.key);
  }
  return { ...definition, label };
}

export function registerStateMachine(definition: StateMachineRegistration): void {
  const checked = checkMachine(definition);
  const existing = machines.get(checked.key);
  if (existing && existing.moduleId !== checked.moduleId) {
    throw new WorkflowError(`${checked.key} is already registered by ${existing.moduleId}.`);
  }
  machines.set(checked.key, checked);
}

export function listStateMachines(): StateMachineRegistration[] {
  return [...machines.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export function getStateMachine(key: string): StateMachineRegistration | undefined {
  return machines.get(key);
}

/** Tests use a fresh registry. The running app does not call this. */
export function resetRegistryForTests(): void {
  entityTypes.clear();
  machines.clear();
  builtinReaders.clear();
}
