import { boolean, char, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/**
 * Mirrors modules/krn-02-party-directory/migrations.
 * Kept in this module so parallel modules do not edit packages/db/src/schema.ts.
 */

export const parties = pgTable('parties', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  kind: text('kind').notNull(),
  displayName: text('display_name').notNull(),
  legalName: text('legal_name'),
  tradingName: text('trading_name'),
  givenName: text('given_name'),
  familyName: text('family_name'),
  registrationNumber: text('registration_number'),
  vatNumber: text('vat_number'),
  idNumber: text('id_number'),
  passportNumber: text('passport_number'),
  popiaConsent: boolean('popia_consent').notNull(),
  popiaConsentAt: timestamp('popia_consent_at', { withTimezone: true, mode: 'date' }),
  status: text('status').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const partyRoles = pgTable(
  'party_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    partyId: uuid('party_id').notNull(),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [unique('party_roles_party_role').on(table.partyId, table.role)],
);

export const partyContacts = pgTable('party_contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  partyId: uuid('party_id').notNull(),
  name: text('name').notNull(),
  jobTitle: text('job_title'),
  email: text('email'),
  phone: text('phone'),
  isPrimary: boolean('is_primary').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const partyAddresses = pgTable('party_addresses', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  partyId: uuid('party_id').notNull(),
  kind: text('kind').notNull(),
  line1: text('line1').notNull(),
  line2: text('line2'),
  suburb: text('suburb'),
  city: text('city').notNull(),
  province: text('province'),
  postalCode: text('postal_code'),
  country: char('country', { length: 2 }).notNull(),
  isPrimary: boolean('is_primary').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const partyChannels = pgTable('party_channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  partyId: uuid('party_id').notNull(),
  kind: text('kind').notNull(),
  value: text('value').notNull(),
  label: text('label'),
  isPrimary: boolean('is_primary').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const partyTags = pgTable('party_tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  partyId: uuid('party_id').notNull(),
  tag: text('tag').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const partyNotes = pgTable('party_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  partyId: uuid('party_id').notNull(),
  body: text('body').notNull(),
  authorId: uuid('author_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
