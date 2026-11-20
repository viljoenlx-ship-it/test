import { describe, expect, it } from 'vitest';
import { contrastRatio, FALLBACK_BRAND, brandPresentation } from '../src/colour';
import { industryActivationPlan } from '../src/industry';
import { platformAllows } from '../src/platform';
import {
  parseTenantSettings,
  presetTenantSettings,
  SettingsValidationError,
} from '../src/settings';

describe('platform catalog', () => {
  it('keeps support from changing a company', () => {
    expect(platformAllows(['platform_support'], 'tenants.read')).toBe(true);
    expect(platformAllows(['platform_support'], 'tenants.write')).toBe(false);
    expect(platformAllows(['platform_owner'], 'tenants.write')).toBe(true);
    expect(platformAllows(['tenant_owner'], 'tenants.read')).toBe(false);
  });

  it('pulls hard prerequisites when a services preset omits stock', () => {
    const plan = industryActivationPlan('professional_services');
    expect(plan.pulledIn).toContain('SCM-01');
    expect(plan.sequence[0]).toBe('KRN-01');
  });

  it('accepts the South Africa preset and rejects a bad VAT rate', () => {
    expect(parseTenantSettings(presetTenantSettings())).toEqual(presetTenantSettings());
    expect(() =>
      parseTenantSettings({ ...presetTenantSettings(), vatRateBasisPoints: 15000 }),
    ).toThrow(SettingsValidationError);
    expect(() => parseTenantSettings({ ...presetTenantSettings(), timeZone: 'Not/AZone' })).toThrow(
      /time zone/i,
    );
    expect(() =>
      parseTenantSettings({ ...presetTenantSettings(), financialYearStartMonth: 13 }),
    ).toThrow(/month/i);
  });

  it('keeps a light brand colour off the text', () => {
    expect(contrastRatio('#111827')).toBeGreaterThan(4.5);
    const pale = brandPresentation('#fde68a', '#99f6e4');
    expect(pale.mark).toBe('#fde68a');
    expect(pale.text).toBe(FALLBACK_BRAND);
  });
});
