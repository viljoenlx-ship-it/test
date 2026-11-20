import { sql } from 'drizzle-orm';
import { activeModuleSet, loadGrants, type TenantTransaction } from '@omnivate/kernel';
import {
  formatSaDate,
  summariseReport,
  type ReportDefinition,
  type ReportTotal,
} from '@omnivate/shared';
import './sources';
import { canReadSource, canSeeCost, canUseReports, visibleField, type Grant } from './access';
import { withCustomFields } from './custom-fields';
import { compileReport, type OutputColumn } from './compile';
import { presentValue, type Presented } from './present';
import { getReportSource, listReportSources } from './registry';
import { ReportError, type ReportSource } from './types';

export type ReportCell = Presented;

export type ReportTable = {
  summary: string;
  columns: { key: string; label: string; type: string; aggregate?: string }[];
  rows: ReportCell[][];
  footer: { key: string; label: string; text: string; chart: number | null }[];
  totalRows: number;
  hidden: string[];
  joins: { key: string; label: string }[];
  generatedOn: string;
};

const PREVIEW_TIMEOUT = '8000';
const EXPORT_TIMEOUT = '15000';

function rowsOf(result: { rows: unknown }): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}

async function roleKeys(tx: TenantTransaction, userId: string): Promise<string[]> {
  const result = await tx.db.execute(sql`
    SELECT role.key AS key
    FROM user_roles AS ur
    JOIN roles AS role ON role.id = ur.role_id
    WHERE ur.user_id = ${userId}
  `);
  return rowsOf(result)
    .map((row) => String(row.key))
    .filter((key) => key.length > 0);
}

function maskDefinition(
  source: ReportSource,
  definition: ReportDefinition,
  grants: readonly Grant[],
  operator: boolean,
): { definition: ReportDefinition; hidden: string[] } {
  const hidden: string[] = [];
  const keep = (key: string, kind: 'column' | 'filter'): boolean => {
    const field = source.fields.find((item) => item.key === key);
    if (!field) {
      throw new ReportError('That field is not on this report.');
    }
    if (!visibleField(field, grants, operator)) {
      if (kind === 'filter') {
        throw new ReportError(`${field.label} is hidden for your role.`);
      }
      hidden.push(field.label);
      return false;
    }
    return true;
  };
  const columns = definition.columns.filter((key) => keep(key, 'column'));
  const filters = definition.filters.filter((filter) => keep(filter.field, 'filter'));
  const groupBy = definition.groupBy.filter((key) => keep(key, 'column'));
  const totals = definition.totals.filter((total) => keep(total.field, 'column'));
  const sort = definition.sort.filter((item) => {
    const field = source.fields.find((candidate) => candidate.key === item.field);
    return field ? visibleField(field, grants, operator) : false;
  });
  if (!operator && columns.length === 0 && groupBy.length === 0) {
    throw new ReportError('Nothing in this report is available for your role.');
  }
  return {
    hidden: [...new Set(hidden)],
    definition: { ...definition, columns, filters, groupBy, totals, sort },
  };
}

function summaryFor(source: ReportSource, definition: ReportDefinition): string {
  const label = (key: string) => source.fields.find((field) => field.key === key)?.label ?? key;
  return summariseReport({
    sourceLabel: source.label,
    filters: definition.filters.map((filter) => ({
      label: label(filter.field),
      op: filter.op,
      value: filter.value,
      valueTo: filter.valueTo,
    })),
    groupBy: definition.groupBy.map(label),
    totals: definition.totals.map((total) => ({ label: label(total.field), fn: total.fn })),
  });
}

function footerFor(
  definition: ReportDefinition,
  columns: OutputColumn[],
  row: Record<string, unknown> | undefined,
): ReportTable['footer'] {
  return definition.totals.map((total, index) => {
    const column =
      columns.find((item) => item.key === total.field && item.aggregate === total.fn) ??
      columns.find((item) => item.key === total.field);
    const type = total.fn === 'count' ? 'number' : (column?.type ?? 'number');
    const presented = presentValue(
      type === 'money' ||
        type === 'number' ||
        type === 'date' ||
        type === 'boolean' ||
        type === 'text'
        ? type
        : 'number',
      row?.[`t${index}`] ?? 0,
    );
    const fieldLabel = column?.label ?? total.field;
    const prefix =
      total.fn === 'sum'
        ? 'Total '
        : total.fn === 'count'
          ? 'Count '
          : total.fn === 'avg'
            ? 'Average '
            : total.fn === 'min'
              ? 'Min '
              : 'Max ';
    return {
      key: total.field,
      label: `${prefix}${fieldLabel}`.trim(),
      text: presented.text,
      chart: presented.chart,
    };
  });
}

export async function loadRunnableSource(
  tx: TenantTransaction,
  userId: string,
  sourceKey: string,
  operator: boolean,
): Promise<{ source: ReportSource; grants: Grant[]; roles: string[] }> {
  const grants = operator ? [] : await loadGrants(tx, userId);
  const active = await activeModuleSet(tx);
  if (!operator && !canUseReports(grants, active)) {
    throw new ReportError(
      active.has('ANA-03')
        ? 'Your role cannot open reports.'
        : 'Reports are switched off for this company.',
      403,
    );
  }
  const registered = getReportSource(sourceKey);
  if (!registered) {
    throw new ReportError('Choose a data source.');
  }
  if (!operator && !canReadSource(grants, active, registered)) {
    throw new ReportError('Your role cannot open that report.', 403);
  }
  const source = await withCustomFields(tx, registered);
  const roles = operator ? [] : await roleKeys(tx, userId);
  return { source, grants, roles };
}

export async function runReport(
  tx: TenantTransaction,
  userId: string,
  definition: ReportDefinition,
  options: { limit: number; offset: number; operator?: boolean; timeout?: 'preview' | 'export' },
): Promise<ReportTable> {
  const operator = options.operator === true;
  const { source, grants } = await loadRunnableSource(tx, userId, definition.source, operator);
  const masked = maskDefinition(source, definition, grants, operator);
  const timeout = options.timeout === 'export' ? EXPORT_TIMEOUT : PREVIEW_TIMEOUT;
  await tx.db.execute(sql`SELECT set_config('statement_timeout', ${timeout}, true)`);
  const compiled = compileReport(source, masked.definition, {
    now: new Date(),
    limit: options.limit,
    offset: options.offset,
  });
  let pageRows: Record<string, unknown>[] = [];
  let totalRow: Record<string, unknown> | undefined;
  try {
    pageRows = rowsOf(await tx.db.execute(compiled.page));
    const totals = rowsOf(await tx.db.execute(compiled.totals));
    totalRow = totals[0];
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (
      message.toLowerCase().includes('statement timeout') ||
      message.includes('canceling statement')
    ) {
      throw new ReportError('This report took too long. Add a filter or choose fewer rows.');
    }
    throw error;
  }
  const rows = pageRows.map((row) =>
    compiled.columns.map((column, index) =>
      presentValue(column.type, row[`c${index}`], column.display),
    ),
  );
  const footer = footerFor(masked.definition, compiled.columns, totalRow);
  return {
    summary: summaryFor(source, masked.definition),
    columns: compiled.columns.map((column) => ({
      key: column.key,
      label: column.aggregate ? totalLabel(column.label, column.aggregate) : column.label,
      type: column.type,
      aggregate: column.aggregate,
    })),
    rows,
    footer,
    totalRows: Number(totalRow?.row_count ?? 0),
    hidden: masked.hidden,
    joins: source.joins.map((join) => ({ key: join.key, label: join.label })),
    generatedOn: formatSaDate(new Date()),
  };
}

function totalLabel(label: string, fn: ReportTotal['fn']): string {
  if (fn === 'sum') {
    return `Total ${label}`;
  }
  if (fn === 'count') {
    return `Count ${label}`;
  }
  if (fn === 'avg') {
    return `Average ${label}`;
  }
  if (fn === 'min') {
    return `Min ${label}`;
  }
  return `Max ${label}`;
}

export async function catalogFor(
  tx: TenantTransaction,
  userId: string,
  operator: boolean,
): Promise<{
  sources: {
    key: string;
    label: string;
    description: string;
    joins: { key: string; label: string }[];
    defaultColumns: string[];
    fields: {
      key: string;
      label: string;
      type: string;
      aggregations: string[];
      filterable: boolean;
      groupable: boolean;
    }[];
  }[];
  seesCost: boolean;
}> {
  const grants = operator ? [] : await loadGrants(tx, userId);
  const active = await activeModuleSet(tx);
  if (!operator && !canUseReports(grants, active)) {
    throw new ReportError(
      active.has('ANA-03')
        ? 'Your role cannot open reports.'
        : 'Reports are switched off for this company.',
      403,
    );
  }
  const seesCost = operator || canSeeCost(grants);
  const sources = [];
  for (const registered of listReportSources()) {
    if (!operator && !canReadSource(grants, active, registered)) {
      continue;
    }
    const source = await withCustomFields(tx, registered);
    const fields = source.fields.filter((field) => visibleField(field, grants, operator));
    sources.push({
      key: source.key,
      label: source.label,
      description: source.description,
      joins: source.joins.map((join) => ({ key: join.key, label: join.label })),
      defaultColumns: source.defaultColumns.filter((key) =>
        fields.some((field) => field.key === key),
      ),
      fields: fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        aggregations: [...field.aggregations],
        filterable: field.filterable,
        groupable: field.groupable,
      })),
    });
  }
  return { sources, seesCost };
}
