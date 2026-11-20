import { southAfricaPreset } from './preset';

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsValidationError';
  }
}

export type TenantSettings = {
  currencyCode: string;
  vatRateBasisPoints: number;
  timeZone: string;
  financialYearStartMonth: number;
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

let zoneSet: Set<string> | undefined;

function timeZones(): Set<string> {
  zoneSet ??= new Set(Intl.supportedValuesOf('timeZone'));
  return zoneSet;
}

export function presetTenantSettings(): TenantSettings {
  return {
    currencyCode: southAfricaPreset.currency,
    vatRateBasisPoints: southAfricaPreset.vatStandardRateBasisPoints,
    timeZone: southAfricaPreset.timeZone,
    financialYearStartMonth: southAfricaPreset.financialYearStartMonth,
  };
}

export function parseTenantSettings(input: unknown): TenantSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SettingsValidationError('Enter the company settings.');
  }
  const body = input as Record<string, unknown>;
  const currency =
    typeof body.currencyCode === 'string' ? body.currencyCode.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new SettingsValidationError('Currency must be a 3-letter code such as ZAR.');
  }

  const vat = body.vatRateBasisPoints;
  if (typeof vat !== 'number' || !Number.isInteger(vat) || vat < 0 || vat > 10_000) {
    throw new SettingsValidationError(
      'VAT rate must be a whole number of basis points from 0 to 10000. 1500 is 15%.',
    );
  }

  const timeZone = typeof body.timeZone === 'string' ? body.timeZone.trim() : '';
  if (!timeZones().has(timeZone)) {
    throw new SettingsValidationError('Choose a time zone such as Africa/Johannesburg.');
  }

  const month = body.financialYearStartMonth;
  if (typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new SettingsValidationError(
      'Financial year start must be a month from 1 to 12. 3 is March.',
    );
  }

  return {
    currencyCode: currency,
    vatRateBasisPoints: vat,
    timeZone,
    financialYearStartMonth: month,
  };
}

export function financialYearLabel(startMonth: number): string {
  const start = MONTHS[startMonth - 1] ?? 'March';
  const endIndex = startMonth === 1 ? 11 : startMonth - 2;
  const end = MONTHS[endIndex] ?? 'February';
  return `1 ${start} to the end of ${end}`;
}

export function vatPercentLabel(basisPoints: number): string {
  const percent = basisPoints / 100;
  const text = Number.isInteger(percent) ? String(percent) : percent.toFixed(2);
  return `${text}%`;
}
