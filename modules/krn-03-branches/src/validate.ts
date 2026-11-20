import { BranchRuleError, HttpError } from './http';

export type BranchInput = {
  name: string;
  code: string;
  legalEntityId: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  active: boolean;
};

export type EntityInput = {
  name: string;
  registrationNumber: string | null;
  vatNumber: string | null;
};

function text(value: unknown, label: string, max: number, required: boolean): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new HttpError(400, 'bad_request', `Enter a ${label}.`);
    }
    return null;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, 'bad_request', `Enter a ${label}.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) {
      throw new HttpError(400, 'bad_request', `Enter a ${label}.`);
    }
    return null;
  }
  if (trimmed.length > max) {
    throw new HttpError(400, 'bad_request', `${label} is too long.`);
  }
  return trimmed;
}

export function readBranchInput(body: Record<string, unknown>, partial = false): BranchInput {
  const name = text(body.name, 'branch name', 120, !partial || body.name !== undefined);
  const codeRaw = text(body.code, 'branch code', 16, !partial || body.code !== undefined);
  const code = codeRaw ? codeRaw.toUpperCase() : null;
  if (code && !/^[A-Z0-9][A-Z0-9-]{0,15}$/.test(code)) {
    throw new HttpError(
      400,
      'bad_request',
      'Use a short branch code such as HO or CPT. Letters, numbers, and hyphens only.',
    );
  }
  const email = text(body.contactEmail, 'contact email', 200, false);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'bad_request', 'Enter a contact email address.');
  }
  const countryRaw = text(body.country, 'country', 2, false) ?? 'ZA';
  const country = countryRaw.toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new HttpError(400, 'bad_request', 'Use a two-letter country code such as ZA.');
  }
  let legalEntityId: string | null = null;
  if (
    body.legalEntityId !== undefined &&
    body.legalEntityId !== null &&
    body.legalEntityId !== ''
  ) {
    if (typeof body.legalEntityId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.legalEntityId)) {
      throw new HttpError(400, 'bad_request', 'Choose a legal entity.');
    }
    legalEntityId = body.legalEntityId;
  }
  const active = body.active === undefined ? true : body.active === true;
  if (body.active !== undefined && typeof body.active !== 'boolean') {
    throw new HttpError(400, 'bad_request', 'Say whether the branch is active.');
  }
  if (!name || !code) {
    throw new HttpError(400, 'bad_request', 'Enter a branch name and code.');
  }
  return {
    name,
    code,
    legalEntityId,
    addressLine1: text(body.addressLine1, 'address', 160, false),
    addressLine2: text(body.addressLine2, 'address', 160, false),
    city: text(body.city, 'city', 80, false),
    province: text(body.province, 'province', 40, false),
    postalCode: text(body.postalCode, 'postal code', 12, false),
    country,
    contactName: text(body.contactName, 'contact name', 80, false),
    contactEmail: email ? email.toLowerCase() : null,
    contactPhone: text(body.contactPhone, 'phone number', 40, false),
    active,
  };
}

export function readEntityInput(body: Record<string, unknown>): EntityInput {
  const name = text(body.name, 'legal entity name', 160, true);
  if (!name) {
    throw new BranchRuleError('Enter the legal entity name.');
  }
  return {
    name,
    registrationNumber: text(body.registrationNumber, 'registration number', 40, false),
    vatNumber: text(body.vatNumber, 'VAT number', 40, false),
  };
}

export function readEnabled(body: Record<string, unknown>): boolean {
  if (typeof body.enabled !== 'boolean') {
    throw new HttpError(400, 'bad_request', 'Say whether more than one branch is allowed.');
  }
  return body.enabled;
}
