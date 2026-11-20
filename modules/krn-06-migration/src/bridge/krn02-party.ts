import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '@omnivate/kernel';
import {
  archiveParty,
  createParty,
  getParty,
  listPartiesForImport,
  partyImportStamps,
  updateParty,
  type PartyImportRow,
} from '@omnivate/module-krn-02';
import type { PartyRole } from '@omnivate/shared';
import type { ImportActorContext } from '../target';

export type ContactWrite = {
  displayName: string;
  legalName: string | null;
  kind: 'organisation' | 'person';
  roles: PartyRole[];
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  phone: string | null;
  vatNumber: string | null;
  address: {
    line1: string;
    city: string;
    province: string;
    postalCode: string;
  } | null;
  notes: string | null;
  popiaConsent: boolean;
};

export type ContactRecord = PartyImportRow;

/**
 * KRN-02 adapter. register-contacts.ts is the only file that chooses this object.
 */
export const krn02PartyDirectory = {
  async listActive(tx: TenantTransaction): Promise<ContactRecord[]> {
    const rows = await listPartiesForImport(tx);
    return rows.filter((row) => row.status === 'active');
  },

  async stamps(tx: TenantTransaction, ids: string[]) {
    const rows = await partyImportStamps(tx, ids);
    return new Map(rows.map((row) => [row.id, row]));
  },

  async create(tx: TenantTransaction, actor: ImportActorContext, draft: ContactWrite) {
    const userId = await actingUserId(tx, actor.userId);
    const party = await createParty(tx, actorFor(userId, actor), toInput(draft));
    return { id: party.id, updatedAt: party.updatedAt ?? new Date().toISOString() };
  },

  async update(tx: TenantTransaction, actor: ImportActorContext, id: string, draft: ContactWrite) {
    const userId = await actingUserId(tx, actor.userId);
    const party = await updateParty(tx, actorFor(userId, actor), id, toInput(draft));
    return { updatedAt: party.updatedAt ?? new Date().toISOString() };
  },

  async archive(tx: TenantTransaction, actor: ImportActorContext, id: string) {
    const userId = await actingUserId(tx, actor.userId);
    await archiveParty(tx, actorFor(userId, actor), id);
  },

  async present(tx: TenantTransaction, actor: ImportActorContext, id: string) {
    const userId = await actingUserId(tx, actor.userId);
    const result = await getParty(tx, userId, id);
    return result.party;
  },
};

function actorFor(userId: string, actor: ImportActorContext) {
  return {
    userId,
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  };
}

async function actingUserId(tx: TenantTransaction, userId: string | null): Promise<string> {
  if (userId) {
    return userId;
  }
  const result = await tx.db.execute<{ id: string }>(sql`
    SELECT ur.user_id AS id
    FROM user_roles AS ur
    INNER JOIN roles AS r ON r.id = ur.role_id
    INNER JOIN memberships AS m ON m.user_id = ur.user_id AND m.tenant_id = ur.tenant_id
    WHERE r.key = 'tenant_owner' AND m.status = 'active'
    LIMIT 1
  `);
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error('This company needs an owner before contacts can be imported.');
  }
  return id;
}

function toInput(draft: ContactWrite) {
  const channels = [
    ...(draft.email
      ? [{ kind: 'email' as const, value: draft.email, label: null, isPrimary: true }]
      : []),
    ...(draft.phone
      ? [{ kind: 'phone' as const, value: draft.phone, label: null, isPrimary: true }]
      : []),
  ];
  return {
    kind: draft.kind,
    displayName: draft.displayName,
    legalName: draft.legalName,
    roles: draft.roles,
    givenName: draft.givenName,
    familyName: draft.familyName,
    vatNumber: draft.vatNumber,
    popiaConsent: draft.popiaConsent,
    channels,
    addresses: draft.address
      ? [
          {
            kind: 'physical',
            line1: draft.address.line1,
            city: draft.address.city,
            province: draft.address.province,
            postalCode: draft.address.postalCode,
            country: 'ZA',
            isPrimary: true,
          },
        ]
      : [],
    contacts: [],
    tags: [],
    note: draft.notes,
    confirmDuplicate: true,
  };
}
