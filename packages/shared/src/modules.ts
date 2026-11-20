/**
 * Module catalog from blueprint tab 6 (dependency graph and packaging).
 * This is metadata only. No business module is implemented here.
 * Activation checks use the hard prerequisites column, not the industry matrix.
 * The matrix is a product preset that will call these checks later.
 */

export const MODULE_IDS = [
  'KRN-01',
  'KRN-02',
  'KRN-03',
  'KRN-04',
  'KRN-05',
  'KRN-06',
  'FIN-01',
  'FIN-02',
  'FIN-03',
  'FIN-04',
  'FIN-05',
  'FIN-06',
  'SAL-01',
  'SAL-02',
  'SAL-03',
  'SAL-04',
  'SAL-05',
  'SCM-01',
  'SCM-02',
  'SCM-03',
  'SCM-04',
  'OPS-01',
  'OPS-02',
  'OPS-03',
  'OPS-04',
  'HRP-01',
  'HRP-02',
  'HRP-03',
  'HRP-04',
  'HRP-05',
  'CMP-01',
  'CMP-02',
  'CMP-03',
  'ANA-01',
  'ANA-02',
  'ANA-03',
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

export type ModuleTier = 1 | 2 | 3 | 4;

export const TIER_NAMES = {
  1: 'Kernel',
  2: 'Commercial Core',
  3: 'Operational',
  4: 'Back-Office',
} as const satisfies Record<ModuleTier, string>;

export type ModuleDomain =
  | 'Core Kernel & Governance'
  | 'Finance & Accounting'
  | 'Sales, CRM & Revenue'
  | 'Supply Chain & Stock'
  | 'Production & Operations'
  | 'Human Resources'
  | 'Compliance, Risk & HSE'
  | 'Projects, IT & Analytics';

export type Packaging =
  | 'Core Platform (Included)'
  | 'Essentials Tier'
  | 'Operations Add-On'
  | 'People & Compliance Pack'
  | 'Growth Add-On';

export type ModuleDefinition = {
  id: ModuleId;
  name: string;
  domain: ModuleDomain;
  tier: ModuleTier;
  packaging: Packaging;
  prerequisites: readonly ModuleId[];
  summary: string;
  canDisable: boolean;
};

function mod(
  id: ModuleId,
  name: string,
  domain: ModuleDomain,
  tier: ModuleTier,
  packaging: Packaging,
  prerequisites: readonly ModuleId[],
  summary: string,
  canDisable = true,
): ModuleDefinition {
  return { id, name, domain, tier, packaging, prerequisites, summary, canDisable };
}

const kernel = 'Core Kernel & Governance' as const;
const finance = 'Finance & Accounting' as const;
const sales = 'Sales, CRM & Revenue' as const;
const supply = 'Supply Chain & Stock' as const;
const operations = 'Production & Operations' as const;
const people = 'Human Resources' as const;
const compliance = 'Compliance, Risk & HSE' as const;
const analytics = 'Projects, IT & Analytics' as const;

const core = 'Core Platform (Included)' as const;
const essentials = 'Essentials Tier' as const;
const opsPack = 'Operations Add-On' as const;
const peoplePack = 'People & Compliance Pack' as const;
const growth = 'Growth Add-On' as const;

export const MODULES: readonly ModuleDefinition[] = [
  mod(
    'KRN-01',
    'Identity, Users & Zero-Trust RBAC',
    kernel,
    1,
    core,
    [],
    'Cannot be disabled; governs all authentication and permissions.',
    false,
  ),
  mod(
    'KRN-02',
    'Unified Party Directory',
    kernel,
    1,
    core,
    ['KRN-01'],
    'Single contact master required before creating customers, suppliers, or staff.',
  ),
  mod(
    'KRN-03',
    'Multi-Branch & Inter-Company Structure',
    kernel,
    1,
    core,
    ['KRN-01'],
    'Defaults to 1 Head Office branch; unlocks multi-branch when toggled.',
  ),
  mod(
    'KRN-04',
    'Custom Fields, State Machines & Workflows',
    kernel,
    1,
    core,
    ['KRN-01'],
    'Powers tenant-specific fields, pipelines, and automated alerts.',
  ),
  mod(
    'KRN-05',
    'External Self-Service Portals',
    kernel,
    1,
    growth,
    ['KRN-01', 'KRN-02'],
    'Exposes read/approve views to external parties via magic links.',
  ),
  mod(
    'KRN-06',
    'Data Migration & No-Lock-In Engine',
    kernel,
    1,
    core,
    ['KRN-01', 'KRN-02'],
    'Used during onboarding and full tenant data export.',
  ),
  mod(
    'FIN-01',
    'General Ledger & Chart of Accounts',
    finance,
    2,
    essentials,
    ['KRN-01', 'KRN-03'],
    'Central financial spine; receives automated journals from all sub-ledgers.',
  ),
  mod(
    'FIN-02',
    'Debtors (Accounts Receivable)',
    finance,
    2,
    essentials,
    ['KRN-02', 'FIN-01'],
    'Required for any customer invoicing, statements, or age analysis.',
  ),
  mod(
    'FIN-03',
    'Creditors (Accounts Payable)',
    finance,
    2,
    essentials,
    ['KRN-02', 'FIN-01'],
    'Required for supplier bills, payment batches, and B-BBEE spend tracking.',
  ),
  mod(
    'FIN-04',
    'Cashbook, Bank Feeds & Reconciliation',
    finance,
    2,
    essentials,
    ['FIN-01'],
    'Links bank accounts to debtor receipts, creditor payments, and petty cash.',
  ),
  mod(
    'FIN-05',
    'Petty Cash, Till Floats & Expense Claims',
    finance,
    2,
    essentials,
    ['FIN-01', 'FIN-04', 'KRN-02'],
    'Handles daily till floats, driver cash, and staff slip reimbursements.',
  ),
  mod(
    'FIN-06',
    'Tax, VAT & Statutory Audit',
    finance,
    2,
    essentials,
    ['FIN-01'],
    'Calculates VAT201 and locks submitted tax periods.',
  ),
  mod(
    'SAL-01',
    'CRM Pipeline & Quotes',
    sales,
    2,
    essentials,
    ['KRN-02', 'SCM-01'],
    'Can run standalone for CRM-only teams or feed Sales Orders.',
  ),
  mod(
    'SAL-02',
    'Sales Orders & Fulfilment',
    sales,
    2,
    essentials,
    ['KRN-02', 'SCM-01', 'FIN-02'],
    'Bridges customer orders with stock reservation, dispatch, and invoicing.',
  ),
  mod(
    'SAL-03',
    'Point of Sale (POS) & Counter Sales',
    sales,
    3,
    opsPack,
    ['SCM-01', 'FIN-02', 'FIN-04', 'FIN-05'],
    'Requires Catalog, Debtors (Walk-in Cash Customer), and Cashbook/Till Float.',
  ),
  mod(
    'SAL-04',
    'Recurring Billing, Subscriptions & Rentals',
    sales,
    3,
    opsPack,
    ['KRN-02', 'SCM-01', 'FIN-02'],
    'Automates recurring invoices and tracks hired-out serialized units.',
  ),
  mod(
    'SAL-05',
    'Customer Support, Returns & Warranties',
    sales,
    3,
    opsPack,
    ['KRN-02', 'SCM-01'],
    'Links RMA returns to credit notes and serial warranty history.',
  ),
  mod(
    'SCM-01',
    'Universal Catalog & Inventory Ledger',
    supply,
    2,
    essentials,
    ['KRN-03', 'FIN-01'],
    'Supports service-only items if physical stock tracking is toggled off.',
  ),
  mod(
    'SCM-02',
    'Procurement & Supplier Management',
    supply,
    2,
    essentials,
    ['KRN-02', 'SCM-01', 'FIN-03'],
    'Manages RFQs, POs, and supplier B-BBEE certificate validity.',
  ),
  mod(
    'SCM-03',
    'Warehousing, Bins & Stocktakes',
    supply,
    3,
    opsPack,
    ['KRN-03', 'SCM-01'],
    'Adds bin-level location tracking on top of basic branch inventory.',
  ),
  mod(
    'SCM-04',
    'Logistics, Dispatch & Fleet Trips',
    supply,
    3,
    opsPack,
    ['SAL-02', 'SCM-03'],
    'Groups delivery notes into vehicle runs and tracks fuel/PODs.',
  ),
  mod(
    'OPS-01',
    'Manufacturing & Bills of Materials (BOM)',
    operations,
    3,
    opsPack,
    ['SCM-01', 'FIN-01'],
    'Consumes component stock into WIP and outputs finished goods.',
  ),
  mod(
    'OPS-02',
    'Field Service & Job Costing',
    operations,
    3,
    opsPack,
    ['KRN-02', 'SCM-01', 'FIN-02'],
    'Aggregates parts, timesheets, and petty cash onto client Job Cards.',
  ),
  mod(
    'OPS-03',
    'Asset Register & Preventative Maintenance',
    operations,
    3,
    opsPack,
    ['KRN-03', 'FIN-01', 'SCM-01'],
    'Tracks fixed asset depreciation alongside spare parts and service schedules.',
  ),
  mod(
    'OPS-04',
    'Quality Assurance (QA) & Non-Conformance',
    operations,
    3,
    opsPack,
    ['SCM-01'],
    'Adds inspection checkpoints to GRNs and manufacturing work orders.',
  ),
  mod(
    'HRP-01',
    'Employee Master, Org Chart & Onboarding',
    people,
    4,
    peoplePack,
    ['KRN-01', 'KRN-02'],
    'Extends Party records with employment dates, job grades, and demographics.',
  ),
  mod(
    'HRP-02',
    'Time, Attendance & Shift Rostering',
    people,
    4,
    peoplePack,
    ['HRP-01'],
    'Feeds worked hours, overtime, and leave into Payroll and Job Costing.',
  ),
  mod(
    'HRP-03',
    'Payroll Engine & Statutory Deductions',
    people,
    4,
    peoplePack,
    ['HRP-01', 'FIN-01'],
    'Posts salary journals to GL and exports bank EFT and SARS tax files.',
  ),
  mod(
    'HRP-04',
    'Personnel Document Generator',
    people,
    4,
    peoplePack,
    ['HRP-01', 'KRN-04'],
    'Merges employee fields into BCEA contracts, warnings, and Certificates of Service.',
  ),
  mod(
    'HRP-05',
    'Staff Welfare & Employee Assistance',
    people,
    4,
    peoplePack,
    ['HRP-01', 'KRN-01'],
    'Requires strict RBAC encryption; links staff loans to Payroll and GL.',
  ),
  mod(
    'CMP-01',
    'Employment Equity (EE) & B-BBEE',
    compliance,
    4,
    peoplePack,
    ['HRP-01', 'FIN-03', 'SCM-02'],
    'Pulls workforce demographics from HR and verified spend from Creditors.',
  ),
  mod(
    'CMP-02',
    'COIDA, Labour Filings & POPIA Privacy',
    compliance,
    4,
    peoplePack,
    ['HRP-01', 'HRP-03', 'KRN-02'],
    'Automates COIDA earnings, UI-19 exit forms, and POPIA anonymization.',
  ),
  mod(
    'CMP-03',
    'Health, Safety (HSE) & Legal Contracts',
    compliance,
    4,
    peoplePack,
    ['KRN-02', 'HRP-01'],
    'Tracks OHSA safety incidents, PPE issues, and supplier/client SLAs.',
  ),
  mod(
    'ANA-01',
    'Project Management & Milestones',
    analytics,
    4,
    growth,
    ['KRN-01', 'KRN-04'],
    'Provides Gantt milestones, task boards, and project budget tracking.',
  ),
  mod(
    'ANA-02',
    'IT Assets, Software Licenses & Helpdesk',
    analytics,
    4,
    growth,
    ['HRP-01', 'OPS-03'],
    'Tracks laptop custody, software seat renewals, and internal IT tickets.',
  ),
  mod(
    'ANA-03',
    'Executive Dashboards & Custom Report Builder',
    analytics,
    1,
    core,
    ['KRN-01'],
    'Dynamically surfaces KPIs only for modules enabled by the tenant.',
  ),
];

function assertCatalogComplete(modules: readonly ModuleDefinition[]): void {
  const seen = new Set<ModuleId>();
  for (const module of modules) {
    if (seen.has(module.id)) {
      throw new Error(`Module catalog lists ${module.id} more than once.`);
    }
    seen.add(module.id);
  }

  for (const id of MODULE_IDS) {
    if (!seen.has(id)) {
      throw new Error(`Module catalog is missing ${id}.`);
    }
  }

  for (const module of modules) {
    for (const prerequisite of module.prerequisites) {
      if (!seen.has(prerequisite)) {
        throw new Error(`${module.id} depends on unknown module ${prerequisite}.`);
      }
    }
  }
}

assertCatalogComplete(MODULES);

const byId = new Map<ModuleId, ModuleDefinition>(MODULES.map((module) => [module.id, module]));

export function isModuleId(value: string): value is ModuleId {
  return byId.has(value as ModuleId);
}

export function getModule(id: ModuleId): ModuleDefinition {
  const module = byId.get(id);
  if (!module) {
    throw new Error(`Unknown module ${id}.`);
  }
  return module;
}

export function prerequisitesMissing(active: ReadonlySet<ModuleId>, id: ModuleId): ModuleId[] {
  return getModule(id).prerequisites.filter((prerequisite) => !active.has(prerequisite));
}

export function assertCanActivate(active: ReadonlySet<ModuleId>, id: ModuleId): void {
  const missing = prerequisitesMissing(active, id);
  if (missing.length > 0) {
    throw new Error(`Cannot activate ${id}. Activate these first: ${missing.join(', ')}.`);
  }
}

export function deactivationBlockers(active: ReadonlySet<ModuleId>, id: ModuleId): ModuleId[] {
  return MODULES.filter(
    (candidate) => active.has(candidate.id) && candidate.prerequisites.includes(id),
  ).map((candidate) => candidate.id);
}

/** Prerequisites that are not active yet. The target module itself is not included. */
export function modulesPulledIn(active: ReadonlySet<ModuleId>, id: ModuleId): ModuleId[] {
  return activationClosure(id).filter((moduleId) => moduleId !== id && !active.has(moduleId));
}

export function assertCanDeactivate(active: ReadonlySet<ModuleId>, id: ModuleId): void {
  const module = getModule(id);
  if (!module.canDisable) {
    throw new Error(`${id} is part of the kernel foundation and cannot be disabled.`);
  }

  const blockers = deactivationBlockers(active, id);
  if (blockers.length > 0) {
    throw new Error(
      `Cannot deactivate ${id} while these modules are active: ${blockers.join(', ')}.`,
    );
  }
}

/** Target module plus every hard prerequisite, prerequisites first. */
export function activationClosure(id: ModuleId): ModuleId[] {
  const seen = new Set<ModuleId>();
  const order: ModuleId[] = [];

  const visit = (current: ModuleId): void => {
    if (seen.has(current)) {
      return;
    }
    seen.add(current);
    for (const prerequisite of getModule(current).prerequisites) {
      visit(prerequisite);
    }
    order.push(current);
  };

  visit(id);
  return order;
}

/** Every module after its prerequisites. Throws if the catalog contains a cycle. */
export function activationOrder(): ModuleId[] {
  const incoming = new Map<ModuleId, number>(MODULE_IDS.map((id) => [id, 0]));
  const dependents = new Map<ModuleId, ModuleId[]>(MODULE_IDS.map((id) => [id, []]));

  for (const module of MODULES) {
    for (const prerequisite of module.prerequisites) {
      incoming.set(module.id, (incoming.get(module.id) ?? 0) + 1);
      dependents.get(prerequisite)?.push(module.id);
    }
  }

  const ready = MODULE_IDS.filter((id) => incoming.get(id) === 0);
  const order: ModuleId[] = [];

  while (ready.length > 0) {
    const next = ready.shift();
    if (!next) {
      break;
    }
    order.push(next);
    for (const dependent of dependents.get(next) ?? []) {
      const remaining = (incoming.get(dependent) ?? 0) - 1;
      incoming.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
      }
    }
  }

  if (order.length !== MODULE_IDS.length) {
    throw new Error('Module prerequisites contain a cycle.');
  }

  return order;
}
