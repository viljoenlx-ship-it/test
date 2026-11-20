import { planFromMarked, type ActivationPlan } from './industry';
import { MODULES, type ModuleId, type Packaging } from './modules';

/**
 * Commercial packages from blueprint tab 6.
 * A tenant is assigned one package. Modules are still switched one by one.
 * KRN-01 stays on either way.
 */
export const COMMERCIAL_PACKAGES = [
  {
    key: 'core',
    name: 'Core Platform (Included)',
    packaging: 'Core Platform (Included)',
    summary: 'Identity, parties, branches, workflows, import, and dashboards.',
  },
  {
    key: 'essentials',
    name: 'Essentials Tier',
    packaging: 'Essentials Tier',
    summary: 'Ledger, debtors, creditors, cashbook, tax, sales, and stock.',
  },
  {
    key: 'operations',
    name: 'Operations Add-On',
    packaging: 'Operations Add-On',
    summary: 'Point of sale, rentals, warehouse, manufacturing, and jobs.',
  },
  {
    key: 'people',
    name: 'People & Compliance Pack',
    packaging: 'People & Compliance Pack',
    summary: 'HR, payroll, employment equity, and health and safety.',
  },
  {
    key: 'growth',
    name: 'Growth Add-On',
    packaging: 'Growth Add-On',
    summary: 'Portals, projects, and IT assets.',
  },
] as const satisfies readonly {
  key: string;
  name: string;
  packaging: Packaging;
  summary: string;
}[];

export type PackageKey = (typeof COMMERCIAL_PACKAGES)[number]['key'];

export function isPackageKey(value: string): value is PackageKey {
  return COMMERCIAL_PACKAGES.some((item) => item.key === value);
}

export function getCommercialPackage(key: PackageKey) {
  const item = COMMERCIAL_PACKAGES.find((candidate) => candidate.key === key);
  if (!item) {
    throw new Error(`Unknown package ${key}.`);
  }
  return item;
}

export function packageActivationPlan(key: PackageKey): ActivationPlan {
  const packaging = getCommercialPackage(key).packaging;
  const marked = new Set<ModuleId>(
    MODULES.filter((module) => module.packaging === packaging).map((module) => module.id),
  );
  return planFromMarked(marked);
}

export const PLATFORM_ACTIONS = [
  'tenants.read',
  'tenants.write',
  'branding.write',
  'modules.write',
  'settings.write',
  'users.read',
  'users.write',
  'audit.read',
] as const;

export type PlatformAction = (typeof PLATFORM_ACTIONS)[number];

export const PLATFORM_ROLES = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    key: 'platform_owner',
    name: 'Platform Owner',
    description: 'Runs the control panel. Can change every client.',
    actions: PLATFORM_ACTIONS,
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    key: 'platform_support',
    name: 'Platform Support',
    description: 'Can look up clients, their people, and the audit. Cannot change them.',
    actions: [
      'tenants.read',
      'users.read',
      'audit.read',
    ] as const satisfies readonly PlatformAction[],
  },
] as const;

export type PlatformRoleKey = (typeof PLATFORM_ROLES)[number]['key'];

export function isPlatformRoleKey(value: string): value is PlatformRoleKey {
  return PLATFORM_ROLES.some((role) => role.key === value);
}

export function platformPermissions(roleKeys: readonly string[]): Set<PlatformAction> {
  const allowed = new Set<PlatformAction>();
  for (const key of roleKeys) {
    const role = PLATFORM_ROLES.find((item) => item.key === key);
    if (!role) {
      continue;
    }
    for (const action of role.actions) {
      allowed.add(action);
    }
  }
  return allowed;
}

export function platformAllows(roleKeys: readonly string[], action: PlatformAction): boolean {
  return platformPermissions(roleKeys).has(action);
}

/** Fictional platform operator. Not a real person and not a tenant user. */
export const platformOperator = {
  id: '99999999-9999-4999-8999-999999999999',
  email: 'operator@omnivate.example',
  displayName: 'Alex Maseko',
  roleKey: 'platform_owner',
} as const;
