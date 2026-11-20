import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Column names mirror packages/db/migrations. Change both together.
 * amount_cents is bigint. Do not add a float or numeric money column.
 */

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(),
  displayName: text('display_name').notNull(),
  companyName: text('company_name').notNull().default(''),
  legalName: text('legal_name'),
  tradingName: text('trading_name'),
  registrationNumber: text('registration_number'),
  vatNumber: text('vat_number'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  addressCity: text('address_city'),
  addressProvince: text('address_province'),
  addressPostalCode: text('address_postal_code'),
  addressCountry: text('address_country').notNull().default('ZA'),
  industryPreset: text('industry_preset'),
  status: text('status').notNull().default('active'),
  packageKey: text('package_key').notNull().default('core'),
  suspendedAt: timestamp('suspended_at', { withTimezone: true, mode: 'date' }),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  brandPrimary: text('brand_primary').notNull().default('#4020a0'),
  brandAccent: text('brand_accent').notNull().default('#08b8b8'),
  logoStorageKey: text('logo_storage_key'),
  vatRateBasisPoints: integer('vat_rate_basis_points').notNull().default(1500),
  financialYearStartMonth: integer('financial_year_start_month').notNull().default(3),
  isDemo: boolean('is_demo').notNull(),
  timezone: text('timezone').notNull(),
  currencyCode: text('currency_code').notNull(),
  columnLayouts: jsonb('column_layouts').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const foundationNotes = pgTable('foundation_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  actorId: uuid('actor_id'),
  actorKind: text('actor_kind').notNull().default('user'),
  operatorId: uuid('operator_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  beforeData: jsonb('before_data'),
  afterData: jsonb('after_data'),
  requestIp: text('request_ip'),
  userAgent: text('user_agent'),
});

export const foundationPostings = pgTable('foundation_postings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  status: text('status').notNull(),
  description: text('description').notNull(),
  amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
  currencyCode: text('currency_code').notNull(),
  postedAt: timestamp('posted_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  status: text('status').notNull(),
  totpSecret: text('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [unique('memberships_tenant_user').on(table.tenantId, table.userId)],
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    mfaRequired: boolean('mfa_required').notNull(),
    isSystem: boolean('is_system').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [unique('roles_tenant_key').on(table.tenantId, table.key)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    roleId: uuid('role_id').notNull(),
    scope: text('scope').notNull(),
    modules: text('modules').array().notNull(),
    action: text('action').notNull(),
    accessLabel: text('access_label').notNull(),
    approvalLimitCents: bigint('approval_limit_cents', { mode: 'bigint' }),
  },
  (table) => [
    unique('role_permissions_role_scope_action').on(
      table.tenantId,
      table.roleId,
      table.scope,
      table.action,
    ),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id').notNull(),
    assignedBy: uuid('assigned_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [unique('user_roles_tenant_user_role').on(table.tenantId, table.userId, table.roleId)],
);

export const userInvites = pgTable('user_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  email: text('email').notNull(),
  roleId: uuid('role_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  invitedBy: uuid('invited_by'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  requestIp: text('request_ip'),
  userAgent: text('user_agent'),
});

export const authChallenges = pgTable('auth_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  purpose: text('purpose').notNull(),
  tokenHash: text('token_hash').notNull(),
  totpSecret: text('totp_secret'),
  failedAttempts: integer('failed_attempts').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const loginAttempts = pgTable('login_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id'),
  email: text('email').notNull(),
  succeeded: boolean('succeeded').notNull(),
  requestIp: text('request_ip'),
  attemptedAt: timestamp('attempted_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export const sodRules = pgTable(
  'sod_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    actionA: text('action_a').notNull(),
    actionB: text('action_b').notNull(),
    description: text('description').notNull(),
    enabled: boolean('enabled').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [unique('sod_rules_pair').on(table.tenantId, table.actionA, table.actionB)],
);

export const platformOperators = pgTable('platform_operators', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  status: text('status').notNull(),
  totpSecret: text('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const platformRoles = pgTable('platform_roles', {
  id: uuid('id').primaryKey(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  mfaRequired: boolean('mfa_required').notNull(),
});

export const platformOperatorRoles = pgTable(
  'platform_operator_roles',
  {
    operatorId: uuid('operator_id').notNull(),
    roleId: uuid('role_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.operatorId, table.roleId] })],
);

export const platformSessions = pgTable('platform_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  operatorId: uuid('operator_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  requestIp: text('request_ip'),
  userAgent: text('user_agent'),
});

export const tenantModules = pgTable(
  'tenant_modules',
  {
    tenantId: uuid('tenant_id').notNull(),
    moduleId: text('module_id').notNull(),
    active: boolean('active').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.moduleId] })],
);

export const schema = {
  tenants,
  foundationNotes,
  auditEvents,
  foundationPostings,
  users,
  memberships,
  roles,
  rolePermissions,
  userRoles,
  userInvites,
  sessions,
  authChallenges,
  loginAttempts,
  sodRules,
  tenantModules,
  platformOperators,
  platformRoles,
  platformOperatorRoles,
  platformSessions,
};
