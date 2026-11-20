export type MfaEnforcement = 'on' | 'off';

/** Logged once at process start when the preview switch is off. */
export const MFA_OFF_WARNING =
  'MFA_ENFORCEMENT is off. Two-step sign-in is switched off for company staff and platform operators. Existing authenticator secrets are left in place. Set MFA_ENFORCEMENT=on before real client data.';

/**
 * `MFA_ENFORCEMENT` is `on` or `off`. A missing or blank value stays `on`,
 * so a production process that never sets the variable still asks for a code.
 * Any other value is a mistake and stops the process rather than guessing.
 */
export function mfaEnforcement(source: NodeJS.ProcessEnv = process.env): MfaEnforcement {
  const raw = source.MFA_ENFORCEMENT;
  if (raw === undefined || raw === '') {
    return 'on';
  }
  if (raw === 'on' || raw === 'off') {
    return raw;
  }
  throw new Error("MFA_ENFORCEMENT must be 'on' or 'off'.");
}
