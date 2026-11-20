/**
 * Default roles and access levels from blueprint tab 7 (Role & Permission Matrix).
 * Approval caps follow tab 9 CFG-11: above R10,000 needs a manager, above R50,000 needs the owner.
 * Staff-loan approval is the smaller cap. Owner admin is not amount-capped.
 * HRP-05 counseling is never implied by Full Admin (blueprint note on tab 7).
 */

import type { ModuleId } from './modules';

export const PERMISSION_ACTIONS = [
  'admin',
  'read',
  'operate',
  'post',
  'approve',
  'submit',
  'self',
  'counseling',
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** Welfare notes stay hidden unless this exact permission was granted. Admin does not imply it. */
export const COUNSELING_PERMISSION = 'hrp.welfare.counseling';

export const APPROVAL_LIMITS = {
  /** R50,000. Manager ceiling from CFG-11. */
  managerCents: 5_000_000n,
  /** R10,000. Supervisor ceiling from CFG-11, used for staff loans. */
  supervisorCents: 1_000_000n,
} as const;

/**
 * Who must use an authenticator before they get a session.
 * GOV-05 interpretation, decided 2026-11-19. Cashier, warehouse, and portal stay optional.
 * The database trigger in 0004_mfa_role_set.sql must list the same keys.
 */
export const MFA_REQUIRED_ROLE_KEYS = [
  'tenant_owner',
  'branch_manager',
  'accountant',
  'hr_compliance',
] as const;

function mfaRequired(key: string): boolean {
  return (MFA_REQUIRED_ROLE_KEYS as readonly string[]).includes(key);
}

export const ACCESS_ROLES = [
  {
    key: 'tenant_owner',
    name: 'Owner',
    description: 'Runs the company. Full access except welfare counseling notes.',
    mfaRequired: mfaRequired('tenant_owner'),
  },
  {
    key: 'branch_manager',
    name: 'Manager',
    description: 'Runs a branch. Approves operational amounts up to the manager ceiling.',
    mfaRequired: mfaRequired('branch_manager'),
  },
  {
    key: 'accountant',
    name: 'Accountant',
    description: 'Posts the financial records and prepares tax.',
    mfaRequired: mfaRequired('accountant'),
  },
  {
    key: 'sales_cashier',
    name: 'Cashier',
    description: 'Sells at the till, and sees only what the counter needs.',
    mfaRequired: mfaRequired('sales_cashier'),
  },
  {
    key: 'warehouse_technician',
    name: 'Warehouse',
    description: 'Receives, picks, and logs work on the floor.',
    mfaRequired: mfaRequired('warehouse_technician'),
  },
  {
    key: 'hr_compliance',
    name: 'HR',
    description: 'Runs people records, payroll prep, and welfare.',
    mfaRequired: mfaRequired('hr_compliance'),
  },
  {
    key: 'external_portal',
    name: 'Portal User',
    description: 'A customer or supplier on the portal. Sees only their own items.',
    mfaRequired: mfaRequired('external_portal'),
  },
] as const;

const LEGACY_ROLE_NAMES: Record<string, string> = {
  'Tenant Owner / SysAdmin': 'Owner',
  'Branch / Ops Manager': 'Manager',
  'Accountant / Bookkeeper': 'Accountant',
  'Sales / POS Cashier': 'Cashier',
  'Warehouse / Technician': 'Warehouse',
  'HR / Compliance Officer': 'HR',
  'External Portal User': 'Portal User',
  'Portal user': 'Portal User',
  'Platform owner': 'Platform Owner',
  'Platform support': 'Platform Support',
};

const EXTRA_ROLE_NAMES: Record<string, string> = {
  platform_owner: 'Platform Owner',
  platform_support: 'Platform Support',
};

/** The role name a person sees. Keys and older labels stay out of the screen. */
export function plainRoleName(role: { key?: string | null; name?: string | null }): string {
  const key = role.key ?? '';
  const fromKey = ACCESS_ROLES.find((item) => item.key === key)?.name ?? EXTRA_ROLE_NAMES[key];
  if (fromKey) {
    return fromKey;
  }
  const name = role.name?.trim() ?? '';
  if (LEGACY_ROLE_NAMES[name]) {
    return LEGACY_ROLE_NAMES[name];
  }
  if (name && !name.includes('.') && !/sysadmin|tenant|kernel/i.test(name)) {
    return name;
  }
  return 'Role';
}

export type RoleKey = (typeof ACCESS_ROLES)[number]['key'];

export const ROLE_KEYS = ACCESS_ROLES.map((role) => role.key) as readonly RoleKey[];

export function roleRequiresMfa(key: RoleKey): boolean {
  return (MFA_REQUIRED_ROLE_KEYS as readonly string[]).includes(key);
}

export function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}

export function getAccessRole(key: RoleKey): (typeof ACCESS_ROLES)[number] {
  const role = ACCESS_ROLES.find((candidate) => candidate.key === key);
  if (!role) {
    throw new Error(`Unknown role ${key}.`);
  }
  return role;
}

export type AccessCell = {
  label: string;
  actions: readonly PermissionAction[];
  /** Cap for approve. Null means an approve action is not amount-capped. */
  approvalLimitCents: bigint | null;
};

function cell(
  label: string,
  actions: readonly PermissionAction[],
  approvalLimitCents: bigint | null = null,
): AccessCell {
  return { label, actions, approvalLimitCents };
}

const managerCap = APPROVAL_LIMITS.managerCents;
const loanCap = APPROVAL_LIMITS.supervisorCents;

const fullAdmin = cell('Full Admin', ['admin']);
const noAccess = cell('No Access', []);
const readOnly = cell('Read Only', ['read']);
const managerApprove = (label: string) => cell(label, ['read', 'approve'], managerCap);

export type AccessScope = {
  scope: string;
  domain: string;
  functionalScope: string;
  modules: readonly ModuleId[];
  access: Record<RoleKey, AccessCell>;
};

function scope(
  scopeKey: string,
  domain: string,
  functionalScope: string,
  modules: readonly ModuleId[],
  access: Record<RoleKey, AccessCell>,
): AccessScope {
  return { scope: scopeKey, domain, functionalScope, modules, access };
}

export const ACCESS_SCOPES: readonly AccessScope[] = [
  scope(
    'krn',
    'Core Kernel & Governance',
    'Kernel, Branches, Portals & Data Import',
    ['KRN-01', 'KRN-02', 'KRN-03', 'KRN-04', 'KRN-05', 'KRN-06'],
    {
      tenant_owner: fullAdmin,
      branch_manager: cell('Branch Config', ['read', 'operate']),
      accountant: readOnly,
      sales_cashier: noAccess,
      warehouse_technician: noAccess,
      hr_compliance: noAccess,
      external_portal: cell('Self Portal Only', ['self']),
    },
  ),
  scope(
    'fin.ledger',
    'Finance & Accounting',
    'GL, Debtors, Creditors & Cashbook',
    ['FIN-01', 'FIN-02', 'FIN-03', 'FIN-04'],
    {
      tenant_owner: fullAdmin,
      branch_manager: managerApprove('Approve & View'),
      accountant: cell('Full / Post', ['read', 'operate', 'post']),
      sales_cashier: cell('View Customer Bal', ['read']),
      warehouse_technician: noAccess,
      hr_compliance: noAccess,
      external_portal: cell('Own Statements', ['self']),
    },
  ),
  scope(
    'fin.petty',
    'Finance & Accounting',
    'Petty Cash, Till Floats & Expense Claims',
    ['FIN-05'],
    {
      tenant_owner: fullAdmin,
      branch_manager: managerApprove('Approve Claims'),
      accountant: cell('Post & Reconcile', ['read', 'post']),
      sales_cashier: cell('Till Float / Submit', ['submit', 'operate']),
      warehouse_technician: cell('Submit Receipts', ['submit']),
      hr_compliance: cell('Submit Receipts', ['submit']),
      external_portal: noAccess,
    },
  ),
  scope('fin.tax', 'Finance & Accounting', 'Tax, VAT & Statutory Audit', ['FIN-06'], {
    tenant_owner: fullAdmin,
    branch_manager: readOnly,
    accountant: cell('Prepare & Lock', ['read', 'post']),
    sales_cashier: noAccess,
    warehouse_technician: noAccess,
    hr_compliance: noAccess,
    external_portal: noAccess,
  }),
  scope(
    'sal.pipeline',
    'Sales, CRM & Revenue',
    'CRM Pipeline, Quotes & Sales Orders',
    ['SAL-01', 'SAL-02'],
    {
      tenant_owner: fullAdmin,
      branch_manager: managerApprove('Approve Discounts'),
      accountant: cell('View Invoices', ['read']),
      sales_cashier: cell('Full Create/Edit', ['read', 'operate']),
      warehouse_technician: cell('View Job Scope', ['read']),
      hr_compliance: noAccess,
      external_portal: cell('Approve Quotes', ['read', 'approve']),
    },
  ),
  scope('sal.pos', 'Sales, CRM & Revenue', 'Point of Sale (POS) & Counter Sales', ['SAL-03'], {
    tenant_owner: fullAdmin,
    branch_manager: cell('Void / Cash-Up', ['read', 'approve']),
    accountant: cell('Audit Z-Reads', ['read']),
    sales_cashier: cell('Operate Till', ['operate']),
    warehouse_technician: noAccess,
    hr_compliance: noAccess,
    external_portal: noAccess,
  }),
  scope(
    'sal.recurring',
    'Sales, CRM & Revenue',
    'Recurring Billing, Subscriptions & Rentals',
    ['SAL-04'],
    {
      tenant_owner: fullAdmin,
      branch_manager: managerApprove('Approve Contracts'),
      accountant: cell('Billing Runs', ['read', 'post']),
      sales_cashier: cell('Create / Check-Out', ['read', 'operate']),
      warehouse_technician: cell('Inspect Returns', ['read']),
      hr_compliance: noAccess,
      external_portal: cell('View Hire Units', ['read']),
    },
  ),
  scope(
    'sal.support',
    'Sales, CRM & Revenue',
    'Customer Support, Returns & Warranties',
    ['SAL-05'],
    {
      tenant_owner: fullAdmin,
      branch_manager: managerApprove('Approve Credits'),
      accountant: cell('Issue Credit Notes', ['read', 'post']),
      sales_cashier: cell('Log & Resolve', ['read', 'operate']),
      warehouse_technician: cell('Technical Inspect', ['read']),
      hr_compliance: noAccess,
      external_portal: cell('Log / Track Tickets', ['submit']),
    },
  ),
  scope('scm.catalog', 'Supply Chain & Stock', 'Universal Catalog & Inventory Ledger', ['SCM-01'], {
    tenant_owner: fullAdmin,
    branch_manager: managerApprove('Approve Adj.'),
    accountant: cell('Costing & Valuation', ['read', 'post']),
    sales_cashier: cell('View Stock Qty', ['read']),
    warehouse_technician: cell('Full Stock Control', ['read', 'operate']),
    hr_compliance: noAccess,
    external_portal: cell('View Catalog', ['read']),
  }),
  scope(
    'scm.procurement',
    'Supply Chain & Stock',
    'Procurement & Supplier Management',
    ['SCM-02'],
    {
      tenant_owner: fullAdmin,
      branch_manager: managerApprove('Approve POs'),
      accountant: cell('3-Way Match Bills', ['read', 'post']),
      sales_cashier: cell('Request Quote', ['submit']),
      warehouse_technician: cell('Create POs / RFQs', ['read', 'operate']),
      hr_compliance: noAccess,
      external_portal: cell('Submit Quotes (RFQ)', ['submit']),
    },
  ),
  scope(
    'scm.warehouse',
    'Supply Chain & Stock',
    'Warehousing, Bins, Logistics & Fleet',
    ['SCM-03', 'SCM-04'],
    {
      tenant_owner: fullAdmin,
      branch_manager: readOnly,
      accountant: cell('View GRNs / PODs', ['read']),
      sales_cashier: cell('View Delivery ETA', ['read']),
      warehouse_technician: cell('Full Receive/Pick', ['read', 'operate']),
      hr_compliance: noAccess,
      external_portal: cell('View PODs', ['read']),
    },
  ),
  scope(
    'ops.jobs',
    'Production & Operations',
    'Manufacturing BOMs & Field Job Costing',
    ['OPS-01', 'OPS-02'],
    {
      tenant_owner: fullAdmin,
      branch_manager: cell('View Job Margins', ['read']),
      accountant: cell('WIP & Margin Audit', ['read']),
      sales_cashier: cell('Create Job Card', ['read', 'operate']),
      warehouse_technician: cell('Execute & Log Time', ['operate']),
      hr_compliance: noAccess,
      external_portal: cell('Sign Job Card', ['submit']),
    },
  ),
  scope(
    'ops.assets',
    'Production & Operations',
    'Fixed Assets, Maintenance & QA',
    ['OPS-03', 'OPS-04'],
    {
      tenant_owner: fullAdmin,
      branch_manager: managerApprove('Approve CapEx'),
      accountant: cell('Depreciation Runs', ['read', 'post']),
      sales_cashier: noAccess,
      warehouse_technician: cell('Full Maint. & QA', ['read', 'operate']),
      hr_compliance: noAccess,
      external_portal: noAccess,
    },
  ),
  scope(
    'hrp.people',
    'Human Resources',
    'Employee Master, Shifts & Timekeeping',
    ['HRP-01', 'HRP-02'],
    {
      tenant_owner: fullAdmin,
      branch_manager: cell('Approve Leave/OT', ['read', 'approve']),
      accountant: cell('Read Hours Only', ['read']),
      sales_cashier: cell('Own Clock/Leave', ['self']),
      warehouse_technician: cell('Own Clock/Leave', ['self']),
      hr_compliance: cell('Full HR Admin', ['admin']),
      external_portal: noAccess,
    },
  ),
  scope('hrp.payroll', 'Human Resources', 'Payroll Engine & Statutory Deductions', ['HRP-03'], {
    tenant_owner: fullAdmin,
    branch_manager: managerApprove('Approve Pay Run'),
    accountant: cell('Post GL & EFT', ['read', 'post']),
    sales_cashier: cell('Own Payslips', ['self']),
    warehouse_technician: cell('Own Payslips', ['self']),
    hr_compliance: cell('Prepare Pay Run', ['read', 'operate']),
    external_portal: noAccess,
  }),
  scope('hrp.documents', 'Human Resources', 'Personnel Document Generator', ['HRP-04'], {
    tenant_owner: fullAdmin,
    branch_manager: cell('Co-Sign Contracts', ['read', 'approve']),
    accountant: noAccess,
    sales_cashier: cell('E-Sign Own Docs', ['self']),
    warehouse_technician: cell('E-Sign Own Docs', ['self']),
    hr_compliance: cell('Generate & Issue', ['read', 'operate']),
    external_portal: noAccess,
  }),
  scope(
    'hrp.welfare',
    'Human Resources',
    'Staff Welfare & EAP (Zero-Trust Encrypted)',
    ['HRP-05'],
    {
      tenant_owner: cell('Restricted*', []),
      branch_manager: cell('Approve Loans Only', ['approve'], loanCap),
      accountant: cell('Loan GL Deduction', ['post']),
      sales_cashier: cell('Submit Request', ['submit']),
      warehouse_technician: cell('Submit Request', ['submit']),
      hr_compliance: cell('Welfare Officer*', ['admin', 'counseling']),
      external_portal: noAccess,
    },
  ),
  scope(
    'cmp.equity',
    'Compliance, Risk & HSE',
    'Employment Equity, B-BBEE, COIDA & POPIA',
    ['CMP-01', 'CMP-02'],
    {
      tenant_owner: fullAdmin,
      branch_manager: cell('Read Scorecards', ['read']),
      accountant: cell('B-BBEE Spend Log', ['read', 'operate']),
      sales_cashier: noAccess,
      warehouse_technician: noAccess,
      hr_compliance: cell('Full Compliance', ['admin']),
      external_portal: cell('Upload B-BBEE Cert', ['submit']),
    },
  ),
  scope('cmp.hse', 'Compliance, Risk & HSE', 'Health, Safety (HSE) & Legal Contracts', ['CMP-03'], {
    tenant_owner: fullAdmin,
    branch_manager: cell('Review Incidents', ['read']),
    accountant: cell('Store SLAs', ['read']),
    sales_cashier: cell('Report Incident', ['submit']),
    warehouse_technician: cell('Safety Checklists', ['operate']),
    hr_compliance: cell('HSE / Legal Admin', ['admin']),
    external_portal: noAccess,
  }),
  scope(
    'ana',
    'Projects, IT & Analytics',
    'Projects, IT Assets & Executive Dashboards',
    ['ANA-01', 'ANA-02', 'ANA-03'],
    {
      tenant_owner: fullAdmin,
      branch_manager: cell('Branch Dashboards', ['read']),
      accountant: cell('Financial BI', ['read']),
      sales_cashier: cell('Sales BI & Tasks', ['read', 'operate']),
      warehouse_technician: cell('Ops BI & Tasks', ['read', 'operate']),
      hr_compliance: cell('HR BI & Tasks', ['read', 'operate']),
      external_portal: noAccess,
    },
  ),
];

export type SeedGrant = {
  scope: string;
  modules: readonly ModuleId[];
  action: PermissionAction;
  accessLabel: string;
  approvalLimitCents: bigint | null;
};

export function seedGrantsForRole(roleKey: RoleKey): SeedGrant[] {
  const grants: SeedGrant[] = [];
  for (const entry of ACCESS_SCOPES) {
    const access = entry.access[roleKey];
    for (const action of access.actions) {
      grants.push({
        scope: entry.scope,
        modules: entry.modules,
        action,
        accessLabel: access.label,
        approvalLimitCents: action === 'approve' ? access.approvalLimitCents : null,
      });
    }
  }
  return grants;
}

export function permissionKey(scopeKey: string, action: PermissionAction): string {
  return `${scopeKey}.${action}`;
}
