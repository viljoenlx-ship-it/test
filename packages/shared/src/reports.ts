/**
 * Report definitions shared by the company app, the control panel, and the API.
 * This file has no SQL. The server registry is the only place that knows tables.
 */

export const REPORT_FIELD_TYPES = ['text', 'number', 'money', 'date', 'boolean'] as const;
export type ReportFieldType = (typeof REPORT_FIELD_TYPES)[number];

export const REPORT_AGGREGATES = ['sum', 'count', 'avg', 'min', 'max'] as const;
export type ReportAggregate = (typeof REPORT_AGGREGATES)[number];

export const REPORT_CHARTS = ['none', 'bar', 'line', 'pie'] as const;
export type ReportChart = (typeof REPORT_CHARTS)[number];

export const REPORT_VISIBILITIES = ['private', 'roles', 'ready_made'] as const;
export type ReportVisibility = (typeof REPORT_VISIBILITIES)[number];

export type ReportFilter = {
  field: string;
  op: string;
  value?: string;
  valueTo?: string;
};

export type ReportTotal = {
  field: string;
  fn: ReportAggregate;
};

export type ReportSort = {
  field: string;
  direction: 'asc' | 'desc';
};

export type ReportDefinition = {
  source: string;
  columns: string[];
  filters: ReportFilter[];
  groupBy: string[];
  totals: ReportTotal[];
  sort: ReportSort[];
  chart: ReportChart;
};

export type ReadyMadeReport = {
  readyKey: string;
  name: string;
  definition: ReportDefinition;
};

const SOURCE_KEY = /^[a-z][a-z0-9_]{0,40}$/;
const FIELD_KEY = /^[a-z][a-z0-9_]{0,40}$/;

export function emptyReport(source = ''): ReportDefinition {
  return {
    source,
    columns: [],
    filters: [],
    groupBy: [],
    totals: [],
    sort: [],
    chart: 'none',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || !FIELD_KEY.test(value)) {
    throw new Error(`Choose a ${label}.`);
  }
  return value;
}

function readOptionalText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error('A filter value must be text.');
  }
  const trimmed = value.trim();
  if (trimmed.length > 160) {
    throw new Error('A filter value is too long.');
  }
  return trimmed;
}

/** Rejects anything that is not a report definition. Field keys are checked again on the server. */
export function parseReportDefinition(input: unknown): ReportDefinition {
  if (!isRecord(input)) {
    throw new Error('The report was not understood.');
  }
  if (typeof input.source !== 'string' || !SOURCE_KEY.test(input.source)) {
    throw new Error('Choose a data source.');
  }
  if (!Array.isArray(input.columns) || input.columns.length < 1 || input.columns.length > 24) {
    throw new Error('Choose at least one column.');
  }
  const columns: string[] = [];
  for (const column of input.columns) {
    const key = readKey(column, 'column');
    if (!columns.includes(key)) {
      columns.push(key);
    }
  }

  if (!Array.isArray(input.filters) || input.filters.length > 12) {
    throw new Error('Use at most 12 filters.');
  }
  const filters: ReportFilter[] = [];
  for (const filter of input.filters) {
    if (!isRecord(filter)) {
      throw new Error('A filter was not understood.');
    }
    const op = typeof filter.op === 'string' ? filter.op : '';
    if (!/^[a-z_]{1,20}$/.test(op)) {
      throw new Error('Choose a condition.');
    }
    filters.push({
      field: readKey(filter.field, 'filter'),
      op,
      value: readOptionalText(filter.value),
      valueTo: readOptionalText(filter.valueTo),
    });
  }

  if (!Array.isArray(input.groupBy) || input.groupBy.length > 4) {
    throw new Error('Group by at most four fields.');
  }
  const groupBy: string[] = [];
  for (const field of input.groupBy) {
    const key = readKey(field, 'group');
    if (!groupBy.includes(key)) {
      groupBy.push(key);
    }
  }

  if (!Array.isArray(input.totals) || input.totals.length > 8) {
    throw new Error('Use at most eight totals.');
  }
  const totals: ReportTotal[] = [];
  for (const total of input.totals) {
    if (!isRecord(total)) {
      throw new Error('A total was not understood.');
    }
    const fn = total.fn;
    if (typeof fn !== 'string' || !(REPORT_AGGREGATES as readonly string[]).includes(fn)) {
      throw new Error('Choose Sum, Count, Average, Min, or Max.');
    }
    totals.push({ field: readKey(total.field, 'total'), fn: fn as ReportAggregate });
  }

  if (!Array.isArray(input.sort) || input.sort.length > 3) {
    throw new Error('Sort by at most three fields.');
  }
  const sort: ReportSort[] = [];
  for (const item of input.sort) {
    if (!isRecord(item)) {
      throw new Error('The sort was not understood.');
    }
    const direction = item.direction === 'desc' ? 'desc' : item.direction === 'asc' ? 'asc' : null;
    if (!direction) {
      throw new Error('Choose Ascending or Descending.');
    }
    sort.push({ field: readKey(item.field, 'sort'), direction });
  }

  const chart = (REPORT_CHARTS as readonly string[]).includes(String(input.chart))
    ? (input.chart as ReportChart)
    : 'none';

  return { source: input.source, columns, filters, groupBy, totals, sort, chart };
}

export type FilterPhrase = {
  label: string;
  op: string;
  value?: string;
  valueTo?: string;
};

const DATE_PRESET_LABEL: Record<string, string> = {
  this_month: 'This Month',
  last_month: 'Last Month',
  this_year: 'This Year',
};

function listJoin(items: string[]): string {
  if (items.length === 0) {
    return '';
  }
  if (items.length === 1) {
    return items[0] ?? '';
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function totalPhrase(total: { label: string; fn: ReportAggregate }, sums: number): string {
  if (total.fn === 'sum' && sums > 0) {
    return total.label;
  }
  if (total.fn === 'sum') {
    return `total ${total.label}`;
  }
  if (total.fn === 'count') {
    return `count of ${total.label}`;
  }
  if (total.fn === 'avg') {
    return `average ${total.label}`;
  }
  if (total.fn === 'min') {
    return `lowest ${total.label}`;
  }
  return `highest ${total.label}`;
}

/**
 * A sentence such as
 * "Stock Receipts from Silver Mango Packaging, This Month, grouped by Item, showing total Qty and Value".
 */
export function summariseReport(input: {
  sourceLabel: string;
  filters: FilterPhrase[];
  groupBy: string[];
  totals: { label: string; fn: ReportAggregate }[];
}): string {
  let head = input.sourceLabel.trim() || 'Report';
  const tail: string[] = [];
  let usedFrom = false;
  for (const filter of input.filters) {
    const preset = DATE_PRESET_LABEL[filter.op];
    if (preset) {
      tail.push(preset);
      continue;
    }
    const supplier =
      filter.label === 'Supplier' && (filter.op === 'is' || filter.op === 'contains');
    if (supplier && filter.value && !usedFrom) {
      head = `${head} from ${filter.value}`;
      usedFrom = true;
      continue;
    }
    if (filter.op === 'is' && filter.value) {
      tail.push(`${filter.label} is ${filter.value}`);
    } else if (filter.op === 'contains' && filter.value) {
      tail.push(`${filter.label} contains ${filter.value}`);
    } else if (filter.op === 'is_true') {
      tail.push(filter.label);
    } else if (filter.op === 'is_false') {
      tail.push(`not ${filter.label}`);
    } else if (filter.op === 'between' && filter.value && filter.valueTo) {
      tail.push(`${filter.label} from ${filter.value} to ${filter.valueTo}`);
    } else if (filter.value) {
      tail.push(`${filter.label} ${filter.op.replaceAll('_', ' ')} ${filter.value}`);
    }
  }
  if (input.groupBy.length > 0) {
    tail.push(`grouped by ${listJoin(input.groupBy)}`);
  }
  if (input.totals.length > 0) {
    const sums = input.totals.filter((total) => total.fn === 'sum');
    const phrases =
      sums.length === input.totals.length
        ? [`total ${listJoin(sums.map((total) => total.label))}`]
        : input.totals.map((total) => totalPhrase(total, 0));
    tail.push(`showing ${listJoin(phrases)}`);
  }
  return [head, ...tail].join(', ');
}

export type DateRange = { from: string; to: string };

/** Calendar bounds in Africa/Johannesburg. `to` is exclusive. */
export function saDateRange(
  preset: 'this_month' | 'last_month' | 'this_year',
  now: Date,
): DateRange {
  const shifted = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  if (preset === 'this_year') {
    return { from: `${year}-01-01T00:00:00+02:00`, to: `${year + 1}-01-01T00:00:00+02:00` };
  }
  const start =
    preset === 'last_month'
      ? new Date(Date.UTC(year, month - 1, 1))
      : new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const stamp = (date: Date) => {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}T00:00:00+02:00`;
  };
  return { from: stamp(start), to: stamp(end) };
}

const SA_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** South African date, for example 4 Mar 2026. A date-only string is not shifted. */
export function formatSaDate(value: string | Date): string {
  let year = 0;
  let month = 0;
  let day = 0;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    year = Number(value.slice(0, 4));
    month = Number(value.slice(5, 7));
    day = Number(value.slice(8, 10));
  } else {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Johannesburg',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    year = Number(parts.find((part) => part.type === 'year')?.value);
    month = Number(parts.find((part) => part.type === 'month')?.value);
    day = Number(parts.find((part) => part.type === 'day')?.value);
  }
  const label = SA_MONTHS[month - 1];
  if (!label || !year || !day) {
    return '';
  }
  return `${day} ${label} ${year}`;
}

/** Parses "19 Nov 2026" back to YYYY-MM-DD. */
export function parseSaDate(value: string): string | null {
  const match = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const day = Number(match[1]);
  const month = SA_MONTHS.findIndex((name) => name.toLowerCase() === match[2]?.toLowerCase());
  const year = Number(match[3]);
  if (month < 0 || day < 1 || day > 31 || year < 2000) {
    return null;
  }
  return `${year.toString()}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function formatReportNumber(value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    return value;
  }
  const negative = value.startsWith('-');
  const body = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = body.split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const trimmed = fraction.replace(/0+$/, '').slice(0, 4);
  const text = trimmed ? `${grouped}.${trimmed}` : grouped;
  return negative ? `-${text}` : text;
}

export const FILTER_CONDITIONS: Record<
  ReportFieldType,
  { op: string; label: string; value: 'none' | 'one' | 'two' }[]
> = {
  text: [
    { op: 'is', label: 'Is', value: 'one' },
    { op: 'is_not', label: 'Is Not', value: 'one' },
    { op: 'contains', label: 'Contains', value: 'one' },
    { op: 'starts_with', label: 'Starts With', value: 'one' },
  ],
  number: [
    { op: 'is', label: 'Is', value: 'one' },
    { op: 'gt', label: 'Greater Than', value: 'one' },
    { op: 'gte', label: 'At Least', value: 'one' },
    { op: 'lt', label: 'Less Than', value: 'one' },
    { op: 'lte', label: 'At Most', value: 'one' },
  ],
  money: [
    { op: 'is', label: 'Is', value: 'one' },
    { op: 'gt', label: 'Greater Than', value: 'one' },
    { op: 'gte', label: 'At Least', value: 'one' },
    { op: 'lt', label: 'Less Than', value: 'one' },
    { op: 'lte', label: 'At Most', value: 'one' },
  ],
  date: [
    { op: 'this_month', label: 'This Month', value: 'none' },
    { op: 'last_month', label: 'Last Month', value: 'none' },
    { op: 'this_year', label: 'This Year', value: 'none' },
    { op: 'on', label: 'On', value: 'one' },
    { op: 'before', label: 'Before', value: 'one' },
    { op: 'after', label: 'After', value: 'one' },
    { op: 'between', label: 'Custom', value: 'two' },
  ],
  boolean: [
    { op: 'is_true', label: 'Yes', value: 'none' },
    { op: 'is_false', label: 'No', value: 'none' },
  ],
};

export const AGGREGATE_LABELS: Record<ReportAggregate, string> = {
  sum: 'Sum',
  count: 'Count',
  avg: 'Average',
  min: 'Min',
  max: 'Max',
};

function def(
  source: string,
  columns: string[],
  extras: Partial<ReportDefinition> = {},
): ReportDefinition {
  return {
    ...emptyReport(source),
    columns,
    ...extras,
  };
}

/** Installed for every company the first time Reports is opened, and by the demo seed. */
export const READY_MADE_REPORTS: readonly ReadyMadeReport[] = [
  {
    readyKey: 'stock_on_hand',
    name: 'Stock On Hand & Value',
    definition: def('stock_items', ['item', 'code', 'branch', 'on_hand', 'cost', 'value'], {
      filters: [{ field: 'status', op: 'is', value: 'Active' }],
      totals: [
        { field: 'on_hand', fn: 'sum' },
        { field: 'value', fn: 'sum' },
      ],
      sort: [{ field: 'item', direction: 'asc' }],
    }),
  },
  {
    readyKey: 'low_stock',
    name: 'Low Stock / Reorder',
    definition: def('stock_items', ['item', 'code', 'branch', 'on_hand', 'reorder_level'], {
      filters: [{ field: 'below_reorder', op: 'is_true' }],
      sort: [{ field: 'on_hand', direction: 'asc' }],
    }),
  },
  {
    readyKey: 'stock_movements',
    name: 'Stock Movements',
    definition: def(
      'stock_movements',
      ['occurred', 'item', 'branch', 'kind', 'quantity', 'value', 'reason'],
      {
        filters: [{ field: 'occurred', op: 'this_year' }],
        sort: [{ field: 'occurred', direction: 'desc' }],
        totals: [
          { field: 'quantity', fn: 'sum' },
          { field: 'value', fn: 'sum' },
        ],
      },
    ),
  },
  {
    readyKey: 'goods_received',
    name: 'Goods Received By Supplier',
    definition: def('stock_receipts', ['supplier'], {
      filters: [{ field: 'received', op: 'this_year' }],
      groupBy: ['supplier'],
      totals: [
        { field: 'quantity', fn: 'sum' },
        { field: 'value', fn: 'sum' },
      ],
      sort: [{ field: 'value', direction: 'desc' }],
      chart: 'bar',
    }),
  },
  {
    readyKey: 'valuation_by_branch',
    name: 'Stock Valuation By Branch',
    definition: def('stock_items', ['branch'], {
      filters: [{ field: 'status', op: 'is', value: 'Active' }],
      groupBy: ['branch'],
      totals: [
        { field: 'on_hand', fn: 'sum' },
        { field: 'value', fn: 'sum' },
      ],
      sort: [{ field: 'value', direction: 'desc' }],
      chart: 'bar',
    }),
  },
  {
    readyKey: 'aged_debtors',
    name: 'Aged Debtors',
    definition: def('aged_debtors', ['customer'], {
      groupBy: ['customer'],
      totals: [
        { field: 'current', fn: 'sum' },
        { field: 'days_30', fn: 'sum' },
        { field: 'days_60', fn: 'sum' },
        { field: 'days_90', fn: 'sum' },
        { field: 'balance', fn: 'sum' },
      ],
      sort: [{ field: 'balance', direction: 'desc' }],
      chart: 'bar',
    }),
  },
  {
    readyKey: 'write_offs',
    name: 'Write-Offs & Adjustments',
    definition: def(
      'stock_movements',
      ['occurred', 'item', 'branch', 'kind', 'quantity', 'value', 'reason'],
      {
        filters: [
          { field: 'write_off', op: 'is_true' },
          { field: 'occurred', op: 'this_year' },
        ],
        sort: [{ field: 'occurred', direction: 'desc' }],
        totals: [
          { field: 'quantity', fn: 'sum' },
          { field: 'value', fn: 'sum' },
        ],
      },
    ),
  },
];
