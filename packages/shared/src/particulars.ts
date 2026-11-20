import { isIndustryPresetKey, type IndustryPresetKey } from './industry';

export class ParticularsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParticularsError';
  }
}

export type TenantParticulars = {
  companyName: string;
  slug: string;
  legalName: string | null;
  tradingName: string | null;
  registrationNumber: string | null;
  vatNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string;
  industryPreset: IndustryPresetKey;
};

function text(value: unknown, label: string, max: number, required: boolean): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new ParticularsError(`Enter ${label}.`);
    }
    return null;
  }
  if (typeof value !== 'string') {
    throw new ParticularsError(`Enter ${label}.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) {
      throw new ParticularsError(`Enter ${label}.`);
    }
    return null;
  }
  if (trimmed.length > max) {
    throw new ParticularsError(`${label} is too long.`);
  }
  return trimmed;
}

export function parseTenantParticulars(input: unknown): TenantParticulars {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ParticularsError('Enter the company details.');
  }
  const body = input as Record<string, unknown>;
  const companyName = text(body.companyName, 'the company name', 120, true);
  if (!companyName || companyName.length < 2) {
    throw new ParticularsError('Enter a company name of at least 2 characters.');
  }
  const slugRaw = text(body.slug, 'a company code', 63, true);
  const slug = slugRaw?.toLowerCase() ?? '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new ParticularsError(
      'The company code uses lowercase letters, numbers, and hyphens, such as north-wind.',
    );
  }
  const industry = typeof body.industryPreset === 'string' ? body.industryPreset : '';
  if (!isIndustryPresetKey(industry)) {
    throw new ParticularsError('Choose an industry preset.');
  }
  const contactEmail = text(body.contactEmail, 'a contact email', 200, false);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.toLowerCase())) {
    throw new ParticularsError('Enter a contact email such as hello@example.com.');
  }
  const contactPhone = text(body.contactPhone, 'a phone number', 30, false);
  if (contactPhone && !/^[0-9+() .-]{6,30}$/.test(contactPhone)) {
    throw new ParticularsError('Enter a phone number using digits, spaces, and +.');
  }
  const countryRaw = text(body.country, 'a country', 2, false) ?? 'ZA';
  const country = countryRaw.toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new ParticularsError('Country is a 2-letter code. ZA is South Africa.');
  }
  const registrationNumber = text(body.registrationNumber, 'a registration number', 32, false);
  if (registrationNumber && !/^[A-Za-z0-9/-]{2,32}$/.test(registrationNumber)) {
    throw new ParticularsError('Registration number uses letters, numbers, and slashes.');
  }
  const vatNumber = text(body.vatNumber, 'a VAT number', 20, false);
  if (vatNumber && !/^[A-Za-z0-9]{2,20}$/.test(vatNumber)) {
    throw new ParticularsError('VAT number uses letters and numbers only.');
  }
  return {
    companyName,
    slug,
    legalName: text(body.legalName, 'a legal name', 160, false),
    tradingName: text(body.tradingName, 'a trading name', 160, false),
    registrationNumber,
    vatNumber,
    contactEmail: contactEmail?.toLowerCase() ?? null,
    contactPhone,
    addressLine1: text(body.addressLine1, 'an address', 120, false),
    addressLine2: text(body.addressLine2, 'an address line', 120, false),
    city: text(body.city, 'a city', 80, false),
    province: text(body.province, 'a province', 80, false),
    postalCode: text(body.postalCode, 'a postal code', 16, false),
    country,
    industryPreset: industry,
  };
}
