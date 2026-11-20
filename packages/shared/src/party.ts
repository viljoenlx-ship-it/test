/**
 * KRN-02 party drafts. Pure checks shared by the API and the company app.
 * ID numbers are validated here. They are not encrypted; that is GOV-04.
 */

export const PARTY_KINDS = ['organisation', 'person'] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

export const PARTY_ROLES = ['customer', 'supplier', 'staff', 'other'] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export const PARTY_ROLE_LABELS: Record<PartyRole, string> = {
  customer: 'Customer',
  supplier: 'Supplier',
  staff: 'Staff',
  other: 'Other',
};

export const ADDRESS_KINDS = ['physical', 'postal', 'billing', 'delivery'] as const;
export type AddressKind = (typeof ADDRESS_KINDS)[number];

export const ADDRESS_KIND_LABELS: Record<AddressKind, string> = {
  physical: 'Physical',
  postal: 'Postal',
  billing: 'Billing',
  delivery: 'Delivery',
};

export const CHANNEL_KINDS = ['phone', 'email'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export const SA_PROVINCES = [
  'Eastern Cape',
  'Free State',
  'Gauteng',
  'KwaZulu-Natal',
  'Limpopo',
  'Mpumalanga',
  'North West',
  'Northern Cape',
  'Western Cape',
] as const;

export type PartyContactDraft = {
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
};

export type PartyAddressDraft = {
  kind: AddressKind;
  line1: string;
  line2: string | null;
  suburb: string | null;
  city: string;
  province: string | null;
  postalCode: string | null;
  country: string;
  isPrimary: boolean;
};

export type PartyChannelDraft = {
  kind: ChannelKind;
  value: string;
  label: string | null;
  isPrimary: boolean;
};

export type PartyDraft = {
  kind: PartyKind;
  displayName: string;
  legalName: string | null;
  tradingName: string | null;
  givenName: string | null;
  familyName: string | null;
  roles: PartyRole[];
  registrationNumber: string | null;
  vatNumber: string | null;
  idNumber: string | null;
  idNumberSpecified: boolean;
  passportNumber: string | null;
  passportNumberSpecified: boolean;
  popiaConsent: boolean;
  contacts: PartyContactDraft[];
  addresses: PartyAddressDraft[];
  channels: PartyChannelDraft[];
  tags: string[];
  note: string | null;
  confirmDuplicate: boolean;
};

export class PartyInputError extends Error {
  readonly fields: Record<string, string>;

  constructor(fields: Record<string, string>) {
    super(Object.values(fields)[0] ?? 'Check the contact details.');
    this.name = 'PartyInputError';
    this.fields = fields;
  }
}

export function partyFieldErrors(input: unknown): Record<string, string> {
  try {
    parsePartyDraft(input);
    return {};
  } catch (error) {
    if (error instanceof PartyInputError) {
      return error.fields;
    }
    throw error;
  }
}

/** South African ID: YYMMDD, citizenship 0 or 1, and the DHA check digit. */
export function isSouthAfricanIdNumber(value: string): boolean {
  if (!/^\d{13}$/.test(value)) {
    return false;
  }
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  if (month === 2 && day > 29) {
    return false;
  }
  if ((month === 4 || month === 6 || month === 9 || month === 11) && day > 30) {
    return false;
  }
  const citizenship = value[10];
  if (citizenship !== '0' && citizenship !== '1') {
    return false;
  }
  let odd = 0;
  let even = '';
  for (let index = 0; index < 12; index += 1) {
    const digit = value[index] ?? '';
    if (index % 2 === 0) {
      odd += Number(digit);
    } else {
      even += digit;
    }
  }
  const doubled = String(Number(even) * 2);
  let evenSum = 0;
  for (const char of doubled) {
    evenSum += Number(char);
  }
  const check = (10 - ((odd + evenSum) % 10)) % 10;
  return check === Number(value[12]);
}

export function normalPartyName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function tidy(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PartyInputError({ form: 'Enter the contact details.' });
  }
  return input as Record<string, unknown>;
}

function optionalText(
  fields: Record<string, string>,
  value: unknown,
  key: string,
  label: string,
  max: number,
): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    fields[key] = `Enter ${label}.`;
    return null;
  }
  const trimmed = tidy(value);
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > max) {
    fields[key] = `${label} is too long.`;
    return null;
  }
  return trimmed;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return /^[0-9+() .-]{6,30}$/.test(value) && digits.length >= 6 && digits.length <= 15;
}

function rowIsBlank(row: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => {
    const value = row[key];
    return (
      value === undefined || value === null || (typeof value === 'string' && tidy(value) === '')
    );
  });
}

function onePrimary<T extends { isPrimary: boolean }>(rows: T[]): T[] {
  if (rows.length === 0) {
    return rows;
  }
  const primary = rows.findIndex((row) => row.isPrimary);
  const index = primary === -1 ? 0 : primary;
  return rows.map((row, rowIndex) => ({ ...row, isPrimary: rowIndex === index }));
}

export function parsePartyDraft(input: unknown): PartyDraft {
  const body = asRecord(input);
  const fields: Record<string, string> = {};

  const kindRaw = body.kind;
  const kind: PartyKind | null =
    kindRaw === 'organisation' || kindRaw === 'person' ? kindRaw : null;
  if (!kind) {
    fields.kind = 'Choose organisation or person.';
  }

  const givenName = optionalText(fields, body.givenName, 'givenName', 'A first name', 80);
  const familyName = optionalText(fields, body.familyName, 'familyName', 'A last name', 80);
  let displayName = optionalText(fields, body.displayName, 'displayName', 'A name', 160) ?? '';
  if (kind === 'person' && !displayName && givenName && familyName) {
    displayName = `${givenName} ${familyName}`;
  }
  if (displayName.length > 0 && displayName.length < 2) {
    fields.displayName = 'Enter a name of at least 2 characters.';
  }
  if (!displayName) {
    fields.displayName =
      kind === 'person'
        ? 'Enter the name people will search for, or a first and last name.'
        : 'Enter the name people will search for.';
  }

  const legalName = optionalText(fields, body.legalName, 'legalName', 'A legal name', 160);
  const tradingName = optionalText(fields, body.tradingName, 'tradingName', 'A trading name', 160);

  if (kind === 'organisation' && (givenName || familyName)) {
    fields.givenName = 'An organisation does not use a first and last name.';
  }
  if (kind === 'person') {
    if (!givenName) {
      fields.givenName = 'Enter a first name.';
    }
    if (!familyName) {
      fields.familyName = 'Enter a last name.';
    }
  }

  const roles: PartyRole[] = [];
  if (!Array.isArray(body.roles) || body.roles.length === 0) {
    fields.roles = 'Choose at least one role. A contact can hold more than one.';
  } else {
    for (const role of body.roles) {
      if (typeof role !== 'string' || !(PARTY_ROLES as readonly string[]).includes(role)) {
        fields.roles = 'Choose customer, supplier, staff, or other.';
        break;
      }
      if (!roles.includes(role as PartyRole)) {
        roles.push(role as PartyRole);
      }
    }
  }

  const registrationNumber = optionalText(
    fields,
    body.registrationNumber,
    'registrationNumber',
    'A registration number',
    32,
  );
  if (registrationNumber && !/^[A-Za-z0-9/-]{2,32}$/.test(registrationNumber)) {
    fields.registrationNumber =
      'Use a registration number such as 2019/123456/07. Letters, numbers, and slashes only.';
  }
  if (kind === 'person' && registrationNumber) {
    fields.registrationNumber = 'A person does not have a company registration number.';
  }

  const vatRaw = optionalText(fields, body.vatNumber, 'vatNumber', 'A VAT number', 20);
  const vatNumber = vatRaw ? vatRaw.replace(/\s/g, '') : null;
  if (vatNumber && !/^4\d{9}$/.test(vatNumber)) {
    fields.vatNumber = 'A South African VAT number is 10 digits and starts with 4.';
  }

  const idSpecified = body.idNumber !== undefined && body.idNumber !== '••••';
  const passportSpecified = body.passportNumber !== undefined && body.passportNumber !== '••••';
  let idNumber = idSpecified
    ? optionalText(fields, body.idNumber, 'idNumber', 'An ID number', 13)
    : null;
  let passportNumber = passportSpecified
    ? optionalText(fields, body.passportNumber, 'passportNumber', 'A passport number', 12)
    : null;
  if (idNumber) {
    idNumber = idNumber.replace(/\s/g, '');
    if (!isSouthAfricanIdNumber(idNumber)) {
      fields.idNumber = 'Enter a 13-digit South African ID number.';
    }
  }
  if (passportNumber) {
    passportNumber = passportNumber.replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z0-9]{6,12}$/.test(passportNumber)) {
      fields.passportNumber = 'Enter a passport number of 6 to 12 letters and numbers.';
    }
  }
  if (kind === 'organisation' && (idNumber || passportNumber)) {
    fields.idNumber = 'Save an ID or passport on a person, not on an organisation.';
  }

  if (typeof body.popiaConsent !== 'boolean') {
    fields.popiaConsent = 'Say whether this contact agreed to us keeping their details.';
  }

  const contacts = parseContacts(body.contacts, fields);
  const addresses = parseAddresses(body.addresses, fields);
  const channels = parseChannels(body.channels, fields);
  const tags = parseTags(body.tags, fields);
  const note = optionalText(fields, body.note, 'note', 'A note', 2000);

  if (Object.keys(fields).length > 0 || !kind || !displayName) {
    throw new PartyInputError(fields);
  }

  return {
    kind,
    displayName,
    legalName,
    tradingName,
    givenName: kind === 'person' ? givenName : null,
    familyName: kind === 'person' ? familyName : null,
    roles,
    registrationNumber: kind === 'organisation' ? registrationNumber : null,
    vatNumber,
    idNumber: kind === 'person' ? idNumber : null,
    idNumberSpecified: idSpecified,
    passportNumber: kind === 'person' ? passportNumber : null,
    passportNumberSpecified: passportSpecified,
    popiaConsent: body.popiaConsent === true,
    contacts: onePrimary(contacts),
    addresses: onePrimary(addresses),
    channels: primaryChannels(channels),
    tags,
    note,
    confirmDuplicate: body.confirmDuplicate === true,
  };
}

function parseContacts(value: unknown, fields: Record<string, string>): PartyContactDraft[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    fields.contacts = 'Contacts must be a list.';
    return [];
  }
  if (value.length > 20) {
    fields.contacts = 'Add at most 20 people.';
    return [];
  }
  const contacts: PartyContactDraft[] = [];
  for (const [index, row] of value.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      fields[`contacts.${index}.name`] = 'Enter this person’s name.';
      continue;
    }
    const record = row as Record<string, unknown>;
    if (rowIsBlank(record, ['name', 'jobTitle', 'email', 'phone'])) {
      continue;
    }
    const name = optionalText(fields, record.name, `contacts.${index}.name`, 'A name', 120);
    if (!name || name.length < 2) {
      fields[`contacts.${index}.name`] = 'Enter this person’s name.';
    }
    const jobTitle = optionalText(
      fields,
      record.jobTitle,
      `contacts.${index}.jobTitle`,
      'A job title',
      80,
    );
    let email = optionalText(fields, record.email, `contacts.${index}.email`, 'An email', 200);
    if (email) {
      email = email.toLowerCase();
      if (!isEmail(email)) {
        fields[`contacts.${index}.email`] = 'Enter an email such as accounts@example.com.';
      }
    }
    const phone = optionalText(fields, record.phone, `contacts.${index}.phone`, 'A phone', 30);
    if (phone && !isPhone(phone)) {
      fields[`contacts.${index}.phone`] = 'Enter a phone number using digits, spaces, and +.';
    }
    if (name && name.length >= 2) {
      contacts.push({
        name,
        jobTitle,
        email,
        phone,
        isPrimary: record.isPrimary === true,
      });
    }
  }
  return contacts;
}

function parseAddresses(value: unknown, fields: Record<string, string>): PartyAddressDraft[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    fields.addresses = 'Addresses must be a list.';
    return [];
  }
  if (value.length > 10) {
    fields.addresses = 'Add at most 10 addresses.';
    return [];
  }
  const addresses: PartyAddressDraft[] = [];
  for (const [index, row] of value.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      fields[`addresses.${index}.line1`] = 'Enter an address.';
      continue;
    }
    const record = row as Record<string, unknown>;
    if (rowIsBlank(record, ['line1', 'line2', 'suburb', 'city', 'province', 'postalCode'])) {
      continue;
    }
    const prefix = `addresses.${index}`;
    const line1 = optionalText(fields, record.line1, `${prefix}.line1`, 'An address', 120);
    if (!line1) {
      fields[`${prefix}.line1`] = 'Enter the street address.';
    }
    const city = optionalText(fields, record.city, `${prefix}.city`, 'A city', 80);
    if (!city) {
      fields[`${prefix}.city`] = 'Enter a city.';
    }
    const countryRaw = optionalText(fields, record.country, `${prefix}.country`, 'A country', 2);
    const country = (countryRaw ?? 'ZA').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) {
      fields[`${prefix}.country`] = 'Country is a 2-letter code. ZA is South Africa.';
    }
    const province = optionalText(fields, record.province, `${prefix}.province`, 'A province', 80);
    if (country === 'ZA') {
      if (!province) {
        fields[`${prefix}.province`] = 'Choose a province.';
      } else if (!(SA_PROVINCES as readonly string[]).includes(province)) {
        fields[`${prefix}.province`] = 'Choose a South African province.';
      }
    }
    const postalCode = optionalText(
      fields,
      record.postalCode,
      `${prefix}.postalCode`,
      'A postal code',
      16,
    );
    if (country === 'ZA' && postalCode && !/^\d{4}$/.test(postalCode)) {
      fields[`${prefix}.postalCode`] = 'A South African postal code is 4 digits.';
    }
    if (country === 'ZA' && !postalCode) {
      fields[`${prefix}.postalCode`] = 'Enter a 4-digit postal code.';
    }
    const kindRaw = record.kind;
    const kind: AddressKind | null = (ADDRESS_KINDS as readonly string[]).includes(
      typeof kindRaw === 'string' ? kindRaw : '',
    )
      ? (kindRaw as AddressKind)
      : null;
    if (!kind) {
      fields[`${prefix}.kind`] = 'Choose physical, postal, billing, or delivery.';
    }
    if (line1 && city && kind && /^[A-Z]{2}$/.test(country)) {
      addresses.push({
        kind,
        line1,
        line2: optionalText(fields, record.line2, `${prefix}.line2`, 'An address line', 120),
        suburb: optionalText(fields, record.suburb, `${prefix}.suburb`, 'A suburb', 80),
        city,
        province,
        postalCode,
        country,
        isPrimary: record.isPrimary === true,
      });
    }
  }
  return addresses;
}

function parseChannels(value: unknown, fields: Record<string, string>): PartyChannelDraft[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    fields.channels = 'Phones and emails must be a list.';
    return [];
  }
  if (value.length > 20) {
    fields.channels = 'Add at most 20 phones and emails.';
    return [];
  }
  const channels: PartyChannelDraft[] = [];
  for (const [index, row] of value.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      fields[`channels.${index}.value`] = 'Enter a phone number or email.';
      continue;
    }
    const record = row as Record<string, unknown>;
    if (rowIsBlank(record, ['value', 'label'])) {
      continue;
    }
    const kindRaw = record.kind;
    const kind: ChannelKind | null = kindRaw === 'phone' || kindRaw === 'email' ? kindRaw : null;
    if (!kind) {
      fields[`channels.${index}.kind`] = 'Choose phone or email.';
      continue;
    }
    let entry = optionalText(fields, record.value, `channels.${index}.value`, 'A value', 200);
    if (!entry) {
      fields[`channels.${index}.value`] =
        kind === 'email' ? 'Enter an email address.' : 'Enter a phone number.';
      continue;
    }
    if (kind === 'email') {
      entry = entry.toLowerCase();
      if (!isEmail(entry)) {
        fields[`channels.${index}.value`] = 'Enter an email such as hello@example.com.';
      }
    } else if (!isPhone(entry)) {
      fields[`channels.${index}.value`] = 'Enter a phone number using digits, spaces, and +.';
    }
    const label = optionalText(fields, record.label, `channels.${index}.label`, 'A label', 40);
    channels.push({
      kind,
      value: entry,
      label,
      isPrimary: record.isPrimary === true,
    });
  }
  return channels;
}

function primaryChannels(channels: PartyChannelDraft[]): PartyChannelDraft[] {
  const next = channels.map((channel) => ({ ...channel }));
  for (const kind of CHANNEL_KINDS) {
    const indexes = next.flatMap((channel, index) => (channel.kind === kind ? [index] : []));
    if (indexes.length === 0) {
      continue;
    }
    const chosen = indexes.find((index) => next[index]?.isPrimary) ?? indexes[0];
    for (const index of indexes) {
      const channel = next[index];
      if (channel) {
        channel.isPrimary = index === chosen;
      }
    }
  }
  return next;
}

function parseTags(value: unknown, fields: Record<string, string>): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    fields.tags = 'Tags must be a list.';
    return [];
  }
  const tags: string[] = [];
  for (const tag of value) {
    if (typeof tag !== 'string') {
      fields.tags = 'Tags use letters, numbers, spaces, and hyphens.';
      continue;
    }
    const tidyTag = tidy(tag).toLowerCase();
    if (!tidyTag) {
      continue;
    }
    if (!/^[a-z0-9][a-z0-9 -]{0,31}$/.test(tidyTag)) {
      fields.tags = 'Tags use letters, numbers, spaces, and hyphens, up to 32 characters.';
      continue;
    }
    if (!tags.includes(tidyTag)) {
      tags.push(tidyTag);
    }
  }
  if (tags.length > 12) {
    fields.tags = 'Add at most 12 tags.';
  }
  return tags;
}
