import { sql } from 'drizzle-orm';
import { isFieldKey, type ReportAggregate, type ReportFieldType } from '@omnivate/shared';
import type { TenantTransaction } from '@omnivate/kernel';
import { formulaToSql } from './formula-sql';
import { assertSafeExpr, type FormulaSlot, type ReportSource } from './types';

const NUMERIC: ReportAggregate[] = ['sum', 'count', 'avg', 'min', 'max'];
const TEXT: ReportAggregate[] = ['count', 'min', 'max'];

type DefinitionRow = {
  field_key: string;
  label: string;
  field_type: string;
  formula: string | null;
  formula_display: string | null;
};

function titleCase(label: string): string {
  return label
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (word.length <= 4 && word === word.toUpperCase()) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function storedExpr(key: string, type: ReportFieldType): string {
  const text = `NULLIF(cf.values->>'${key}', '')`;
  if (type === 'number') {
    return `${text}::numeric`;
  }
  if (type === 'money') {
    return `ROUND(${text}::numeric)::bigint`;
  }
  if (type === 'date') {
    return `${text}::date`;
  }
  if (type === 'boolean') {
    return `COALESCE(cf.values->>'${key}', '') IN ('true', 't', 'yes')`;
  }
  return `COALESCE(cf.values->>'${key}', '')`;
}

function fieldTypeOf(row: DefinitionRow): ReportFieldType | null {
  if (
    row.field_type === 'text' ||
    row.field_type === 'select' ||
    row.field_type === 'multi_select'
  ) {
    return 'text';
  }
  if (row.field_type === 'number') {
    return 'number';
  }
  if (row.field_type === 'money') {
    return 'money';
  }
  if (row.field_type === 'date') {
    return 'date';
  }
  if (row.field_type === 'checkbox') {
    return 'boolean';
  }
  if (row.field_type === 'calculated') {
    return row.formula_display === 'money' ? 'money' : 'number';
  }
  return null;
}

/** Adds this tenant's custom fields and calculated fields onto a copy of the source. */
export async function withCustomFields(
  tx: TenantTransaction,
  source: ReportSource,
): Promise<ReportSource> {
  if (!source.entityType) {
    return source;
  }
  const result = await tx.db.execute(sql`
    SELECT field_key, label, field_type, formula, formula_display
    FROM krn04_field_definitions
    WHERE entity_type = ${source.entityType}
      AND archived_at IS NULL
    ORDER BY sort_order, label
  `);
  const rows = result.rows as DefinitionRow[];
  if (rows.length === 0) {
    return source;
  }
  const fields = [...source.fields];
  const slots: Record<string, FormulaSlot> = { ...source.formulaFields };
  const sensitive = new Set(source.sensitiveFormulaKeys ?? []);
  for (const row of rows) {
    if (!isFieldKey(row.field_key) || fields.some((field) => field.key === row.field_key)) {
      continue;
    }
    const type = fieldTypeOf(row);
    if (!type) {
      continue;
    }
    const label = titleCase(row.label);
    if (row.field_type === 'calculated') {
      if (!row.formula) {
        continue;
      }
      const compiled = formulaToSql(row.formula, slots);
      if (!compiled) {
        continue;
      }
      const wantsMoney = row.formula_display === 'money';
      if (wantsMoney !== (compiled.kind === 'money')) {
        continue;
      }
      const referencesCost = (source.sensitiveFormulaKeys ?? []).some((key) =>
        row.formula?.includes(key),
      );
      const expr = assertSafeExpr(
        compiled.kind === 'money' ? `${compiled.sql}::bigint` : compiled.sql,
      );
      fields.push({
        key: row.field_key,
        label,
        type,
        expr,
        aggregations: NUMERIC,
        filterable: true,
        groupable: false,
        sensitive: referencesCost ? 'cost' : undefined,
      });
      slots[row.field_key] = { sql: compiled.sql, kind: compiled.kind };
      if (referencesCost) {
        sensitive.add(row.field_key);
      }
      continue;
    }
    const expr = assertSafeExpr(storedExpr(row.field_key, type));
    const numeric = type === 'number' || type === 'money';
    fields.push({
      key: row.field_key,
      label,
      type,
      expr,
      aggregations: numeric ? NUMERIC : TEXT,
      filterable: true,
      groupable: !numeric,
      sensitive: type === 'money' ? 'cost' : undefined,
    });
    if (type === 'number' || type === 'money') {
      slots[row.field_key] = {
        sql: expr,
        kind: type === 'money' ? 'money' : 'number',
      };
    }
  }
  return { ...source, fields, formulaFields: slots, sensitiveFormulaKeys: [...sensitive] };
}
