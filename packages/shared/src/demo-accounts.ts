/**
 * Fictional people for the two demo companies.
 * The password is a local development convenience. It is not a production secret.
 */

import { demoTenants } from './tenants';
import type { RoleKey } from './rbac';

export const DEMO_PASSWORD = 'local-demo-only';

export const demoAccounts = [
  {
    id: 'a1111111-1111-4111-8111-111111111101',
    tenantId: demoTenants[0].id,
    email: 'owner@aubergine-atlas.example',
    displayName: 'Thandi Molefe',
    roleKey: 'tenant_owner',
  },
  {
    id: 'a1111111-1111-4111-8111-111111111102',
    tenantId: demoTenants[0].id,
    email: 'manager@aubergine-atlas.example',
    displayName: 'Johan Pieters',
    roleKey: 'branch_manager',
  },
  {
    id: 'a1111111-1111-4111-8111-111111111103',
    tenantId: demoTenants[0].id,
    email: 'accountant@aubergine-atlas.example',
    displayName: 'Naledi Khumalo',
    roleKey: 'accountant',
  },
  {
    id: 'a1111111-1111-4111-8111-111111111104',
    tenantId: demoTenants[0].id,
    email: 'cashier@aubergine-atlas.example',
    displayName: 'Sipho Dlamini',
    roleKey: 'sales_cashier',
  },
  {
    id: 'a1111111-1111-4111-8111-111111111105',
    tenantId: demoTenants[0].id,
    email: 'warehouse@aubergine-atlas.example',
    displayName: 'Lerato Nkosi',
    roleKey: 'warehouse_technician',
  },
  {
    id: 'a1111111-1111-4111-8111-111111111106',
    tenantId: demoTenants[0].id,
    email: 'hr@aubergine-atlas.example',
    displayName: 'Ayesha Patel',
    roleKey: 'hr_compliance',
  },
  {
    id: 'a1111111-1111-4111-8111-111111111107',
    tenantId: demoTenants[0].id,
    email: 'portal@aubergine-atlas.example',
    displayName: 'Cape Coastal Supplies',
    roleKey: 'external_portal',
  },
  {
    id: 'b2222222-2222-4222-8222-222222222201',
    tenantId: demoTenants[1].id,
    email: 'owner@blue-crayon-foundry.example',
    displayName: 'Kabelo Mokoena',
    roleKey: 'tenant_owner',
  },
  {
    id: 'b2222222-2222-4222-8222-222222222202',
    tenantId: demoTenants[1].id,
    email: 'manager@blue-crayon-foundry.example',
    displayName: 'Annelise Venter',
    roleKey: 'branch_manager',
  },
  {
    id: 'b2222222-2222-4222-8222-222222222203',
    tenantId: demoTenants[1].id,
    email: 'accountant@blue-crayon-foundry.example',
    displayName: 'Pieter Naidoo',
    roleKey: 'accountant',
  },
  {
    id: 'b2222222-2222-4222-8222-222222222204',
    tenantId: demoTenants[1].id,
    email: 'cashier@blue-crayon-foundry.example',
    displayName: 'Zanele Mthembu',
    roleKey: 'sales_cashier',
  },
  {
    id: 'b2222222-2222-4222-8222-222222222205',
    tenantId: demoTenants[1].id,
    email: 'warehouse@blue-crayon-foundry.example',
    displayName: 'Francois Botha',
    roleKey: 'warehouse_technician',
  },
  {
    id: 'b2222222-2222-4222-8222-222222222206',
    tenantId: demoTenants[1].id,
    email: 'hr@blue-crayon-foundry.example',
    displayName: 'Nomsa Dube',
    roleKey: 'hr_compliance',
  },
  {
    id: 'b2222222-2222-4222-8222-222222222207',
    tenantId: demoTenants[1].id,
    email: 'portal@blue-crayon-foundry.example',
    displayName: 'Limpopo Packaging Co',
    roleKey: 'external_portal',
  },
] as const satisfies readonly {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  roleKey: RoleKey;
}[];

export type DemoAccount = (typeof demoAccounts)[number];
