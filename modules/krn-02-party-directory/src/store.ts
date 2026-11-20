import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  FIELD_MASK,
  activeModuleSet,
  appendAuditEvent,
  assertSegregation,
  hasPermission,
  loadPermissionKeys,
  requirePermission,
  sodRules,
  type TenantTransaction,
} from '@omnivate/kernel';
import {
  normalPartyName,
  parsePartyDraft,
  permissionKey,
  type PartyDraft,
  type PartyRole,
} from '@omnivate/shared';
import { DuplicatePartyError, HttpError } from './http';
import {
  parties,
  partyAddresses,
  partyChannels,
  partyContacts,
  partyNotes,
  partyRoles,
  partyTags,
} from './schema';

const SUPPLIER_CREATE = 'party.supplier.create';
const STAFF_CREATE = 'party.staff.create';
const PAYOUT_APPROVE = 'fin.creditor.payout.approve';
const PAYROLL_APPROVE = 'hrp.payroll.payout.approve';

export type PartyCounts = {
  active: number;
  archived: number;
  customers: number;
  suppliers: number;
  staff: number;
  other: number;
};

type Actor = {
  userId: string;
  requestIp: string | null;
  userAgent: string | null;
};

type PartyRow = typeof parties.$inferSelect;
type ContactRow = typeof partyContacts.$inferSelect;
type AddressRow = typeof partyAddresses.$inferSelect;
type ChannelRow = typeof partyChannels.$inferSelect;
type NoteRow = typeof partyNotes.$inferSelect;

type Graph = {
  party: PartyRow;
  roles: PartyRole[];
  contacts: ContactRow[];
  addresses: AddressRow[];
  channels: ChannelRow[];
  tags: string[];
  notes: NoteRow[];
};

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function snapshot(
  graph: Graph,
  changes?: { idNumberChanged?: boolean; passportChanged?: boolean },
) {
  return {
    kind: graph.party.kind,
    displayName: graph.party.displayName,
    legalName: graph.party.legalName,
    tradingName: graph.party.tradingName,
    givenName: graph.party.givenName,
    familyName: graph.party.familyName,
    roles: graph.roles,
    registrationNumber: graph.party.registrationNumber,
    vatNumber: graph.party.vatNumber,
    idNumberPresent: Boolean(graph.party.idNumber),
    passportNumberPresent: Boolean(graph.party.passportNumber),
    ...(changes?.idNumberChanged ? { idNumberChanged: true } : {}),
    ...(changes?.passportChanged ? { passportNumberChanged: true } : {}),
    popiaConsent: graph.party.popiaConsent,
    popiaConsentAt: iso(graph.party.popiaConsentAt),
    status: graph.party.status,
    contacts: graph.contacts.map((contact) => ({
      name: contact.name,
      jobTitle: contact.jobTitle,
      email: contact.email,
      phone: contact.phone,
      isPrimary: contact.isPrimary,
    })),
    addresses: graph.addresses.map((address) => ({
      kind: address.kind,
      line1: address.line1,
      line2: address.line2,
      suburb: address.suburb,
      city: address.city,
      province: address.province,
      postalCode: address.postalCode,
      country: address.country,
      isPrimary: address.isPrimary,
    })),
    channels: graph.channels.map((channel) => ({
      kind: channel.kind,
      value: channel.value,
      label: channel.label,
      isPrimary: channel.isPrimary,
    })),
    tags: graph.tags,
    notes: graph.notes.map((note) => ({
      body: note.body,
      createdAt: iso(note.createdAt),
    })),
  };
}

function present(graph: Graph, canViewIdentity: boolean) {
  const idNumber = graph.party.idNumber
    ? canViewIdentity
      ? graph.party.idNumber
      : FIELD_MASK
    : null;
  const passportNumber = graph.party.passportNumber
    ? canViewIdentity
      ? graph.party.passportNumber
      : FIELD_MASK
    : null;
  return {
    id: graph.party.id,
    kind: graph.party.kind,
    displayName: graph.party.displayName,
    legalName: graph.party.legalName,
    tradingName: graph.party.tradingName,
    givenName: graph.party.givenName,
    familyName: graph.party.familyName,
    roles: graph.roles,
    registrationNumber: graph.party.registrationNumber,
    vatNumber: graph.party.vatNumber,
    idNumber,
    passportNumber,
    identityVisible: canViewIdentity,
    popiaConsent: graph.party.popiaConsent,
    popiaConsentAt: iso(graph.party.popiaConsentAt),
    status: graph.party.status,
    archivedAt: iso(graph.party.archivedAt),
    createdAt: iso(graph.party.createdAt),
    updatedAt: iso(graph.party.updatedAt),
    contacts: graph.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      jobTitle: contact.jobTitle,
      email: contact.email,
      phone: contact.phone,
      isPrimary: contact.isPrimary,
    })),
    addresses: graph.addresses.map((address) => ({
      id: address.id,
      kind: address.kind,
      line1: address.line1,
      line2: address.line2,
      suburb: address.suburb,
      city: address.city,
      province: address.province,
      postalCode: address.postalCode,
      country: address.country.trim(),
      isPrimary: address.isPrimary,
    })),
    channels: graph.channels.map((channel) => ({
      id: channel.id,
      kind: channel.kind,
      value: channel.value,
      label: channel.label,
      isPrimary: channel.isPrimary,
    })),
    tags: graph.tags,
    notes: graph.notes.map((note) => ({
      id: note.id,
      body: note.body,
      createdAt: iso(note.createdAt),
    })),
  };
}

async function flags(tx: TenantTransaction, userId: string) {
  await requirePermission(tx, userId, { scope: 'krn', action: 'read', moduleId: 'KRN-02' });
  const active = await activeModuleSet(tx);
  if (!active.has('KRN-02')) {
    throw new HttpError(
      403,
      'module_off',
      'Contacts are switched off for this company. A platform operator can turn the party directory on.',
    );
  }
  const keys = await loadPermissionKeys(tx, userId);
  return {
    canEdit: await hasPermission(tx, userId, {
      scope: 'krn',
      action: 'operate',
      moduleId: 'KRN-02',
    }),
    canViewIdentity: keys.has(permissionKey('krn', 'admin')),
  };
}

async function requireEdit(tx: TenantTransaction, userId: string): Promise<boolean> {
  const access = await flags(tx, userId);
  await requirePermission(tx, userId, { scope: 'krn', action: 'operate', moduleId: 'KRN-02' });
  return access.canViewIdentity;
}

export type PartyImportRow = {
  id: string;
  displayName: string;
  legalName: string | null;
  kind: string;
  status: string;
  vatNumber: string | null;
  email: string | null;
  phone: string | null;
  givenName: string | null;
  familyName: string | null;
  popiaConsent: boolean;
  roles: PartyRole[];
  city: string | null;
  updatedAt: string;
};

/**
 * Every contact, for the import engine. The caller has already checked permission.
 * KRN-06 uses this instead of reading the party tables itself.
 */
export async function listPartiesForImport(tx: TenantTransaction): Promise<PartyImportRow[]> {
  const rows = await tx.db.select().from(parties);
  if (rows.length === 0) {
    return [];
  }
  const ids = rows.map((row) => row.id);
  const roles = await tx.db.select().from(partyRoles).where(inArray(partyRoles.partyId, ids));
  const channels = await tx.db
    .select()
    .from(partyChannels)
    .where(inArray(partyChannels.partyId, ids));
  const addresses = await tx.db
    .select()
    .from(partyAddresses)
    .where(inArray(partyAddresses.partyId, ids));
  return rows.map((party) => {
    const partyChannelsHere = channels.filter((row) => row.partyId === party.id);
    const email =
      partyChannelsHere.find((row) => row.kind === 'email' && row.isPrimary)?.value ??
      partyChannelsHere.find((row) => row.kind === 'email')?.value ??
      null;
    const phone =
      partyChannelsHere.find((row) => row.kind === 'phone' && row.isPrimary)?.value ??
      partyChannelsHere.find((row) => row.kind === 'phone')?.value ??
      null;
    const address =
      addresses.find((row) => row.partyId === party.id && row.isPrimary) ??
      addresses.find((row) => row.partyId === party.id);
    return {
      id: party.id,
      displayName: party.displayName,
      legalName: party.legalName,
      kind: party.kind,
      status: party.status,
      vatNumber: party.vatNumber,
      email,
      phone,
      givenName: party.givenName,
      familyName: party.familyName,
      popiaConsent: party.popiaConsent,
      roles: roles.filter((row) => row.partyId === party.id).map((row) => row.role as PartyRole),
      city: address?.city ?? null,
      updatedAt: party.updatedAt.toISOString(),
    };
  });
}

export async function partyImportStamps(
  tx: TenantTransaction,
  ids: string[],
): Promise<{ id: string; status: string; updatedAt: string }[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await tx.db
    .select({ id: parties.id, status: parties.status, updatedAt: parties.updatedAt })
    .from(parties)
    .where(inArray(parties.id, ids));
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function countParties(tx: TenantTransaction): Promise<PartyCounts> {
  const totals = await tx.db
    .select({
      active: sql<number>`count(*) filter (where ${parties.status} = 'active')::int`,
      archived: sql<number>`count(*) filter (where ${parties.status} = 'archived')::int`,
    })
    .from(parties);
  const roleRows = await tx.db
    .select({
      role: partyRoles.role,
      count: sql<number>`count(distinct ${partyRoles.partyId})::int`,
    })
    .from(partyRoles)
    .innerJoin(parties, eq(parties.id, partyRoles.partyId))
    .where(eq(parties.status, 'active'))
    .groupBy(partyRoles.role);

  const byRole = new Map(roleRows.map((row) => [row.role, Number(row.count)]));
  return {
    active: Number(totals[0]?.active ?? 0),
    archived: Number(totals[0]?.archived ?? 0),
    customers: byRole.get('customer') ?? 0,
    suppliers: byRole.get('supplier') ?? 0,
    staff: byRole.get('staff') ?? 0,
    other: byRole.get('other') ?? 0,
  };
}

async function loadGraph(tx: TenantTransaction, id: string): Promise<Graph | null> {
  const rows = await tx.db.select().from(parties).where(eq(parties.id, id));
  const party = rows[0];
  if (!party) {
    return null;
  }
  const [roles, contacts, addresses, channels, tags, notes] = await Promise.all([
    tx.db.select().from(partyRoles).where(eq(partyRoles.partyId, id)),
    tx.db.select().from(partyContacts).where(eq(partyContacts.partyId, id)),
    tx.db.select().from(partyAddresses).where(eq(partyAddresses.partyId, id)),
    tx.db.select().from(partyChannels).where(eq(partyChannels.partyId, id)),
    tx.db.select().from(partyTags).where(eq(partyTags.partyId, id)),
    tx.db
      .select()
      .from(partyNotes)
      .where(eq(partyNotes.partyId, id))
      .orderBy(asc(partyNotes.createdAt)),
  ]);
  return {
    party,
    roles: roles.map((row) => row.role as PartyRole).sort(),
    contacts: contacts.sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary)),
    addresses: addresses.sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary)),
    channels: channels.sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary)),
    tags: tags.map((row) => row.tag).sort(),
    notes,
  };
}

async function ensureSod(tx: TenantTransaction, actor: Actor): Promise<void> {
  const pairs = [
    {
      actionA: PAYOUT_APPROVE,
      actionB: SUPPLIER_CREATE,
      description: 'The person who adds a supplier cannot approve that supplier payout.',
    },
    {
      actionA: PAYROLL_APPROVE,
      actionB: STAFF_CREATE,
      description: 'The person who adds a staff member cannot approve that person payout.',
    },
  ];
  for (const pair of pairs) {
    const existing = await tx.db
      .select({ id: sodRules.id })
      .from(sodRules)
      .where(
        and(
          eq(sodRules.tenantId, tx.tenantId),
          eq(sodRules.actionA, pair.actionA),
          eq(sodRules.actionB, pair.actionB),
        ),
      );
    if (existing.length > 0) {
      continue;
    }
    const inserted = await tx.db
      .insert(sodRules)
      .values({
        tenantId: tx.tenantId,
        actionA: pair.actionA,
        actionB: pair.actionB,
        description: pair.description,
        enabled: true,
      })
      .returning({ id: sodRules.id });
    const row = inserted[0];
    if (!row) {
      throw new Error('Segregation rule was not saved.');
    }
    await appendAuditEvent(tx, {
      action: 'identity.sod_rule.created',
      entityType: 'sod_rule',
      entityId: row.id,
      actorId: actor.userId,
      beforeData: null,
      afterData: {
        enabled: true,
        actionA: pair.actionA,
        actionB: pair.actionB,
        description: pair.description,
      },
      requestIp: actor.requestIp,
      userAgent: actor.userAgent,
    });
  }
}

async function findDuplicates(
  tx: TenantTransaction,
  draft: PartyDraft,
  excludeId: string | null,
): Promise<{ id: string; displayName: string; reasons: string[] }[]> {
  const names = [
    ...new Set(
      [draft.displayName, draft.legalName, draft.tradingName]
        .filter((name): name is string => Boolean(name))
        .map((name) => normalPartyName(name)),
    ),
  ];
  const emails = [
    ...new Set([
      ...draft.channels
        .filter((channel) => channel.kind === 'email')
        .map((channel) => channel.value),
      ...draft.contacts
        .map((contact) => contact.email)
        .filter((email): email is string => Boolean(email)),
    ]),
  ];
  const vat = draft.vatNumber ?? '';
  const nameClause = sql.join(
    names.flatMap((name) => [
      sql`lower(${parties.displayName}) = ${name}`,
      sql`lower(coalesce(${parties.legalName}, '')) = ${name}`,
      sql`lower(coalesce(${parties.tradingName}, '')) = ${name}`,
    ]),
    sql` OR `,
  );
  const emailClause =
    emails.length === 0
      ? sql`false`
      : sql`(
          exists (
            select 1 from party_channels as channel
            where channel.party_id = ${parties.id}
              and channel.kind = 'email'
              and channel.value in (${sql.join(
                emails.map((email) => sql`${email}`),
                sql`, `,
              )})
          )
          or exists (
            select 1 from party_contacts as contact
            where contact.party_id = ${parties.id}
              and contact.email in (${sql.join(
                emails.map((email) => sql`${email}`),
                sql`, `,
              )})
          )
        )`;
  const rows = await tx.db
    .select({
      id: parties.id,
      displayName: parties.displayName,
      legalName: parties.legalName,
      tradingName: parties.tradingName,
      vatNumber: parties.vatNumber,
    })
    .from(parties)
    .where(
      and(
        excludeId ? sql`${parties.id} <> ${excludeId}` : sql`true`,
        sql`(${nameClause} OR (${parties.vatNumber} = ${vat} AND ${vat} <> '') OR ${emailClause})`,
      ),
    );

  if (rows.length === 0) {
    return [];
  }
  const ids = rows.map((row) => row.id);
  const channelEmails = await tx.db
    .select({ partyId: partyChannels.partyId, value: partyChannels.value })
    .from(partyChannels)
    .where(and(inArray(partyChannels.partyId, ids), eq(partyChannels.kind, 'email')));
  const contactEmails = await tx.db
    .select({ partyId: partyContacts.partyId, email: partyContacts.email })
    .from(partyContacts)
    .where(inArray(partyContacts.partyId, ids));
  const emailByParty = new Map<string, Set<string>>();
  for (const channel of channelEmails) {
    const set = emailByParty.get(channel.partyId) ?? new Set<string>();
    set.add(channel.value);
    emailByParty.set(channel.partyId, set);
  }
  for (const contact of contactEmails) {
    if (!contact.email) {
      continue;
    }
    const set = emailByParty.get(contact.partyId) ?? new Set<string>();
    set.add(contact.email);
    emailByParty.set(contact.partyId, set);
  }

  return rows.map((row) => {
    const reasons: string[] = [];
    const known = [row.displayName, row.legalName, row.tradingName]
      .filter((name): name is string => Boolean(name))
      .map((name) => normalPartyName(name));
    if (names.some((name) => known.includes(name))) {
      reasons.push('name');
    }
    if (vat && row.vatNumber === vat) {
      reasons.push('vat');
    }
    const knownEmails = emailByParty.get(row.id) ?? new Set<string>();
    if (emails.some((email) => knownEmails.has(email))) {
      reasons.push('email');
    }
    return { id: row.id, displayName: row.displayName, reasons };
  });
}

function sensitiveNext(
  canViewIdentity: boolean,
  specified: boolean,
  incoming: string | null,
  existing: string | null,
): string | null {
  if (!canViewIdentity) {
    if (specified && incoming) {
      throw new HttpError(
        403,
        'forbidden',
        'Only the company owner can save an ID or passport number.',
      );
    }
    return existing;
  }
  if (!specified) {
    return existing;
  }
  return incoming;
}

async function replaceChildren(
  tx: TenantTransaction,
  partyId: string,
  draft: PartyDraft,
): Promise<void> {
  await tx.db.delete(partyChannels).where(eq(partyChannels.partyId, partyId));
  await tx.db.delete(partyContacts).where(eq(partyContacts.partyId, partyId));
  await tx.db.delete(partyAddresses).where(eq(partyAddresses.partyId, partyId));
  await tx.db.delete(partyRoles).where(eq(partyRoles.partyId, partyId));
  await tx.db.delete(partyTags).where(eq(partyTags.partyId, partyId));

  if (draft.roles.length > 0) {
    await tx.db.insert(partyRoles).values(
      draft.roles.map((role) => ({
        tenantId: tx.tenantId,
        partyId,
        role,
      })),
    );
  }
  if (draft.contacts.length > 0) {
    await tx.db.insert(partyContacts).values(
      draft.contacts.map((contact) => ({
        tenantId: tx.tenantId,
        partyId,
        name: contact.name,
        jobTitle: contact.jobTitle,
        email: contact.email,
        phone: contact.phone,
        isPrimary: contact.isPrimary,
      })),
    );
  }
  if (draft.addresses.length > 0) {
    await tx.db.insert(partyAddresses).values(
      draft.addresses.map((address) => ({
        tenantId: tx.tenantId,
        partyId,
        kind: address.kind,
        line1: address.line1,
        line2: address.line2,
        suburb: address.suburb,
        city: address.city,
        province: address.province,
        postalCode: address.postalCode,
        country: address.country,
        isPrimary: address.isPrimary,
      })),
    );
  }
  if (draft.channels.length > 0) {
    await tx.db.insert(partyChannels).values(
      draft.channels.map((channel) => ({
        tenantId: tx.tenantId,
        partyId,
        kind: channel.kind,
        value: channel.value,
        label: channel.label,
        isPrimary: channel.isPrimary,
      })),
    );
  }
  if (draft.tags.length > 0) {
    await tx.db.insert(partyTags).values(
      draft.tags.map((tag) => ({
        tenantId: tx.tenantId,
        partyId,
        tag,
      })),
    );
  }
}

async function addNote(
  tx: TenantTransaction,
  partyId: string,
  body: string | null,
  authorId: string,
): Promise<void> {
  if (!body) {
    return;
  }
  await tx.db.insert(partyNotes).values({
    tenantId: tx.tenantId,
    partyId,
    body,
    authorId,
  });
}

async function auditRoleAdds(
  tx: TenantTransaction,
  actor: Actor,
  partyId: string,
  added: PartyRole[],
): Promise<void> {
  if (added.includes('supplier')) {
    await assertSegregation(tx, {
      actorId: actor.userId,
      action: SUPPLIER_CREATE,
      entityId: partyId,
    });
  }
  if (added.includes('staff')) {
    await assertSegregation(tx, { actorId: actor.userId, action: STAFF_CREATE, entityId: partyId });
  }
  for (const role of added) {
    const action = role === 'supplier' ? SUPPLIER_CREATE : role === 'staff' ? STAFF_CREATE : null;
    if (!action) {
      continue;
    }
    await appendAuditEvent(tx, {
      action,
      entityType: 'party',
      entityId: partyId,
      actorId: actor.userId,
      beforeData: null,
      afterData: { role },
      requestIp: actor.requestIp,
      userAgent: actor.userAgent,
    });
  }
}

export async function listParties(
  tx: TenantTransaction,
  userId: string,
  query: { q?: string; role?: string; status?: string },
) {
  const access = await flags(tx, userId);
  const status = query.status === 'archived' || query.status === 'all' ? query.status : 'active';
  const role = query.role?.trim() ?? '';
  if (role && !['customer', 'supplier', 'staff', 'other'].includes(role)) {
    throw new HttpError(400, 'bad_request', 'Choose customer, supplier, staff, or other.');
  }
  const q = (query.q ?? '').trim().slice(0, 80);
  const pattern = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const filters = [
    status === 'all' ? sql`true` : sql`${parties.status} = ${status}`,
    role
      ? sql`exists (select 1 from party_roles as role_row where role_row.party_id = ${parties.id} and role_row.role = ${role})`
      : sql`true`,
    q
      ? sql`(
          ${parties.displayName} ilike ${pattern} escape '\\'
          or coalesce(${parties.tradingName}, '') ilike ${pattern} escape '\\'
          or coalesce(${parties.legalName}, '') ilike ${pattern} escape '\\'
          or coalesce(${parties.vatNumber}, '') ilike ${pattern} escape '\\'
          or exists (
            select 1 from party_channels as channel
            where channel.party_id = ${parties.id} and channel.value ilike ${pattern} escape '\\'
          )
          or exists (
            select 1 from party_contacts as contact
            where contact.party_id = ${parties.id}
              and (
                contact.name ilike ${pattern} escape '\\'
                or coalesce(contact.email, '') ilike ${pattern} escape '\\'
                or coalesce(contact.phone, '') ilike ${pattern} escape '\\'
              )
          )
          or exists (
            select 1 from party_tags as tag_row
            where tag_row.party_id = ${parties.id} and tag_row.tag ilike ${pattern} escape '\\'
          )
        )`
      : sql`true`,
  ];
  const rows = await tx.db
    .select()
    .from(parties)
    .where(and(...filters))
    .orderBy(asc(parties.displayName))
    .limit(200);

  const ids = rows.map((row) => row.id);
  const roles = ids.length
    ? await tx.db.select().from(partyRoles).where(inArray(partyRoles.partyId, ids))
    : [];
  const channels = ids.length
    ? await tx.db.select().from(partyChannels).where(inArray(partyChannels.partyId, ids))
    : [];
  const addresses = ids.length
    ? await tx.db.select().from(partyAddresses).where(inArray(partyAddresses.partyId, ids))
    : [];
  const contacts = ids.length
    ? await tx.db.select().from(partyContacts).where(inArray(partyContacts.partyId, ids))
    : [];

  const list = rows.map((party) => {
    const partyRolesHere = roles.filter((row) => row.partyId === party.id).map((row) => row.role);
    const partyChannels = channels.filter((row) => row.partyId === party.id);
    const email =
      partyChannels.find((row) => row.kind === 'email' && row.isPrimary)?.value ??
      partyChannels.find((row) => row.kind === 'email')?.value ??
      contacts.find((row) => row.partyId === party.id && row.email)?.email ??
      null;
    const phone =
      partyChannels.find((row) => row.kind === 'phone' && row.isPrimary)?.value ??
      partyChannels.find((row) => row.kind === 'phone')?.value ??
      contacts.find((row) => row.partyId === party.id && row.phone)?.phone ??
      null;
    const address =
      addresses.find((row) => row.partyId === party.id && row.isPrimary) ??
      addresses.find((row) => row.partyId === party.id);
    return {
      id: party.id,
      kind: party.kind,
      displayName: party.displayName,
      roles: partyRolesHere.sort(),
      status: party.status,
      email,
      phone,
      city: address?.city ?? null,
      updatedAt: iso(party.updatedAt),
    };
  });

  return { parties: list, ...access };
}

export async function getParty(tx: TenantTransaction, userId: string, id: string) {
  const access = await flags(tx, userId);
  const graph = await loadGraph(tx, id);
  if (!graph) {
    throw new HttpError(404, 'not_found', 'That contact was not found.');
  }
  return { party: present(graph, access.canViewIdentity), ...access };
}

export async function createParty(tx: TenantTransaction, actor: Actor, input: unknown) {
  const booksImport =
    !!input &&
    typeof input === 'object' &&
    (input as { booksImport?: unknown }).booksImport === true;
  let canViewIdentity = false;
  if (booksImport) {
    const allowed =
      (await hasPermission(tx, actor.userId, {
        scope: 'krn',
        action: 'operate',
        moduleId: 'KRN-02',
      })) ||
      (await hasPermission(tx, actor.userId, {
        scope: 'fin.ledger',
        action: 'post',
        moduleId: 'FIN-01',
      }));
    if (!allowed) {
      throw new HttpError(403, 'forbidden', 'Your role cannot add this contact.');
    }
  } else {
    canViewIdentity = await requireEdit(tx, actor.userId);
  }
  const draft = parsePartyDraft(input);
  const idNumber = sensitiveNext(canViewIdentity, draft.idNumberSpecified, draft.idNumber, null);
  const passportNumber = sensitiveNext(
    canViewIdentity,
    draft.passportNumberSpecified,
    draft.passportNumber,
    null,
  );
  if (!draft.confirmDuplicate) {
    const matches = await findDuplicates(tx, draft, null);
    if (matches.length > 0) {
      throw new DuplicatePartyError(matches);
    }
  }
  await ensureSod(tx, actor);
  const id = randomUUID();
  const added = draft.roles.filter((role) => role === 'supplier' || role === 'staff');
  await auditRoleAdds(tx, actor, id, added);
  const now = new Date();
  await tx.db.insert(parties).values({
    id,
    tenantId: tx.tenantId,
    kind: draft.kind,
    displayName: draft.displayName,
    legalName: draft.legalName,
    tradingName: draft.tradingName,
    givenName: draft.givenName,
    familyName: draft.familyName,
    registrationNumber: draft.registrationNumber,
    vatNumber: draft.vatNumber,
    idNumber,
    passportNumber,
    popiaConsent: draft.popiaConsent,
    popiaConsentAt: draft.popiaConsent ? now : null,
    status: 'active',
    archivedAt: null,
    createdBy: actor.userId,
    updatedAt: now,
  });
  await replaceChildren(tx, id, draft);
  await addNote(tx, id, draft.note, actor.userId);
  const graph = await loadGraph(tx, id);
  if (!graph) {
    throw new Error('Contact was not saved.');
  }
  await appendAuditEvent(tx, {
    action: 'party.created',
    entityType: 'party',
    entityId: id,
    actorId: actor.userId,
    beforeData: null,
    afterData: snapshot(graph),
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  return present(graph, canViewIdentity);
}

export async function updateParty(tx: TenantTransaction, actor: Actor, id: string, input: unknown) {
  const canViewIdentity = await requireEdit(tx, actor.userId);
  const existing = await loadGraph(tx, id);
  if (!existing) {
    throw new HttpError(404, 'not_found', 'That contact was not found.');
  }
  if (existing.party.status !== 'active') {
    throw new HttpError(409, 'archived', 'Restore this contact before editing it.');
  }
  const draft = parsePartyDraft(input);
  const idNumber = sensitiveNext(
    canViewIdentity,
    draft.idNumberSpecified,
    draft.idNumber,
    existing.party.idNumber,
  );
  const passportNumber = sensitiveNext(
    canViewIdentity,
    draft.passportNumberSpecified,
    draft.passportNumber,
    existing.party.passportNumber,
  );
  if (!draft.confirmDuplicate) {
    const matches = await findDuplicates(tx, draft, id);
    if (matches.length > 0) {
      throw new DuplicatePartyError(matches);
    }
  }
  await ensureSod(tx, actor);
  const added = draft.roles.filter(
    (role) => (role === 'supplier' || role === 'staff') && !existing.roles.includes(role),
  );
  await auditRoleAdds(tx, actor, id, added);
  const before = snapshot(existing);
  const consentAt = draft.popiaConsent ? (existing.party.popiaConsentAt ?? new Date()) : null;
  await tx.db
    .update(parties)
    .set({
      kind: draft.kind,
      displayName: draft.displayName,
      legalName: draft.legalName,
      tradingName: draft.tradingName,
      givenName: draft.givenName,
      familyName: draft.familyName,
      registrationNumber: draft.registrationNumber,
      vatNumber: draft.vatNumber,
      idNumber,
      passportNumber,
      popiaConsent: draft.popiaConsent,
      popiaConsentAt: consentAt,
      updatedAt: new Date(),
    })
    .where(eq(parties.id, id));
  await replaceChildren(tx, id, draft);
  await addNote(tx, id, draft.note, actor.userId);
  const graph = await loadGraph(tx, id);
  if (!graph) {
    throw new Error('Contact was not saved.');
  }
  await appendAuditEvent(tx, {
    action: 'party.updated',
    entityType: 'party',
    entityId: id,
    actorId: actor.userId,
    beforeData: before,
    afterData: snapshot(graph, {
      idNumberChanged: existing.party.idNumber !== idNumber,
      passportChanged: existing.party.passportNumber !== passportNumber,
    }),
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  return present(graph, canViewIdentity);
}

export async function addPartyNote(tx: TenantTransaction, actor: Actor, id: string, body: string) {
  const canViewIdentity = await requireEdit(tx, actor.userId);
  const existing = await loadGraph(tx, id);
  if (!existing) {
    throw new HttpError(404, 'not_found', 'That contact was not found.');
  }
  const note = body.trim().replace(/\s+/g, ' ');
  if (note.length < 1 || note.length > 2000) {
    throw new HttpError(400, 'bad_request', 'Enter a note of up to 2000 characters.');
  }
  const before = snapshot(existing);
  await addNote(tx, id, note, actor.userId);
  const graph = await loadGraph(tx, id);
  if (!graph) {
    throw new Error('Note was not saved.');
  }
  await appendAuditEvent(tx, {
    action: 'party.updated',
    entityType: 'party',
    entityId: id,
    actorId: actor.userId,
    beforeData: before,
    afterData: snapshot(graph),
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  return present(graph, canViewIdentity);
}

async function setStatus(
  tx: TenantTransaction,
  actor: Actor,
  id: string,
  status: 'active' | 'archived',
) {
  const canViewIdentity = await requireEdit(tx, actor.userId);
  const existing = await loadGraph(tx, id);
  if (!existing) {
    throw new HttpError(404, 'not_found', 'That contact was not found.');
  }
  if (existing.party.status === status) {
    return present(existing, canViewIdentity);
  }
  const before = snapshot(existing);
  const now = new Date();
  await tx.db
    .update(parties)
    .set({
      status,
      archivedAt: status === 'archived' ? now : null,
      updatedAt: now,
    })
    .where(eq(parties.id, id));
  const graph = await loadGraph(tx, id);
  if (!graph) {
    throw new Error('Contact was not saved.');
  }
  await appendAuditEvent(tx, {
    action: status === 'archived' ? 'party.archived' : 'party.restored',
    entityType: 'party',
    entityId: id,
    actorId: actor.userId,
    beforeData: before,
    afterData: snapshot(graph),
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  return present(graph, canViewIdentity);
}

export function archiveParty(tx: TenantTransaction, actor: Actor, id: string) {
  return setStatus(tx, actor, id, 'archived');
}

export function restoreParty(tx: TenantTransaction, actor: Actor, id: string) {
  return setStatus(tx, actor, id, 'active');
}
