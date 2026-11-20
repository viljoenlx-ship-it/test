import { sql, type SQL } from 'drizzle-orm';
import {
  saDateRange,
  type ReportAggregate,
  type ReportDefinition,
  type ReportFieldType,
  zarFromDecimal,
} from '@omnivate/shared';
import { assertSafeExpr, ReportError, type ReportField, type ReportSource } from './types';

export type OutputColumn = {
  key: string;
  label: string;
  type: ReportFieldType;
  expr: string;
  aggregate?: ReportAggregate;
  display?: 'action';
};

export type CompiledReport = {
  page: SQL;
  totals: SQL;
  columns: OutputColumn[];
};

const DATE_PRESETS = new Set(['this_month', 'last_month', 'this_year']);

function fieldByKey(source: ReportSource, key: string): ReportField {
  const field = source.fields.find((item) => item.key === key);
  if (!field) {
    throw new ReportError('That field is not on this report.');
  }
  return field;
}

function aggregateSql(fn: ReportAggregate, expr: string, type: ReportFieldType): string {
  const safe = assertSafeExpr(expr);
  if (fn === 'count') {
    return `COUNT(${safe})`;
  }
  if (fn === 'avg' && type === 'money') {
    return `ROUND(AVG(${safe}))`;
  }
  const name = fn === 'sum' ? 'SUM' : fn === 'avg' ? 'AVG' : fn === 'min' ? 'MIN' : 'MAX';
  return `${name}(${safe})`;
}

function likePattern(value: string, mode: 'contains' | 'starts'): string {
  const escaped = value.replace(/[\\%_]/g, (char) => `\\${char}`);
  return mode === 'starts' ? `${escaped}%` : `%${escaped}%`;
}

function moneyCents(value: string | undefined): string {
  const cleaned = (value ?? '').replace(/\s/g, '').replace(/^R/, '');
  try {
    return zarFromDecimal(cleaned).amountCents.toString();
  } catch {
    throw new ReportError('Enter an amount such as 10.50.');
  }
}

function numberText(value: string | undefined): string {
  const text = (value ?? '').trim();
  if (!/^-?\d+(\.\d{1,4})?$/.test(text)) {
    throw new ReportError('Enter a number with up to four decimal places.');
  }
  return text;
}

function dateText(value: string | undefined): string {
  const text = (value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new ReportError('Enter a date as YYYY-MM-DD.');
  }
  return text;
}

function filterSql(
  field: ReportField,
  op: string,
  value: string | undefined,
  valueTo: string | undefined,
  now: Date,
): SQL {
  const expr = sql.raw(assertSafeExpr(field.expr));
  if (field.type === 'boolean') {
    if (op === 'is_true') {
      return sql`${expr} IS TRUE`;
    }
    if (op === 'is_false') {
      return sql`${expr} IS NOT TRUE`;
    }
    throw new ReportError(`Choose Yes or No for ${field.label}.`);
  }
  if (field.type === 'date') {
    if (DATE_PRESETS.has(op)) {
      const range = saDateRange(op as 'this_month' | 'last_month' | 'this_year', now);
      return sql`${expr} >= ${range.from.slice(0, 10)}::date AND ${expr} < ${range.to.slice(0, 10)}::date`;
    }
    if (op === 'on') {
      return sql`${expr} = ${dateText(value)}::date`;
    }
    if (op === 'before') {
      return sql`${expr} < ${dateText(value)}::date`;
    }
    if (op === 'after') {
      return sql`${expr} > ${dateText(value)}::date`;
    }
    if (op === 'between') {
      return sql`${expr} >= ${dateText(value)}::date AND ${expr} <= ${dateText(valueTo)}::date`;
    }
    throw new ReportError(`Choose a date condition for ${field.label}.`);
  }
  if (field.type === 'money' || field.type === 'number') {
    const compare = field.type === 'money' ? `${moneyCents(value)}::bigint` : null;
    const numeric = field.type === 'number' ? numberText(value) : null;
    const right = compare !== null ? sql.raw(compare) : sql`${numeric}::numeric`;
    // compare is a digits-only cast, built here, never from the request text except through the parser.
    if (op === 'is') {
      return sql`${expr} = ${right}`;
    }
    if (op === 'gt') {
      return sql`${expr} > ${right}`;
    }
    if (op === 'gte') {
      return sql`${expr} >= ${right}`;
    }
    if (op === 'lt') {
      return sql`${expr} < ${right}`;
    }
    if (op === 'lte') {
      return sql`${expr} <= ${right}`;
    }
    throw new ReportError(`Choose a number condition for ${field.label}.`);
  }
  const text = (value ?? '').trim();
  if (!text) {
    throw new ReportError(`Enter a value for ${field.label}.`);
  }
  if (op === 'is') {
    return sql`${expr} = ${text}`;
  }
  if (op === 'is_not') {
    return sql`COALESCE(${expr}, '') <> ${text}`;
  }
  if (op === 'contains') {
    return sql`${expr} ILIKE ${likePattern(text, 'contains')} ESCAPE '\\'`;
  }
  if (op === 'starts_with') {
    return sql`${expr} ILIKE ${likePattern(text, 'starts')} ESCAPE '\\'`;
  }
  throw new ReportError(`Choose a text condition for ${field.label}.`);
}

function whereSql(source: ReportSource, definition: ReportDefinition, now: Date): SQL {
  const parts: SQL[] = [sql`TRUE`];
  for (const filter of definition.filters) {
    const field = fieldByKey(source, filter.field);
    if (!field.filterable) {
      throw new ReportError(`${field.label} cannot be filtered.`);
    }
    parts.push(filterSql(field, filter.op, filter.value, filter.valueTo, now));
  }
  return sql.join(parts, sql` AND `);
}

function outputColumns(source: ReportSource, definition: ReportDefinition): OutputColumn[] {
  if (definition.groupBy.length > 0) {
    const columns: OutputColumn[] = definition.groupBy.map((key) => {
      const field = fieldByKey(source, key);
      if (!field.groupable) {
        throw new ReportError(`${field.label} cannot be used for Group By.`);
      }
      return {
        key: field.key,
        label: field.label,
        type: field.type,
        expr: assertSafeExpr(field.expr),
        display: field.display,
      };
    });
    for (const total of definition.totals) {
      const field = fieldByKey(source, total.field);
      if (!field.aggregations.includes(total.fn)) {
        throw new ReportError(`${field.label} cannot use that total.`);
      }
      const type = total.fn === 'count' ? 'number' : field.type;
      columns.push({
        key: field.key,
        label: field.label,
        type,
        expr: aggregateSql(total.fn, field.expr, field.type),
        aggregate: total.fn,
      });
    }
    if (columns.length === 0) {
      throw new ReportError('Choose a group or a total.');
    }
    return columns;
  }

  if (definition.columns.length === 0) {
    throw new ReportError('Choose at least one column.');
  }
  return definition.columns.map((key) => {
    const field = fieldByKey(source, key);
    return {
      key: field.key,
      label: field.label,
      type: field.type,
      expr: assertSafeExpr(field.expr),
      display: field.display,
    };
  });
}

function orderSql(columns: OutputColumn[], definition: ReportDefinition): SQL {
  const sorts =
    definition.sort.length > 0
      ? definition.sort
      : [{ field: columns[0]?.key ?? '', direction: 'asc' as const }];
  const parts: SQL[] = [];
  for (const sort of sorts) {
    const index = columns.findIndex((column) => column.key === sort.field);
    if (index < 0) {
      throw new ReportError('Sort by a column that is on the report.');
    }
    const direction = sort.direction === 'desc' ? 'DESC' : 'ASC';
    parts.push(sql.raw(`${index + 1} ${direction}`));
  }
  return sql.join(parts, sql`, `);
}

function fromSql(source: ReportSource, columns: OutputColumn[], definition: ReportDefinition): SQL {
  const usesCustom = [
    ...definition.columns,
    ...definition.groupBy,
    ...definition.filters.map((filter) => filter.field),
    ...definition.totals.map((total) => total.field),
  ].some((key) => source.fields.find((field) => field.key === key)?.expr.includes('cf.values'));
  void columns;
  const join = usesCustom && source.customJoin ? ` ${source.customJoin}` : '';
  return sql.raw(`${source.fromSql}${join}`);
}

/**
 * Builds one parameterised statement. Every expression comes from the source registry.
 */
export function compileReport(
  source: ReportSource,
  definition: ReportDefinition,
  options: { now: Date; limit: number; offset: number },
): CompiledReport {
  const columns = outputColumns(source, definition);
  const where = whereSql(source, definition, options.now);
  const from = fromSql(source, columns, definition);
  const selects = sql.join(
    columns.map((column, index) => sql`${sql.raw(column.expr)} AS ${sql.raw(`c${index}`)}`),
    sql`, `,
  );
  const order = orderSql(columns, definition);
  const limit = Math.max(1, Math.min(options.limit, 5000));
  const offset = Math.max(0, options.offset);

  if (definition.groupBy.length > 0) {
    const group = sql.join(
      columns.filter((column) => !column.aggregate).map((column) => sql.raw(column.expr)),
      sql`, `,
    );
    const page = sql`SELECT ${selects} FROM ${from} WHERE ${where} GROUP BY ${group} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`;
    const inner =
      definition.totals.length > 0
        ? sql`SELECT ${sql.join(
            definition.totals.map((total, index) => {
              const field = fieldByKey(source, total.field);
              return sql`${sql.raw(aggregateSql(total.fn, field.expr, field.type))} AS ${sql.raw(`m${index}`)}`;
            }),
            sql`, `,
          )} FROM ${from} WHERE ${where} GROUP BY ${group}`
        : sql`SELECT 1 AS marker FROM ${from} WHERE ${where} GROUP BY ${group}`;
    const totalParts: SQL[] = [sql`COUNT(*)::int AS row_count`];
    definition.totals.forEach((_total, index) => {
      totalParts.push(sql`COALESCE(SUM(${sql.raw(`m${index}`)}), 0) AS ${sql.raw(`t${index}`)}`);
    });
    const totals = sql`SELECT ${sql.join(totalParts, sql`, `)} FROM (${inner}) AS grouped`;
    return { page, totals, columns };
  }

  const page = sql`SELECT ${selects} FROM ${from} WHERE ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`;
  const totalParts: SQL[] = [sql`COUNT(*)::int AS row_count`];
  definition.totals.forEach((total, index) => {
    const field = fieldByKey(source, total.field);
    if (!field.aggregations.includes(total.fn)) {
      throw new ReportError(`${field.label} cannot use that total.`);
    }
    totalParts.push(
      sql`COALESCE(${sql.raw(aggregateSql(total.fn, field.expr, field.type))}, 0) AS ${sql.raw(`t${index}`)}`,
    );
  });
  const totals = sql`SELECT ${sql.join(totalParts, sql`, `)} FROM ${from} WHERE ${where}`;
  return { page, totals, columns };
}
