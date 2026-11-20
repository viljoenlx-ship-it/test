import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  hasPermission,
  PermissionDeniedError,
  requirePermission,
  type TenantTransaction,
} from '@omnivate/kernel';
import {
  evaluateFormula,
  formulaCents,
  formulaCycle,
  formulaDecimal,
  formulaReferences,
  isFieldKey,
  isFieldType,
  isOptionValue,
  parseFormula,
  validateCustomValues,
  type CustomFieldDefinition,
  type CustomFieldValue,
  type FieldOption,
  type FieldType,
  type FormulaDisplay,
  type FormulaNumber,
} from '@omnivate/shared';
import { audit, type Actor } from './actions';
import { WorkflowError } from './errors';
import { getBuiltinReader, getEntityType } from './registry';
import { fieldDefinitions, fieldValues, pipelines } from './tables';

const NUMBER_VALUE = /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/;

export type FieldDraft = {
  entityType: string;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  description: string;
  minLength: number | null;
  maxLength: number | null;
  minNumber: string | null;
  maxNumber: string | null;
  minCents: number | null;
  maxCents: number | null;
  options: FieldOption[];
  formula: string | null;
  formulaPlaces: number | null;
  formulaDisplay: FormulaDisplay | null;
  formulaUnit: string;
};

function centsOrNull(value: bigint | null): number | null {
  if (value === null) {
    return null;
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new WorkflowError('That amount is too large.');
  }
  return Number(value);
}

function readOptions(value: unknown): FieldOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const options: FieldOption[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const row = item as { value?: unknown; label?: unknown };
    if (typeof row.value !== 'string' || typeof row.label !== 'string') {
      continue;
    }
    options.push({ value: row.value, label: row.label });
  }
  return options;
}

export function toDefinition(row: typeof fieldDefinitions.$inferSelect): CustomFieldDefinition {
  return {
    id: row.id,
    entityType: row.entityType,
    entityLabel: row.entityLabel,
    fieldKey: row.fieldKey,
    label: row.label,
    fieldType: isFieldType(row.fieldType) ? row.fieldType : 'text',
    required: row.required,
    description: row.description,
    sortOrder: row.sortOrder,
    minLength: row.minLength,
    maxLength: row.maxLength,
    minNumber: row.minNumber,
    maxNumber: row.maxNumber,
    minCents: centsOrNull(row.minCents),
    maxCents: centsOrNull(row.maxCents),
    options: readOptions(row.options),
    archived: row.archivedAt !== null,
    formula: row.formula,
    formulaPlaces: row.formulaPlaces,
    formulaDisplay:
      row.formulaDisplay === 'money' || row.formulaDisplay === 'number' ? row.formulaDisplay : null,
    formulaUnit: row.formulaUnit,
  };
}

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && current.code === '23505') {
      return true;
    }
    current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

function checkBounds(draft: FieldDraft): void {
  const label = draft.label.trim();
  if (label.length < 1 || label.length > 80) {
    throw new WorkflowError('Enter a field name of up to 80 characters.');
  }
  if (!isFieldKey(draft.fieldKey)) {
    throw new WorkflowError('Use a short key such as site_contact.');
  }
  if (draft.description.trim().length > 240) {
    throw new WorkflowError('Keep the help text under 240 characters.');
  }
  if (
    (draft.fieldType === 'select' || draft.fieldType === 'multi_select') &&
    draft.options.length < 1
  ) {
    throw new WorkflowError('Add at least one choice.');
  }
  const seen = new Set<string>();
  for (const option of draft.options) {
    if (
      !isOptionValue(option.value) ||
      option.label.trim().length < 1 ||
      option.label.length > 80
    ) {
      throw new WorkflowError('Each choice needs a short name.');
    }
    if (seen.has(option.value)) {
      throw new WorkflowError('Each choice can only appear once.');
    }
    seen.add(option.value);
  }
  if (
    draft.fieldType !== 'select' &&
    draft.fieldType !== 'multi_select' &&
    draft.options.length > 0
  ) {
    throw new WorkflowError('Only a dropdown has choices.');
  }
  if (draft.minLength !== null || draft.maxLength !== null) {
    if (draft.fieldType !== 'text') {
      throw new WorkflowError('Length limits are for text fields.');
    }
    const min = draft.minLength ?? 0;
    const max = draft.maxLength ?? 500;
    if (min < 0 || max < 1 || max > 2000 || min > max) {
      throw new WorkflowError('Check the text length limits.');
    }
  }
  if (draft.minNumber !== null || draft.maxNumber !== null) {
    if (draft.fieldType !== 'number') {
      throw new WorkflowError('Number limits are for number fields.');
    }
    if (
      (draft.minNumber !== null && !NUMBER_VALUE.test(draft.minNumber)) ||
      (draft.maxNumber !== null && !NUMBER_VALUE.test(draft.maxNumber))
    ) {
      throw new WorkflowError('Enter number limits such as 0 and 300.');
    }
  }
  if (draft.minCents !== null || draft.maxCents !== null) {
    if (draft.fieldType !== 'money') {
      throw new WorkflowError('Money limits are for money fields.');
    }
    for (const amount of [draft.minCents, draft.maxCents]) {
      if (amount !== null && !Number.isSafeInteger(amount)) {
        throw new WorkflowError('Enter money limits in cents.');
      }
    }
    if (draft.minCents !== null && draft.maxCents !== null && draft.minCents > draft.maxCents) {
      throw new WorkflowError('The minimum amount is higher than the maximum.');
    }
  }
  if (draft.fieldType === 'calculated') {
    if (draft.required) {
      throw new WorkflowError('A calculated field is filled in for you. It cannot be required.');
    }
    if (
      draft.options.length > 0 ||
      draft.minLength !== null ||
      draft.maxLength !== null ||
      draft.minNumber !== null ||
      draft.maxNumber !== null ||
      draft.minCents !== null ||
      draft.maxCents !== null
    ) {
      throw new WorkflowError('A calculated field uses a formula, not limits or choices.');
    }
    if (!draft.formula || draft.formula.trim().length < 1) {
      throw new WorkflowError('Add a formula.');
    }
    if (draft.formulaDisplay !== 'number' && draft.formulaDisplay !== 'money') {
      throw new WorkflowError('Choose whether to show a number or money.');
    }
    if (
      draft.formulaPlaces === null ||
      !Number.isInteger(draft.formulaPlaces) ||
      draft.formulaPlaces < 0 ||
      draft.formulaPlaces > 4
    ) {
      throw new WorkflowError('Choose how to round the result.');
    }
    if (draft.formulaDisplay === 'money' && draft.formulaPlaces !== 0) {
      throw new WorkflowError('Money is rounded to the nearest cent.');
    }
    if (draft.formulaUnit.trim().length > 20) {
      throw new WorkflowError('Keep the unit under 20 characters.');
    }
    if (draft.formulaDisplay === 'money' && draft.formulaUnit.trim().length > 0) {
      throw new WorkflowError('Money is shown in rand. Leave the unit blank.');
    }
  } else if (draft.formula || draft.formulaDisplay || draft.formulaPlaces !== null) {
    throw new WorkflowError('Only a calculated field has a formula.');
  }
}

function formulaColumns(draft: FieldDraft): {
  formula: string | null;
  formulaPlaces: number | null;
  formulaDisplay: FormulaDisplay | null;
  formulaUnit: string;
} {
  if (draft.fieldType !== 'calculated') {
    return { formula: null, formulaPlaces: null, formulaDisplay: null, formulaUnit: '' };
  }
  return {
    formula: draft.formula?.trim() ?? null,
    formulaPlaces: draft.formulaPlaces,
    formulaDisplay: draft.formulaDisplay,
    formulaUnit: draft.formulaDisplay === 'number' ? draft.formulaUnit.trim() : '',
  };
}

export type NumericInput = {
  key: string;
  label: string;
  kind: 'number' | 'money' | 'decimal';
  formula: string | null;
  source: 'builtin' | 'custom';
};

export async function numericFieldList(
  tx: TenantTransaction,
  entityType: string,
): Promise<NumericInput[]> {
  const builtins = getEntityType(entityType)?.numericFields ?? [];
  const definitions = await loadDefinitionsForEntity(tx, entityType);
  const inputs: NumericInput[] = builtins.map((field) => ({
    key: field.key,
    label: field.label,
    kind: field.kind,
    formula: null,
    source: 'builtin',
  }));
  for (const definition of definitions) {
    if (definition.archived) {
      continue;
    }
    if (definition.fieldType === 'number') {
      inputs.push({
        key: definition.fieldKey,
        label: definition.label,
        kind: 'number',
        formula: null,
        source: 'custom',
      });
    } else if (definition.fieldType === 'money') {
      inputs.push({
        key: definition.fieldKey,
        label: definition.label,
        kind: 'money',
        formula: null,
        source: 'custom',
      });
    } else if (definition.fieldType === 'calculated') {
      inputs.push({
        key: definition.fieldKey,
        label: definition.label,
        kind: definition.formulaDisplay === 'money' ? 'money' : 'number',
        formula: definition.formula ?? null,
        source: 'custom',
      });
    }
  }
  return inputs;
}

async function assertFormula(
  tx: TenantTransaction,
  draft: FieldDraft,
  currentId?: string,
): Promise<void> {
  const builtins = getEntityType(draft.entityType)?.numericFields ?? [];
  if (builtins.some((field) => field.key === draft.fieldKey)) {
    throw new WorkflowError('That name is already a field on this record.');
  }
  if (draft.fieldType !== 'calculated' || !draft.formula) {
    return;
  }
  const inputs = await numericFieldList(tx, draft.entityType);
  const others = inputs.filter((field) => field.key !== draft.fieldKey);
  const allowed = new Set<string>([...others.map((field) => field.key), draft.fieldKey]);
  const parsed = parseFormula(draft.formula, allowed);
  if (!parsed.ok) {
    throw new WorkflowError(parsed.message);
  }
  const formulas = others
    .filter((field) => field.formula && field.key !== draft.fieldKey)
    .map((field) => ({ key: field.key, label: field.label, formula: field.formula ?? '' }));
  if (currentId) {
    const rows = await tx.db
      .select({ id: fieldDefinitions.id, fieldKey: fieldDefinitions.fieldKey })
      .from(fieldDefinitions)
      .where(eq(fieldDefinitions.entityType, draft.entityType));
    const clash = rows.find((row) => row.fieldKey === draft.fieldKey && row.id !== currentId);
    if (clash) {
      throw new WorkflowError('That field key is already used on this record.');
    }
  }
  const cycle = formulaCycle(
    [
      ...formulas,
      { key: draft.fieldKey, label: draft.label.trim(), formula: draft.formula.trim() },
    ],
    allowed,
  );
  if (cycle) {
    throw new WorkflowError(cycle);
  }
}

export async function mergeCalculated(
  tx: TenantTransaction,
  entityType: string,
  entityId: string,
  values: Record<string, CustomFieldValue>,
): Promise<Record<string, CustomFieldValue>> {
  const definitions = (await loadDefinitionsForEntity(tx, entityType)).filter(
    (definition) =>
      !definition.archived && definition.fieldType === 'calculated' && definition.formula,
  );
  if (definitions.length === 0) {
    return values;
  }
  const inputs = await numericFieldList(tx, entityType);
  const allowed = new Set(inputs.map((field) => field.key));
  const reader = getBuiltinReader(entityType);
  const builtins = reader ? await reader(tx, entityId) : {};
  const ordered = orderCalculated(definitions, allowed);
  const next: Record<string, CustomFieldValue> = { ...values };
  for (const definition of definitions) {
    delete next[definition.fieldKey];
  }
  for (const definition of ordered) {
    const result = evaluateFormula(
      definition.formula ?? '',
      allowed,
      valueMap(next, builtins, inputs),
    );
    if (!result.ok) {
      if (result.code === 'missing') {
        continue;
      }
      throw new WorkflowError(
        definition.label ? `${definition.label}: ${result.message}` : result.message,
      );
    }
    if (definition.formulaDisplay === 'money') {
      const cents = formulaCents(result.scaled);
      if (!cents.ok) {
        throw new WorkflowError(`${definition.label}: ${cents.message}`);
      }
      next[definition.fieldKey] = cents.cents;
    } else {
      const decimal = formulaDecimal(result.scaled, definition.formulaPlaces ?? 0);
      if (!decimal.ok) {
        throw new WorkflowError(`${definition.label}: ${decimal.message}`);
      }
      next[definition.fieldKey] = decimal.text;
    }
  }
  return next;
}

function orderCalculated(
  definitions: readonly CustomFieldDefinition[],
  allowed: ReadonlySet<string>,
): CustomFieldDefinition[] {
  const byKey = new Map(definitions.map((definition) => [definition.fieldKey, definition]));
  const indegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const definition of definitions) {
    indegree.set(definition.fieldKey, 0);
    children.set(definition.fieldKey, []);
  }
  for (const definition of definitions) {
    for (const ref of formulaReferences(definition.formula ?? '', allowed)) {
      if (!byKey.has(ref)) {
        continue;
      }
      indegree.set(definition.fieldKey, (indegree.get(definition.fieldKey) ?? 0) + 1);
      children.get(ref)?.push(definition.fieldKey);
    }
  }
  const queue = [...indegree.entries()].filter((entry) => entry[1] === 0).map((entry) => entry[0]);
  const ordered: CustomFieldDefinition[] = [];
  while (queue.length > 0) {
    const key = queue.shift();
    if (!key) {
      break;
    }
    const field = byKey.get(key);
    if (field) {
      ordered.push(field);
    }
    for (const child of children.get(key) ?? []) {
      const next = (indegree.get(child) ?? 1) - 1;
      indegree.set(child, next);
      if (next === 0) {
        queue.push(child);
      }
    }
  }
  if (ordered.length !== definitions.length) {
    throw new WorkflowError('A formula refers to itself.');
  }
  return ordered;
}

export async function formulaValuesForRecord(
  tx: TenantTransaction,
  entityType: string,
  entityId: string,
  custom?: Record<string, CustomFieldValue>,
): Promise<Record<string, FormulaNumber>> {
  const inputs = await numericFieldList(tx, entityType);
  const stored = custom ?? (await loadFieldValues(tx, entityType, entityId));
  const reader = getBuiltinReader(entityType);
  const builtins = reader ? await reader(tx, entityId) : {};
  return valueMap(stored, builtins, inputs);
}

function valueMap(
  custom: Record<string, CustomFieldValue>,
  builtins: Record<string, FormulaNumber>,
  inputs: readonly NumericInput[],
): Record<string, FormulaNumber> {
  const map: Record<string, FormulaNumber> = { ...builtins };
  for (const input of inputs) {
    if (input.source === 'builtin') {
      continue;
    }
    const value = custom[input.key];
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
      map[input.key] = { kind: 'money', text: String(value) };
    } else if (typeof value === 'string' && value.trim() !== '') {
      map[input.key] = { kind: input.kind === 'money' ? 'money' : 'number', text: value };
    }
  }
  return map;
}

async function entityLabel(tx: TenantTransaction, entityType: string): Promise<string> {
  const registered = getEntityType(entityType);
  if (registered) {
    return registered.label;
  }
  const fields = await tx.db
    .select({ entityLabel: fieldDefinitions.entityLabel })
    .from(fieldDefinitions)
    .where(eq(fieldDefinitions.entityType, entityType))
    .limit(1);
  if (fields[0]) {
    return fields[0].entityLabel;
  }
  const pipes = await tx.db
    .select({ entityLabel: pipelines.entityLabel })
    .from(pipelines)
    .where(eq(pipelines.entityType, entityType))
    .limit(1);
  if (pipes[0]) {
    return pipes[0].entityLabel;
  }
  throw new WorkflowError(
    'That record type is not available yet. A module has to register it first.',
  );
}

async function assertOperate(tx: TenantTransaction, actorId: string): Promise<void> {
  await requirePermission(tx, actorId, { scope: 'krn', action: 'operate', moduleId: 'KRN-04' });
}

export async function canEditFields(tx: TenantTransaction, actorId: string): Promise<boolean> {
  return hasPermission(tx, actorId, { scope: 'krn', action: 'operate', moduleId: 'KRN-04' });
}

/** Who may change field definitions. Company roles, including the owner, may not. */
export type FieldAdmin = {
  operatorId: string;
  requestIp: string | null;
  userAgent: string | null;
};

const FIELD_ADMIN_MESSAGE =
  'Custom fields are managed by Omnivate. You can still fill them in on a record.';

function assertFieldAdmin(actor: Actor | FieldAdmin): asserts actor is FieldAdmin {
  if (!('operatorId' in actor) || !actor.operatorId) {
    throw new PermissionDeniedError(FIELD_ADMIN_MESSAGE);
  }
}

export async function listDefinitionsForOperator(
  tx: TenantTransaction,
): Promise<CustomFieldDefinition[]> {
  const rows = await tx.db
    .select()
    .from(fieldDefinitions)
    .orderBy(
      asc(fieldDefinitions.entityType),
      asc(fieldDefinitions.sortOrder),
      asc(fieldDefinitions.label),
    );
  return rows.map(toDefinition);
}

export async function listDefinitions(
  tx: TenantTransaction,
  actorId: string,
): Promise<CustomFieldDefinition[]> {
  await requirePermission(tx, actorId, { scope: 'krn', action: 'read', moduleId: 'KRN-04' });
  const rows = await tx.db
    .select()
    .from(fieldDefinitions)
    .orderBy(
      asc(fieldDefinitions.entityType),
      asc(fieldDefinitions.sortOrder),
      asc(fieldDefinitions.label),
    );
  return rows.map(toDefinition);
}

export async function createFieldDefinition(
  tx: TenantTransaction,
  actor: Actor | FieldAdmin,
  draft: FieldDraft,
): Promise<CustomFieldDefinition> {
  assertFieldAdmin(actor);
  if (!/^[a-z][a-z0-9_.]{1,63}$/.test(draft.entityType)) {
    throw new WorkflowError('That record type is not available yet.');
  }
  checkBounds(draft);
  await assertFormula(tx, draft);
  const label = await entityLabel(tx, draft.entityType);
  const existing = await tx.db
    .select({ sortOrder: fieldDefinitions.sortOrder })
    .from(fieldDefinitions)
    .where(eq(fieldDefinitions.entityType, draft.entityType));
  const sortOrder = existing.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
  try {
    const inserted = await tx.db
      .insert(fieldDefinitions)
      .values({
        tenantId: tx.tenantId,
        entityType: draft.entityType,
        entityLabel: label,
        fieldKey: draft.fieldKey,
        label: draft.label.trim(),
        fieldType: draft.fieldType,
        required: draft.required,
        description: draft.description.trim(),
        sortOrder,
        minLength: draft.minLength,
        maxLength: draft.maxLength,
        minNumber: draft.minNumber,
        maxNumber: draft.maxNumber,
        minCents: draft.minCents === null ? null : BigInt(draft.minCents),
        maxCents: draft.maxCents === null ? null : BigInt(draft.maxCents),
        ...formulaColumns(draft),
        options: draft.options.map((option) => ({
          value: option.value,
          label: option.label.trim(),
        })),
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new WorkflowError('The field was not saved.');
    }
    const definition = toDefinition(row);
    await audit(tx, {
      action: 'workflow.field.created',
      entityType: 'krn04_field',
      entityId: row.id,
      actorId: null,
      operatorId: actor.operatorId,
      beforeData: null,
      afterData: { ...definition, fictional: false },
      requestIp: actor.requestIp,
      userAgent: actor.userAgent,
    });
    return definition;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new WorkflowError('That field key is already used on this record.');
    }
    throw error;
  }
}

export async function updateFieldDefinition(
  tx: TenantTransaction,
  actor: Actor | FieldAdmin,
  id: string,
  patch: {
    label?: string;
    required?: boolean;
    description?: string;
    minLength?: number | null;
    maxLength?: number | null;
    minNumber?: string | null;
    maxNumber?: string | null;
    minCents?: number | null;
    maxCents?: number | null;
    options?: FieldOption[];
    formula?: string | null;
    formulaPlaces?: number | null;
    formulaDisplay?: FormulaDisplay | null;
    formulaUnit?: string;
  },
): Promise<CustomFieldDefinition> {
  assertFieldAdmin(actor);
  const rows = await tx.db.select().from(fieldDefinitions).where(eq(fieldDefinitions.id, id));
  const current = rows[0];
  if (!current || current.archivedAt) {
    throw new WorkflowError('That field was not found.');
  }
  const next = toDefinition(current);
  const draft: FieldDraft = {
    entityType: next.entityType,
    fieldKey: next.fieldKey,
    label: patch.label ?? next.label,
    fieldType: next.fieldType,
    required: patch.required ?? next.required,
    description: patch.description ?? next.description,
    minLength: patch.minLength === undefined ? next.minLength : patch.minLength,
    maxLength: patch.maxLength === undefined ? next.maxLength : patch.maxLength,
    minNumber: patch.minNumber === undefined ? next.minNumber : patch.minNumber,
    maxNumber: patch.maxNumber === undefined ? next.maxNumber : patch.maxNumber,
    minCents: patch.minCents === undefined ? next.minCents : patch.minCents,
    maxCents: patch.maxCents === undefined ? next.maxCents : patch.maxCents,
    options: patch.options ?? next.options,
    formula: patch.formula === undefined ? (next.formula ?? null) : patch.formula,
    formulaPlaces:
      patch.formulaPlaces === undefined ? (next.formulaPlaces ?? null) : patch.formulaPlaces,
    formulaDisplay:
      patch.formulaDisplay === undefined ? (next.formulaDisplay ?? null) : patch.formulaDisplay,
    formulaUnit: patch.formulaUnit === undefined ? (next.formulaUnit ?? '') : patch.formulaUnit,
  };
  checkBounds(draft);
  await assertFormula(tx, draft, id);
  await tx.db
    .update(fieldDefinitions)
    .set({
      label: draft.label.trim(),
      required: draft.required,
      description: draft.description.trim(),
      minLength: draft.minLength,
      maxLength: draft.maxLength,
      minNumber: draft.minNumber,
      maxNumber: draft.maxNumber,
      minCents: draft.minCents === null ? null : BigInt(draft.minCents),
      maxCents: draft.maxCents === null ? null : BigInt(draft.maxCents),
      ...formulaColumns(draft),
      options: draft.options.map((option) => ({ value: option.value, label: option.label.trim() })),
      updatedAt: new Date(),
    })
    .where(eq(fieldDefinitions.id, id));
  const updated = toDefinition({
    ...current,
    label: draft.label.trim(),
    required: draft.required,
    description: draft.description.trim(),
    minLength: draft.minLength,
    maxLength: draft.maxLength,
    minNumber: draft.minNumber,
    maxNumber: draft.maxNumber,
    minCents: draft.minCents === null ? null : BigInt(draft.minCents),
    maxCents: draft.maxCents === null ? null : BigInt(draft.maxCents),
    ...formulaColumns(draft),
    options: draft.options,
    updatedAt: new Date(),
  });
  await audit(tx, {
    action: 'workflow.field.updated',
    entityType: 'krn04_field',
    entityId: id,
    actorId: null,
    operatorId: actor.operatorId,
    beforeData: { label: next.label, required: next.required },
    afterData: { label: updated.label, required: updated.required },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  return updated;
}

export async function archiveFieldDefinition(
  tx: TenantTransaction,
  actor: Actor | FieldAdmin,
  id: string,
): Promise<void> {
  assertFieldAdmin(actor);
  const rows = await tx.db.select().from(fieldDefinitions).where(eq(fieldDefinitions.id, id));
  const current = rows[0];
  if (!current) {
    throw new WorkflowError('That field was not found.');
  }
  if (current.archivedAt) {
    return;
  }
  const archivedAt = new Date();
  await tx.db
    .update(fieldDefinitions)
    .set({ archivedAt, updatedAt: archivedAt })
    .where(eq(fieldDefinitions.id, id));
  await audit(tx, {
    action: 'workflow.field.archived',
    entityType: 'krn04_field',
    entityId: id,
    actorId: null,
    operatorId: actor.operatorId,
    beforeData: { archived: false, label: current.label },
    afterData: { archived: true, label: current.label },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
}

export async function restoreFieldDefinition(
  tx: TenantTransaction,
  actor: Actor | FieldAdmin,
  id: string,
): Promise<void> {
  assertFieldAdmin(actor);
  const rows = await tx.db.select().from(fieldDefinitions).where(eq(fieldDefinitions.id, id));
  const current = rows[0];
  if (!current) {
    throw new WorkflowError('That field was not found.');
  }
  if (!current.archivedAt) {
    return;
  }
  await tx.db
    .update(fieldDefinitions)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(fieldDefinitions.id, id));
  await audit(tx, {
    action: 'workflow.field.updated',
    entityType: 'krn04_field',
    entityId: id,
    actorId: null,
    operatorId: actor.operatorId,
    beforeData: { archived: true, label: current.label },
    afterData: { archived: false, label: current.label },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
}

export async function reorderFields(
  tx: TenantTransaction,
  actor: Actor | FieldAdmin,
  entityType: string,
  fieldIds: string[],
): Promise<void> {
  assertFieldAdmin(actor);
  const rows = await tx.db
    .select()
    .from(fieldDefinitions)
    .where(and(eq(fieldDefinitions.entityType, entityType), isNull(fieldDefinitions.archivedAt)));
  const ids = new Set(rows.map((row) => row.id));
  if (fieldIds.length !== rows.length || fieldIds.some((id) => !ids.has(id))) {
    throw new WorkflowError('Include every active field, once.');
  }
  for (let index = 0; index < fieldIds.length; index += 1) {
    const id = fieldIds[index];
    if (!id) {
      continue;
    }
    await tx.db
      .update(fieldDefinitions)
      .set({ sortOrder: index, updatedAt: new Date() })
      .where(eq(fieldDefinitions.id, id));
  }
  const anchor = rows[0];
  if (anchor) {
    await audit(tx, {
      action: 'workflow.field.updated',
      entityType: 'krn04_field',
      entityId: anchor.id,
      actorId: null,
      operatorId: actor.operatorId,
      beforeData: { order: rows.map((row) => row.fieldKey) },
      afterData: {
        order: fieldIds.map((id) => rows.find((row) => row.id === id)?.fieldKey ?? id),
      },
      requestIp: actor.requestIp,
      userAgent: actor.userAgent,
    });
  }
}

export async function loadDefinitionsForEntity(
  tx: TenantTransaction,
  entityType: string,
): Promise<CustomFieldDefinition[]> {
  const rows = await tx.db
    .select()
    .from(fieldDefinitions)
    .where(eq(fieldDefinitions.entityType, entityType))
    .orderBy(asc(fieldDefinitions.sortOrder));
  return rows.map(toDefinition);
}

export async function loadFieldValues(
  tx: TenantTransaction,
  entityType: string,
  entityId: string,
): Promise<Record<string, CustomFieldValue>> {
  const rows = await tx.db
    .select({ values: fieldValues.values })
    .from(fieldValues)
    .where(and(eq(fieldValues.entityType, entityType), eq(fieldValues.entityId, entityId)));
  return readStoredValues(rows[0]?.values);
}

export function readStoredValues(value: unknown): Record<string, CustomFieldValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, CustomFieldValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === 'string' ||
      typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isSafeInteger(item)) ||
      (Array.isArray(item) && item.every((entry) => typeof entry === 'string'))
    ) {
      result[key] = item;
    }
  }
  return result;
}

export async function saveFieldValues(
  tx: TenantTransaction,
  actor: Actor,
  input: { entityType: string; entityId: string; values: Record<string, unknown> },
  dispatch: (saved: Record<string, CustomFieldValue>) => Promise<void>,
): Promise<Record<string, CustomFieldValue>> {
  await assertOperate(tx, actor.actorId);
  await entityLabel(tx, input.entityType);
  const definitions = await loadDefinitionsForEntity(tx, input.entityType);
  const checked = validateCustomValues(definitions, input.values);
  if (!checked.ok) {
    throw new WorkflowError(checked.errors[0]?.message ?? 'Check the custom fields.');
  }
  const withCalculated = await mergeCalculated(
    tx,
    input.entityType,
    input.entityId,
    checked.values,
  );
  const previous = await loadFieldValues(tx, input.entityType, input.entityId);
  const now = new Date();
  const existing = await tx.db
    .select({ id: fieldValues.id })
    .from(fieldValues)
    .where(
      and(eq(fieldValues.entityType, input.entityType), eq(fieldValues.entityId, input.entityId)),
    );
  if (existing[0]) {
    await tx.db
      .update(fieldValues)
      .set({ values: withCalculated, updatedAt: now })
      .where(eq(fieldValues.id, existing[0].id));
  } else {
    await tx.db.insert(fieldValues).values({
      tenantId: tx.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      values: withCalculated,
      updatedAt: now,
    });
  }
  await audit(tx, {
    action: 'workflow.fields.saved',
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: actor.actorId,
    beforeData: { values: previous },
    afterData: { values: withCalculated },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  await dispatch(withCalculated);
  return withCalculated;
}

export async function listSamples(tx: TenantTransaction): Promise<
  {
    entityType: string;
    entityId: string;
    entityLabel: string;
    values: Record<string, CustomFieldValue>;
  }[]
> {
  const rows = await tx.db
    .select({
      entityType: fieldValues.entityType,
      entityId: fieldValues.entityId,
      values: fieldValues.values,
    })
    .from(fieldValues)
    .limit(8);
  const labels = await tx.db
    .select({
      entityType: fieldDefinitions.entityType,
      entityLabel: fieldDefinitions.entityLabel,
    })
    .from(fieldDefinitions);
  const labelByType = new Map(labels.map((row) => [row.entityType, row.entityLabel]));
  return rows.map((row) => ({
    entityType: row.entityType,
    entityId: row.entityId,
    entityLabel: labelByType.get(row.entityType) ?? row.entityType,
    values: readStoredValues(row.values),
  }));
}
