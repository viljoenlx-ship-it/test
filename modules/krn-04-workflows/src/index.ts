import './builtins';

export { registerWorkflowAction, listWorkflowActions, type WorkflowActionHandler } from './actions';
export type { Actor } from './actions';
export { WorkflowError } from './errors';
export {
  archiveFieldDefinition,
  createFieldDefinition,
  listDefinitions,
  loadFieldValues,
  mergeCalculated,
  numericFieldList,
  saveFieldValues,
  updateFieldDefinition,
  type FieldDraft,
} from './fields';
export {
  applyTransition,
  installMachine,
  listPipelines,
  openInstance,
  rejectBaseReplacement,
  updatePipelineExtras,
} from './machines';
export { registerKrn04 } from './register';
export {
  getBuiltinReader,
  getEntityType,
  getStateMachine,
  listEntityTypes,
  listStateMachines,
  registerBuiltinReader,
  registerEntityType,
  registerStateMachine,
  resetRegistryForTests,
  type EntityTypeRegistration,
  type MachineState,
  type MachineTransition,
  type StateMachineRegistration,
} from './registry';
export { workflowSummary } from './summary';
export {
  AUTOMATION_MAX_DEPTH,
  archiveAutomation,
  createAutomation,
  recordChanged,
  type AutomationDraft,
} from './automations';
export {
  archiveRule,
  conditionsMatch,
  createRule,
  dispatchRules,
  moveRecord,
  saveCustomFields,
  startRecord,
  type RuleDraft,
} from './workflows';
