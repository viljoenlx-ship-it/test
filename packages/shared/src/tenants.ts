/**
 * Fixed identities for the two local demo companies.
 * Both are invented. Do not replace them with real customers.
 */
export const demoTenants = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'aubergine-atlas',
    displayName: 'Aubergine Atlas Traders (Pty) Ltd',
    city: 'Cape Town',
    note: 'Fictional Cape Town demo company. Not a real business.',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'blue-crayon-foundry',
    displayName: 'Blue Crayon Foundry (Pty) Ltd',
    city: 'Polokwane',
    note: 'Fictional Polokwane demo company. Not a real business.',
  },
] as const;

export type DemoTenant = (typeof demoTenants)[number];

declare const tenantIdBrand: unique symbol;

export type TenantId = string & { readonly [tenantIdBrand]: 'TenantId' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function tenantId(value: string): TenantId {
  if (!UUID_PATTERN.test(value)) {
    throw new Error('A tenant id must be a UUID.');
  }
  return value as TenantId;
}
