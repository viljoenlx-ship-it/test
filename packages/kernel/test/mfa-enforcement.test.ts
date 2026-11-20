import { describe, expect, it } from 'vitest';
import { mfaEnforcement } from '../src/mfa-enforcement';

describe('MFA_ENFORCEMENT', () => {
  it('defaults to on when the variable is missing or blank', () => {
    expect(mfaEnforcement({})).toBe('on');
    expect(mfaEnforcement({ MFA_ENFORCEMENT: '' })).toBe('on');
  });

  it('accepts on and off', () => {
    expect(mfaEnforcement({ MFA_ENFORCEMENT: 'on' })).toBe('on');
    expect(mfaEnforcement({ MFA_ENFORCEMENT: 'off' })).toBe('off');
  });

  it('rejects any other value', () => {
    expect(() => mfaEnforcement({ MFA_ENFORCEMENT: 'false' })).toThrow(/MFA_ENFORCEMENT/);
    expect(() => mfaEnforcement({ MFA_ENFORCEMENT: 'OFF' })).toThrow(/MFA_ENFORCEMENT/);
  });
});
