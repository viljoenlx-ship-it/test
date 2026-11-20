import { southAfricaPreset } from './preset';

export const HEALTH_SERVICE = 'omnivate-api' as const;

export type HealthResponse = {
  status: 'ok' | 'degraded';
  service: typeof HEALTH_SERVICE;
  database: 'up' | 'down';
  currency: typeof southAfricaPreset.currency;
  timeZone: typeof southAfricaPreset.timeZone;
  vatStandardRateBasisPoints: typeof southAfricaPreset.vatStandardRateBasisPoints;
};

export function isHealthResponse(value: unknown): value is HealthResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    (record.status === 'ok' || record.status === 'degraded') &&
    record.service === HEALTH_SERVICE &&
    (record.database === 'up' || record.database === 'down') &&
    record.currency === southAfricaPreset.currency &&
    record.timeZone === southAfricaPreset.timeZone &&
    record.vatStandardRateBasisPoints === southAfricaPreset.vatStandardRateBasisPoints
  );
}
