import { sql } from 'drizzle-orm';
import { hasPermission, type TenantTransaction } from '@omnivate/kernel';
import { loadFieldValues, saveCustomFields } from '@omnivate/module-krn-04';
import {
  isFieldType,
  type CustomFieldDefinition,
  type CustomFieldValue,
  type FieldOption,
} from '@omnivate/shared';
import type { Actor } from './access';
import { SalesError } from './errors';
import { many } from './rows';

const ENTITY = {
  quote: 'sal.quote',
  invoice: 'fin.invoice',
  credit_note: 'fin.credit_note',
  customer: 'sal.customer',
} as const;

export type SalesEntity = keyof typeof ENTITY;

export function entityKey(entity: SalesEntity): string {
  return ENTITY[entity];
}

type FieldRow = {
  id: string;
  entity_type: string;
  entity_label: string;
  field_key: string;
  label: string;
  field_type: string;
  required: boolean;
  description: string;
  sort_order: number;
  min_length: number | null;
  max_length: number | null;
  min_number: string | null;
  max_number: string | null;
  min_cents: bigint | null;
  max_cents: bigint | null;
  options: unknown;
  formula: string | null;
  formula_places: number | null;
  formula_display: string | null;
  formula_unit: string;
};

function centsOrNull(value: bigint | null): number | null {
  if (value === null || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
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
    if (typeof row.value === 'string' && typeof row.label === 'string') {
      options.push({ value: row.value, label: row.label });
    }
  }
  return options;
}

export async function fieldDefinitions(
  tx: TenantTransaction,
  entity: SalesEntity,
): Promise<CustomFieldDefinition[]> {
  const rows = await many<FieldRow>(
    tx,
    sql`
      SELECT
        id, entity_type, entity_label, field_key, label, field_type, required, description,
        sort_order, min_length, max_length, min_number, max_number, min_cents, max_cents,
        options, formula, formula_places, formula_display, formula_unit
      FROM krn04_field_definitions
      WHERE entity_type = ${ENTITY[entity]} AND archived_at IS NULL
      ORDER BY sort_order, label
    `,
  );
  return rows.map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    entityLabel: row.entity_label,
    fieldKey: row.field_key,
    label: row.label,
    fieldType: isFieldType(row.field_type) ? row.field_type : 'text',
    required: row.required,
    description: row.description,
    sortOrder: row.sort_order,
    minLength: row.min_length,
    maxLength: row.max_length,
    minNumber: row.min_number,
    maxNumber: row.max_number,
    minCents: centsOrNull(row.min_cents),
    maxCents: centsOrNull(row.max_cents),
    options: readOptions(row.options),
    archived: false,
    formula: row.formula,
    formulaPlaces: row.formula_places,
    formulaDisplay:
      row.formula_display === 'money' || row.formula_display === 'number'
        ? row.formula_display
        : null,
    formulaUnit: row.formula_unit,
  }));
}

export async function customFieldState(
  tx: TenantTransaction,
  actor: Actor,
  entity: SalesEntity,
  entityId: string,
): Promise<{
  definitions: CustomFieldDefinition[];
  values: Record<string, CustomFieldValue>;
  canEdit: boolean;
}> {
  const definitions = await fieldDefinitions(tx, entity);
  const values = await loadFieldValues(tx, ENTITY[entity], entityId);
  const canEdit = await hasPermission(tx, actor.userId, {
    scope: 'krn',
    action: 'operate',
    moduleId: 'KRN-04',
  });
  return { definitions, values, canEdit };
}

export async function storeCustomFields(
  tx: TenantTransaction,
  actor: Actor,
  entity: SalesEntity,
  entityId: string,
  values: Record<string, unknown> | undefined,
): Promise<void> {
  if (!values || Object.keys(values).length === 0) {
    return;
  }
  if (
    !(await hasPermission(tx, actor.userId, {
      scope: 'krn',
      action: 'operate',
      moduleId: 'KRN-04',
    }))
  ) {
    throw new SalesError('Your role cannot change the extra fields.');
  }
  await saveCustomFields(
    tx,
    {
      actorId: actor.userId,
      requestIp: actor.requestIp,
      userAgent: actor.userAgent,
    },
    { entityType: ENTITY[entity], entityId, values },
  );
}
