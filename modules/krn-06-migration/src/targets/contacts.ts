import { sql } from 'drizzle-orm';
import { hasPermission } from '@omnivate/kernel';
import { SA_PROVINCES, type PartyRole } from '@omnivate/shared';
import type { ContactRecord, ContactWrite } from '../bridge/krn02-party';
import { asNumber, asRecord, rowsOf } from '../db';
import { parseEmail } from '../sa-format';
import { textValue, type ImportTarget, type RowValues } from '../target';

const ROLE_WORDS: Record<string, PartyRole[]> = {
  customer: ['customer'],
  client: ['customer'],
  supplier: ['supplier'],
  vendor: ['supplier'],
  staff: ['staff'],
  employee: ['staff'],
  other: ['other'],
  both: ['customer', 'supplier'],
  'customer and supplier': ['customer', 'supplier'],
};

type ContactIndex = {
  byEmail: Map<string, { id: string; label: string }>;
  byVat: Map<string, { id: string; label: string }>;
};

type Directory = typeof import('../bridge/krn02-party').krn02PartyDirectory;

function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function partyKindOf(raw: string): 'organisation' | 'person' | null {
  const value = raw.trim().toLowerCase();
  if (!value || value === 'organisation' || value === 'organization' || value === 'company') {
    return 'organisation';
  }
  if (value === 'person' || value === 'individual') {
    return 'person';
  }
  return null;
}

function parseRoles(raw: string): { roles: PartyRole[] } | { error: string } {
  const value = raw.trim().toLowerCase();
  if (!value) {
    return { roles: ['customer'] };
  }
  const roles = ROLE_WORDS[value];
  if (!roles) {
    return { error: 'Kind should be customer, supplier, both, staff, or other.' };
  }
  return { roles };
}

function parseConsent(raw: string): { value: boolean } | { error: string } {
  const value = raw.trim().toLowerCase();
  if (!value || value === 'no' || value === 'n' || value === 'false') {
    return { value: false };
  }
  if (value === 'yes' || value === 'y' || value === 'true') {
    return { value: true };
  }
  return { error: 'POPIA consent should be yes or no.' };
}

function draftFrom(values: RowValues): { draft: ContactWrite | null; errors: string[] } {
  const errors: string[] = [];
  const name = textValue(values, 'display_name');
  if (!name) {
    errors.push('Name is required.');
  } else if (name.length < 2) {
    errors.push('Name should be at least 2 characters.');
  } else if (name.length > 160) {
    errors.push('Name is too long.');
  }

  const kindRaw = textValue(values, 'party_kind');
  const kind = partyKindOf(kindRaw);
  if (kindRaw && !kind) {
    errors.push('Organisation or person should be organisation or person.');
  }
  const resolvedKind = kind ?? 'organisation';

  const rolesParsed = parseRoles(textValue(values, 'roles'));
  const roles: PartyRole[] = 'roles' in rolesParsed ? rolesParsed.roles : ['customer'];
  if ('error' in rolesParsed) {
    errors.push(rolesParsed.error);
  }

  let givenName = optional(textValue(values, 'given_name'));
  let familyName = optional(textValue(values, 'family_name'));
  if (resolvedKind === 'person' && name && (!givenName || !familyName)) {
    const parts = name.split(/\s+/);
    givenName = givenName ?? parts[0] ?? null;
    familyName = familyName ?? (parts.length > 1 ? parts.slice(1).join(' ') : null);
  }
  if (resolvedKind === 'person' && (!givenName || !familyName)) {
    errors.push('A person needs a first and last name.');
  }

  const emailRaw = textValue(values, 'email');
  let email: string | null = null;
  if (emailRaw) {
    const parsed = parseEmail(emailRaw);
    if (!parsed.ok) {
      errors.push(parsed.message);
    } else {
      email = parsed.value;
    }
  }

  const vatRaw = textValue(values, 'vat_number');
  let vatNumber: string | null = null;
  if (vatRaw) {
    const digits = vatRaw.replace(/[\s-]/g, '');
    if (!/^\d{10}$/.test(digits)) {
      errors.push('VAT number should be 10 digits.');
    } else if (!digits.startsWith('4')) {
      errors.push('A South African VAT number is 10 digits and starts with 4.');
    } else {
      vatNumber = digits;
    }
  }

  const phone = optional(textValue(values, 'phone'));
  if (phone && !/^[0-9+() .-]{6,30}$/.test(phone)) {
    errors.push('Enter a phone number using digits, spaces, and +.');
  }

  const line1 = optional(textValue(values, 'address_line'));
  const city = optional(textValue(values, 'city'));
  const province = optional(textValue(values, 'province'));
  const postal = optional(textValue(values, 'postal_code'));
  const addressStarted = Boolean(line1 || city || province || postal);
  let address: ContactWrite['address'] = null;
  if (addressStarted) {
    if (!line1) errors.push('Street address is required when you fill in an address.');
    if (!city) errors.push('City is required when you fill in an address.');
    if (!province || !(SA_PROVINCES as readonly string[]).includes(province)) {
      errors.push('Choose a South African province.');
    }
    if (!postal || !/^\d{4}$/.test(postal)) errors.push('Postal code should be 4 digits.');
    if (
      line1 &&
      city &&
      province &&
      postal &&
      /^\d{4}$/.test(postal) &&
      (SA_PROVINCES as readonly string[]).includes(province)
    ) {
      address = { line1, city, province, postalCode: postal };
    }
  }

  const consent = parseConsent(textValue(values, 'popia_consent'));
  if ('error' in consent) errors.push(consent.error);

  const legalName = optional(textValue(values, 'legal_name'));
  const notes = optional(textValue(values, 'notes'));
  if ((legalName && legalName.length > 160) || (notes && notes.length > 500)) {
    errors.push('One of the text fields is too long.');
  }

  if (errors.length > 0 || !name) return { draft: null, errors };

  return {
    draft: {
      displayName: name,
      legalName,
      kind: resolvedKind,
      roles,
      givenName: resolvedKind === 'person' ? givenName : null,
      familyName: resolvedKind === 'person' ? familyName : null,
      email,
      phone,
      vatNumber,
      address,
      notes,
      popiaConsent: 'value' in consent ? consent.value : false,
    },
    errors,
  };
}

function requireDraft(values: RowValues): ContactWrite {
  const parsed = draftFrom(values);
  if (!parsed.draft) throw new Error(parsed.errors[0] ?? 'This row is not valid.');
  return parsed.draft;
}

function indexFrom(rows: ContactRecord[]): ContactIndex {
  const byEmail = new Map<string, { id: string; label: string }>();
  const byVat = new Map<string, { id: string; label: string }>();
  for (const row of rows) {
    if (row.email) byEmail.set(row.email.toLowerCase(), { id: row.id, label: row.displayName });
    if (row.vatNumber) byVat.set(row.vatNumber, { id: row.id, label: row.displayName });
  }
  return { byEmail, byVat };
}

function asIndex(index: unknown): ContactIndex {
  return index as ContactIndex;
}

export function createContactsTarget(directory: Directory): ImportTarget {
  return {
    id: 'contacts',
    moduleId: 'KRN-02',
    label: 'Contacts',
    summary: 'Customers and suppliers. One row per person or company.',
    needsVatChoice: false,
    denial: 'Only the company owner can import contacts.',
    fields: [
      {
        key: 'display_name',
        label: 'Name',
        required: true,
        kind: 'text',
        hint: 'The name you use for this contact.',
        aliases: ['contact', 'contact name', 'party', 'party name', 'company', 'company name'],
      },
      {
        key: 'party_kind',
        label: 'Organisation Or Person',
        required: false,
        kind: 'text',
        hint: 'Organisation or person. Blank means organisation.',
        aliases: ['party kind', 'entity type'],
      },
      {
        key: 'roles',
        label: 'Kind',
        required: false,
        kind: 'text',
        hint: 'Customer, supplier, both, staff, or other. Blank means customer.',
        aliases: ['type', 'role', 'party type', 'kind'],
      },
      {
        key: 'given_name',
        label: 'First Name',
        required: false,
        kind: 'text',
        hint: 'For a person, if the name is not already First Last.',
        aliases: ['given name', 'firstname'],
      },
      {
        key: 'family_name',
        label: 'Last Name',
        required: false,
        kind: 'text',
        hint: 'For a person, if the name is not already First Last.',
        aliases: ['family name', 'surname', 'lastname'],
      },
      {
        key: 'legal_name',
        label: 'Legal Name',
        required: false,
        kind: 'text',
        hint: 'Registered name, if it differs.',
        aliases: ['registered name', 'legal'],
      },
      {
        key: 'email',
        label: 'Email',
        required: false,
        kind: 'email',
        hint: 'Used to spot duplicates.',
        aliases: ['e-mail', 'email address'],
      },
      {
        key: 'phone',
        label: 'Phone',
        required: false,
        kind: 'phone',
        hint: 'Include the area code.',
        aliases: ['telephone', 'mobile', 'cell', 'tel'],
      },
      {
        key: 'vat_number',
        label: 'VAT Number',
        required: false,
        kind: 'vat',
        hint: '10 digits starting with 4, if they are VAT registered.',
        aliases: ['vat', 'vat no', 'tax number', 'tax no', 'tax ref'],
      },
      {
        key: 'address_line',
        label: 'Street Address',
        required: false,
        kind: 'text',
        hint: 'Also fill in city, province, and postal code.',
        aliases: ['address', 'street', 'address line 1'],
      },
      {
        key: 'city',
        label: 'City',
        required: false,
        kind: 'text',
        hint: 'Town or city.',
        aliases: ['town'],
      },
      {
        key: 'province',
        label: 'Province',
        required: false,
        kind: 'text',
        hint: 'A South African province, such as Western Cape.',
        aliases: ['state'],
      },
      {
        key: 'postal_code',
        label: 'Postal Code',
        required: false,
        kind: 'text',
        hint: '4 digits.',
        aliases: ['post code', 'postcode', 'zip', 'zip code'],
      },
      {
        key: 'popia_consent',
        label: 'POPIA Consent',
        required: false,
        kind: 'text',
        hint: 'Yes or no. Blank means no.',
        aliases: ['consent', 'popia'],
      },
      {
        key: 'notes',
        label: 'Notes',
        required: false,
        kind: 'text',
        hint: 'Anything else you want to keep.',
        aliases: ['comment', 'comments'],
      },
    ],
    async allowUser(tx, userId) {
      return hasPermission(tx, userId, { scope: 'krn', action: 'admin', moduleId: 'KRN-06' });
    },
    validate(values) {
      return draftFrom(values).errors;
    },
    contextIssues() {
      return [];
    },
    async loadIndex(tx) {
      return indexFrom(await directory.listActive(tx));
    },
    matchExisting(index, values) {
      const draft = draftFrom(values).draft;
      if (!draft) return null;
      const book = asIndex(index);
      if (draft.email) {
        const hit = book.byEmail.get(draft.email);
        if (hit)
          return { ...hit, message: `A contact with this email already exists (${hit.label}).` };
      }
      if (draft.vatNumber) {
        const hit = book.byVat.get(draft.vatNumber);
        if (hit)
          return {
            ...hit,
            message: `A contact with this VAT number already exists (${hit.label}).`,
          };
      }
      return null;
    },
    fileKeys(values) {
      const draft = draftFrom(values).draft;
      if (!draft) return [];
      const keys = [];
      if (draft.email)
        keys.push({
          kind: 'email',
          key: draft.email,
          message: (otherRow: number) => `This email is also on row ${otherRow}.`,
        });
      if (draft.vatNumber)
        keys.push({
          kind: 'vat',
          key: draft.vatNumber,
          message: (otherRow: number) => `This VAT number is also on row ${otherRow}.`,
        });
      return keys;
    },
    async findExisting(tx, values) {
      const draft = requireDraft(values);
      const book = indexFrom(await directory.listActive(tx));
      return (
        (draft.email ? book.byEmail.get(draft.email) : undefined) ??
        (draft.vatNumber ? book.byVat.get(draft.vatNumber) : undefined) ??
        null
      );
    },
    async createMany(tx, _batchId, rows, options) {
      const applied = [];
      for (const row of rows) {
        const created = await directory.create(tx, options.actor, requireDraft(row.values));
        applied.push({
          recordId: created.id,
          generationAfter: 1,
          movementCountAfter: 0,
          beforeData: { updatedAt: created.updatedAt, restore: null },
          deltaQuantityMilli: 0n,
          deltaValueCents: 0n,
        });
      }
      return applied;
    },
    async updateOne(tx, _batchId, recordId, values, options) {
      const current = (await directory.listActive(tx)).find((row) => row.id === recordId);
      if (!current) throw new Error('That contact was not found.');
      const written = await directory.update(tx, options.actor, recordId, requireDraft(values));
      return {
        recordId,
        generationAfter: 2,
        movementCountAfter: 0,
        beforeData: { updatedAt: written.updatedAt, restore: recordToWrite(current) },
        deltaQuantityMilli: 0n,
        deltaValueCents: 0n,
      };
    },
    async touchedRowNumbers(tx, batchId) {
      const stored = await rowsOf<{
        rowNumber: number;
        recordId: string | null;
        beforeData: unknown;
      }>(
        tx,
        sql`SELECT row_number AS "rowNumber", record_id AS "recordId", before_data AS "beforeData"
            FROM krn06_import_rows
            WHERE batch_id = ${batchId}::uuid AND status IN ('created', 'updated')
            ORDER BY row_number`,
      );
      const ids = stored.map((row) => row.recordId).filter((id): id is string => Boolean(id));
      const stamps = await directory.stamps(tx, ids);
      const touched: number[] = [];
      for (const row of stored) {
        const saved = asRecord(row.beforeData);
        const stamp = row.recordId ? stamps.get(row.recordId) : undefined;
        const same = stamp && stamp.updatedAt === saved.updatedAt && stamp.status === 'active';
        if (!same) touched.push(asNumber(row.rowNumber));
        if (touched.length >= 8) break;
      }
      return touched;
    },
    async undo(tx, _batchId, rows, actor) {
      const updates = rows
        .filter((row) => row.status === 'updated')
        .sort((left, right) => right.rowNumber - left.rowNumber);
      for (const row of updates) {
        const restore = asRestore(row.beforeData);
        if (!restore)
          throw new Error('This import cannot be undone because the previous contact is missing.');
        await directory.update(tx, actor, row.recordId, restore);
      }
      for (const row of rows.filter((item) => item.status === 'created')) {
        await directory.archive(tx, actor, row.recordId);
      }
    },
    async exportTable(tx) {
      const parties = await directory.listActive(tx);
      return [
        [
          'Name',
          'Organisation or person',
          'Kind',
          'Legal name',
          'Email',
          'Phone',
          'VAT number',
          'City',
        ],
        ...parties.map((party) => [
          party.displayName,
          party.kind,
          party.roles.join(', '),
          party.legalName ?? '',
          party.email ?? '',
          party.phone ?? '',
          party.vatNumber ?? '',
          party.city ?? '',
        ]),
      ];
    },
  };
}

function recordToWrite(row: ContactRecord): ContactWrite {
  return {
    displayName: row.displayName,
    legalName: row.legalName,
    kind: row.kind === 'person' ? 'person' : 'organisation',
    roles: (row.roles.length > 0 ? row.roles : ['customer']) as PartyRole[],
    givenName: row.givenName,
    familyName: row.familyName,
    email: row.email,
    phone: row.phone,
    vatNumber: row.vatNumber,
    address: null,
    notes: null,
    popiaConsent: row.popiaConsent,
  };
}

function asRestore(value: Record<string, unknown> | null): ContactWrite | null {
  const restore = value?.restore;
  if (!restore || typeof restore !== 'object') return null;
  return restore as ContactWrite;
}
