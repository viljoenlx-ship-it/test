/**
 * Platform default for a South African tenant (blueprint tab 9).
 * Tenant-level overrides arrive with the settings work in later modules.
 * The database stores timestamps in UTC; this timezone is for display and
 * fiscal clocks, not for changing PostgreSQL's timezone.
 */
export const southAfricaPreset = {
  id: 'za-default',
  country: 'ZA',
  locale: 'en-ZA',
  currency: 'ZAR',
  vatStandardRateBasisPoints: 1500,
  vatStandardRateLabel: '15%',
  timeZone: 'Africa/Johannesburg',
  accountingBasis: 'accrual',
  financialYearStartMonth: 3,
  financialYearLabel: '1 March to 28/29 February',
  costingMethod: 'weighted_average',
} as const;

export type SouthAfricaPreset = typeof southAfricaPreset;
