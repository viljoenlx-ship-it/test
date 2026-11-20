import { Secret, TOTP } from 'otpauth';

function totpFor(secret: string, label: string): TOTP {
  return new TOTP({
    issuer: 'Omnivate Control',
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
}

export function createTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function totpUri(email: string, secret: string): string {
  return totpFor(secret, email).toString();
}

export function verifyTotp(secret: string, token: string): boolean {
  const delta = totpFor(secret, 'Omnivate Control').validate({
    token: token.replace(/\s/g, ''),
    window: 1,
  });
  return delta !== null;
}

export function generateTotp(secret: string): string {
  return totpFor(secret, 'Omnivate Control').generate();
}
