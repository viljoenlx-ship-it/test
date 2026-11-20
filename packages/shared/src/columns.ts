import type { ModuleId } from './modules';

/**
 * Columns an operator can show, hide, and reorder on a client's main lists.
 * An empty saved value means the full default order.
 */
export const COLUMN_TABLES = [
  {
    key: 'stock',
    label: 'Stock',
    moduleId: 'SCM-01',
    screenType: 'List',
    columns: [
      { key: 'name', label: 'Item', type: 'Text' },
      { key: 'code', label: 'Code', type: 'Text' },
      { key: 'onHand', label: 'On Hand', type: 'Decimal' },
      { key: 'value', label: 'Stock Value', type: 'Currency' },
      { key: 'price', label: 'Selling Price', type: 'Currency' },
    ],
  },
  {
    key: 'contacts',
    label: 'Contacts',
    moduleId: 'KRN-02',
    screenType: 'List',
    columns: [
      { key: 'name', label: 'Name', type: 'Text' },
      { key: 'roles', label: 'Roles', type: 'Text' },
      { key: 'reach', label: 'Phone or Email', type: 'Text' },
      { key: 'city', label: 'City', type: 'Text' },
    ],
  },
] as const;

export type ColumnTableKey = (typeof COLUMN_TABLES)[number]['key'];

export type ColumnLayouts = {
  stock: string[];
  contacts: string[];
  labels: Record<ColumnTableKey, Record<string, string>>;
};

export function defaultColumnLayouts(): ColumnLayouts {
  return {
    stock: COLUMN_TABLES[0].columns.map((column) => column.key),
    contacts: COLUMN_TABLES[1].columns.map((column) => column.key),
    labels: { stock: {}, contacts: {} },
  };
}

function readLabels(
  source: Record<string, unknown>,
  table: ColumnTableKey,
): Record<string, string> {
  const all = source.labels;
  if (!all || typeof all !== 'object' || Array.isArray(all)) {
    return {};
  }
  const raw = (all as Record<string, unknown>)[table];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const allowed = new Set<string>(tableByKey(table).columns.map((column) => column.key));
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.has(key) || typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim().slice(0, 40);
    if (trimmed) {
      labels[key] = trimmed;
    }
  }
  return labels;
}

function tableByKey(key: ColumnTableKey) {
  const table = COLUMN_TABLES.find((item) => item.key === key);
  if (!table) {
    throw new Error(`Unknown list ${key}.`);
  }
  return table;
}

/** Returns a sentence when a list would be saved with no columns. */
export function columnLayoutError(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const source = input as Record<string, unknown>;
  for (const table of COLUMN_TABLES) {
    const raw = source[table.key];
    if (!Array.isArray(raw)) {
      continue;
    }
    const allowed = new Set<string>(table.columns.map((column) => column.key));
    const picked = raw.filter((item) => typeof item === 'string' && allowed.has(item));
    if (picked.length === 0) {
      return `${table.label} needs at least one column.`;
    }
  }
  return null;
}

export function parseColumnLayouts(input: unknown): ColumnLayouts {
  const layouts = defaultColumnLayouts();
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return layouts;
  }
  const source = input as Record<string, unknown>;
  for (const table of COLUMN_TABLES) {
    const raw = source[table.key];
    if (!Array.isArray(raw)) {
      continue;
    }
    const allowed = new Set<string>(table.columns.map((column) => column.key));
    const picked: string[] = [];
    for (const item of raw) {
      if (typeof item === 'string' && allowed.has(item) && !picked.includes(item)) {
        picked.push(item);
      }
    }
    if (picked.length > 0) {
      layouts[table.key] = picked;
    }
    layouts.labels[table.key] = readLabels(source, table.key);
  }
  return layouts;
}

export function columnHeading(table: ColumnTableKey, key: string, layouts: ColumnLayouts): string {
  return layouts.labels[table]?.[key] || columnLabel(table, key);
}

/** Keeps only the chosen columns, in the saved order. Unknown keys are ignored. */
export function orderColumns<T extends { key: string }>(
  columns: readonly T[],
  keys: readonly string[],
): T[] {
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const ordered: T[] = [];
  for (const key of keys) {
    const column = byKey.get(key);
    if (column) {
      ordered.push(column);
    }
  }
  return ordered.length > 0 ? ordered : [...columns];
}

export type BuiltScreen = {
  moduleId: ModuleId;
  /** Shown when any of these modules is on. Defaults to moduleId. */
  anyOf?: readonly ModuleId[];
  section: string;
  path: string;
  label: string;
  purpose: string;
};

/** Screens that exist in the company app. Other catalog modules stay hidden. */
export const BUILT_SCREENS: readonly BuiltScreen[] = [
  {
    moduleId: 'KRN-01',
    section: 'System',
    path: '/users',
    label: 'People',
    purpose: 'Who can sign in, and the role each person has.',
  },
  {
    moduleId: 'KRN-03',
    section: 'System',
    path: '/branches',
    label: 'Branches',
    purpose: 'The places this company works from.',
  },
  {
    moduleId: 'KRN-04',
    section: 'System',
    path: '/settings/pipelines',
    label: 'Approvals And Alerts',
    purpose: 'The stages a record moves through, and the alerts that follow.',
  },
  {
    moduleId: 'KRN-06',
    section: 'System',
    path: '/import',
    label: 'Import Data',
    purpose: 'Bring in contacts, stock, and opening balances from a spreadsheet.',
  },
  {
    moduleId: 'KRN-02',
    section: 'Sales',
    path: '/contacts',
    label: 'Contacts',
    purpose: 'Customers, suppliers, and staff, in one list.',
  },
  {
    moduleId: 'SAL-01',
    section: 'Sales',
    path: '/quotes',
    label: 'Quotes',
    purpose: 'A price a customer can accept, then turn into a tax invoice.',
  },
  {
    moduleId: 'FIN-02',
    section: 'Sales',
    path: '/invoices',
    label: 'Invoices',
    purpose: 'Tax invoices, credit notes, and what each customer still owes.',
  },
  {
    moduleId: 'SCM-01',
    section: 'Inventory & Warehouse',
    path: '/stock',
    label: 'Stock',
    purpose: 'What is on the shelf, what it is worth, and what is running low.',
  },
  {
    moduleId: 'FIN-01',
    section: 'Finance',
    path: '/ledger',
    label: 'General Ledger',
    purpose: 'The chart of accounts, journals, and the financial reports.',
  },
  {
    moduleId: 'FIN-03',
    section: 'Finance',
    path: '/finance/creditors',
    label: 'Supplier Bills',
    purpose: 'Capture supplier bills, post them to the ledger, and review amounts outstanding.',
  },
  {
    moduleId: 'FIN-04',
    section: 'Finance',
    path: '/finance/cashbook',
    label: 'Cashbook',
    purpose: 'Maintain bank accounts, import statement lines, and complete reconciliations.',
  },
  {
    moduleId: 'FIN-05',
    section: 'Finance',
    path: '/finance/petty-cash',
    label: 'Petty Cash',
    purpose: 'Manage cash floats, record movements, and process staff expense claims.',
  },
  {
    moduleId: 'FIN-06',
    section: 'Finance',
    path: '/finance/tax',
    label: 'VAT & Tax',
    purpose: 'Maintain tax codes, capture VAT transactions, and prepare and file VAT periods.',
  },
  {
    moduleId: 'ANA-03',
    section: 'Reports',
    path: '/reports',
    label: 'Reports',
    purpose: 'Build a report from the records you can see, then save or export it.',
  },
];

export function screensForModules(active: readonly string[]): BuiltScreen[] {
  const on = new Set(active);
  return BUILT_SCREENS.filter((screen) =>
    (screen.anyOf ?? [screen.moduleId]).some((id) => on.has(id)),
  );
}

export function columnLabel(table: ColumnTableKey, key: string): string {
  return tableByKey(table).columns.find((column) => column.key === key)?.label ?? key;
}
