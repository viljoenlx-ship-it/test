/**
 * Client-facing index of the blueprint catalog.
 * `built` follows BUILT_SCREENS, so a module lights up when a screen exists
 * and the company has it switched on. Names here are what people see.
 * Codes stay in the catalog, not in the company app.
 */

import { BUILT_SCREENS } from './columns';
import { MODULES, type ModuleDomain, type ModuleId } from './modules';

export const MODULE_AREAS = [
  'Company',
  'Finance',
  'Sales',
  'Supply Chain',
  'Operations',
  'HR',
  'Compliance',
  'Analytics',
] as const;

export type ModuleArea = (typeof MODULE_AREAS)[number];

export type ModuleIcon =
  | 'people'
  | 'contacts'
  | 'branches'
  | 'approvals'
  | 'portals'
  | 'import'
  | 'ledger'
  | 'invoices'
  | 'bills'
  | 'bank'
  | 'cash'
  | 'vat'
  | 'quotes'
  | 'orders'
  | 'pos'
  | 'rentals'
  | 'support'
  | 'stock'
  | 'purchasing'
  | 'warehouse'
  | 'deliveries'
  | 'manufacturing'
  | 'jobs'
  | 'assets'
  | 'quality'
  | 'employees'
  | 'time'
  | 'payroll'
  | 'staffDocs'
  | 'welfare'
  | 'equity'
  | 'filings'
  | 'safety'
  | 'projects'
  | 'it'
  | 'reports';

export type ModuleIndexEntry = {
  id: ModuleId;
  name: string;
  area: ModuleArea;
  icon: ModuleIcon;
  summary: string;
  slug: string;
  built: boolean;
  /** Real screen, or the overview until that screen exists. */
  href: string;
};

type Face = {
  name: string;
  icon: ModuleIcon;
  summary: string;
  slug: string;
};

const AREA_BY_DOMAIN: Record<ModuleDomain, ModuleArea> = {
  'Core Kernel & Governance': 'Company',
  'Finance & Accounting': 'Finance',
  'Sales, CRM & Revenue': 'Sales',
  'Supply Chain & Stock': 'Supply Chain',
  'Production & Operations': 'Operations',
  'Human Resources': 'HR',
  'Compliance, Risk & HSE': 'Compliance',
  'Projects, IT & Analytics': 'Analytics',
};

const FACES: Record<ModuleId, Face> = {
  'KRN-01': {
    name: 'People',
    icon: 'people',
    slug: 'people',
    summary: 'Who can sign in, and what each person is allowed to do.',
  },
  'KRN-02': {
    name: 'Contacts',
    icon: 'contacts',
    slug: 'contacts',
    summary: 'Customers, suppliers, and staff in one list.',
  },
  'KRN-03': {
    name: 'Branches',
    icon: 'branches',
    slug: 'branches',
    summary: 'The places this company works from.',
  },
  'KRN-04': {
    name: 'Approvals',
    icon: 'approvals',
    slug: 'approvals',
    summary: 'The stages a record moves through, and the alerts that follow.',
  },
  'KRN-05': {
    name: 'Portals',
    icon: 'portals',
    slug: 'portals',
    summary: 'A link a customer or supplier can open to see their own documents.',
  },
  'KRN-06': {
    name: 'Import',
    icon: 'import',
    slug: 'import',
    summary: 'Bring contacts, stock, and opening balances in from a spreadsheet.',
  },
  'FIN-01': {
    name: 'General Ledger',
    icon: 'ledger',
    slug: 'general-ledger',
    summary: 'The chart of accounts, journals, and the financial reports.',
  },
  'FIN-02': {
    name: 'Invoices',
    icon: 'invoices',
    slug: 'invoices',
    summary: 'Customer invoices and what each customer still owes.',
  },
  'FIN-03': {
    name: 'Supplier Bills',
    icon: 'bills',
    slug: 'supplier-bills',
    summary: 'Supplier bills, payment runs, and what the company owes.',
  },
  'FIN-04': {
    name: 'Bank',
    icon: 'bank',
    slug: 'bank',
    summary: 'Match the bank statement to money in and money out.',
  },
  'FIN-05': {
    name: 'Petty Cash',
    icon: 'cash',
    slug: 'petty-cash',
    summary: 'Till floats, a petty cash box, and a claim for a staff slip.',
  },
  'FIN-06': {
    name: 'VAT',
    icon: 'vat',
    slug: 'vat',
    summary: 'Work out VAT and lock a period after it is filed.',
  },
  'SAL-01': {
    name: 'Quotes',
    icon: 'quotes',
    slug: 'quotes',
    summary: 'Track a lead and send a price a customer can accept.',
  },
  'SAL-02': {
    name: 'Sales Orders',
    icon: 'orders',
    slug: 'sales-orders',
    summary: 'Reserve stock, deliver it, and invoice what went out.',
  },
  'SAL-03': {
    name: 'Point Of Sale',
    icon: 'pos',
    slug: 'point-of-sale',
    summary: 'Sell at the counter, split the payment, and cash up the till.',
  },
  'SAL-04': {
    name: 'Rentals',
    icon: 'rentals',
    slug: 'rentals',
    summary: 'Send the same invoice each month, and track equipment out on hire.',
  },
  'SAL-05': {
    name: 'Support',
    icon: 'support',
    slug: 'support',
    summary: 'Log a problem, a return, or a warranty claim.',
  },
  'SCM-01': {
    name: 'Stock',
    icon: 'stock',
    slug: 'stock',
    summary: 'Products, quantities on hand, and a record of every movement.',
  },
  'SCM-02': {
    name: 'Purchasing',
    icon: 'purchasing',
    slug: 'purchasing',
    summary: 'Ask a supplier for a price and raise a purchase order.',
  },
  'SCM-03': {
    name: 'Warehouse',
    icon: 'warehouse',
    slug: 'warehouse',
    summary: 'Put goods in a bin, pick from that bin, and count what is there.',
  },
  'SCM-04': {
    name: 'Deliveries',
    icon: 'deliveries',
    slug: 'deliveries',
    summary: 'Load deliveries onto a vehicle and keep the signed proof.',
  },
  'OPS-01': {
    name: 'Manufacturing',
    icon: 'manufacturing',
    slug: 'manufacturing',
    summary: 'Issue parts to a work order and take the finished goods back into stock.',
  },
  'OPS-02': {
    name: 'Job Cards',
    icon: 'jobs',
    slug: 'job-cards',
    summary: 'Collect parts, hours, and cash spent against one job.',
  },
  'OPS-03': {
    name: 'Assets',
    icon: 'assets',
    slug: 'assets',
    summary: 'The asset register, depreciation, and a service before a breakdown.',
  },
  'OPS-04': {
    name: 'Quality',
    icon: 'quality',
    slug: 'quality',
    summary: 'Inspect goods on arrival and record what failed.',
  },
  'HRP-01': {
    name: 'Employees',
    icon: 'employees',
    slug: 'employees',
    summary: 'The staff file, who they report to, and the steps to start someone.',
  },
  'HRP-02': {
    name: 'Time And Leave',
    icon: 'time',
    slug: 'time-and-leave',
    summary: 'Rosters, clock-in, overtime, and leave.',
  },
  'HRP-03': {
    name: 'Payroll',
    icon: 'payroll',
    slug: 'payroll',
    summary: 'A pay run, a payslip, and PAYE, UIF, and SDL.',
  },
  'HRP-04': {
    name: 'Staff Documents',
    icon: 'staffDocs',
    slug: 'staff-documents',
    summary: 'An employment contract or a warning filled in from the staff file.',
  },
  'HRP-05': {
    name: 'Staff Welfare',
    icon: 'welfare',
    slug: 'staff-welfare',
    summary: 'Staff loans, and notes that stay hidden from people who should not see them.',
  },
  'CMP-01': {
    name: 'Employment Equity',
    icon: 'equity',
    slug: 'employment-equity',
    summary: 'Equity counts and the B-BBEE scorecard.',
  },
  'CMP-02': {
    name: 'Labour Filings',
    icon: 'filings',
    slug: 'labour-filings',
    summary: 'COIDA earnings, a UI-19 when someone leaves, and POPIA consent.',
  },
  'CMP-03': {
    name: 'Health And Safety',
    icon: 'safety',
    slug: 'health-and-safety',
    summary: 'Incidents, PPE handed out, and contracts that are about to end.',
  },
  'ANA-01': {
    name: 'Projects',
    icon: 'projects',
    slug: 'projects',
    summary: 'Tasks, dates, and a budget next to what was spent.',
  },
  'ANA-02': {
    name: 'IT Assets',
    icon: 'it',
    slug: 'it-assets',
    summary: 'Who has which laptop, which software seats are in use, and internal tickets.',
  },
  'ANA-03': {
    name: 'Reports',
    icon: 'reports',
    slug: 'reports',
    summary: 'Pick the data, columns, and filters, then save or export the report.',
  },
};

let cached: ModuleIndexEntry[] | null = null;

/** One row per blueprint module, in catalog order. */
export function moduleIndex(): readonly ModuleIndexEntry[] {
  if (cached) {
    return cached;
  }
  const screens = new Map(BUILT_SCREENS.map((screen) => [screen.moduleId, screen]));
  cached = MODULES.map((module) => {
    const face = FACES[module.id];
    const screen = screens.get(module.id);
    return {
      id: module.id,
      name: face.name,
      area: module.id === 'FIN-02' ? 'Sales' : AREA_BY_DOMAIN[module.domain],
      icon: face.icon,
      summary: face.summary,
      slug: face.slug,
      built: Boolean(screen),
      href: screen?.path ?? `/modules/${face.slug}`,
    };
  });
  return cached;
}

export function moduleBySlug(slug: string): ModuleIndexEntry | undefined {
  return moduleIndex().find((entry) => entry.slug === slug);
}

export function moduleById(id: string): ModuleIndexEntry | undefined {
  return moduleIndex().find((entry) => entry.id === id);
}

export type ModuleAvailability = 'ready' | 'soon' | 'locked';

/** Ready when the screen exists and this company has the module on. */
export function moduleAvailability(
  entry: ModuleIndexEntry,
  active: readonly string[],
): ModuleAvailability {
  if (!entry.built) {
    return 'soon';
  }
  return active.includes(entry.id) ? 'ready' : 'locked';
}
