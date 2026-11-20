import { describe, expect, it } from 'vitest';
import {
  isSouthAfricanIdNumber,
  parsePartyDraft,
  partyFieldErrors,
  PartyInputError,
} from '../src/party';

const organisation = {
  kind: 'organisation',
  displayName: 'Cedar Kite Grocers',
  roles: ['customer'],
  popiaConsent: true,
  vatNumber: '4991001001',
  registrationNumber: '2018/445566/07',
  channels: [
    { kind: 'email', value: 'Accounts@CedarKite.example', label: 'Accounts', isPrimary: true },
  ],
  addresses: [
    {
      kind: 'physical',
      line1: '14 Kite Street',
      city: 'Cape Town',
      province: 'Western Cape',
      postalCode: '7925',
      country: 'za',
      isPrimary: true,
    },
  ],
  tags: ['Retail', 'retail'],
};

describe('party drafts', () => {
  it('accepts the published South African ID check examples used by the demo', () => {
    expect(isSouthAfricanIdNumber('8001015009087')).toBe(true);
    expect(isSouthAfricanIdNumber('9204144800082')).toBe(true);
    expect(isSouthAfricanIdNumber('8807235678083')).toBe(true);
    expect(isSouthAfricanIdNumber('8505120123088')).toBe(true);
    expect(isSouthAfricanIdNumber('9204144800083')).toBe(false);
    expect(isSouthAfricanIdNumber('123')).toBe(false);
  });

  it('normalises a South African organisation and reports inline errors', () => {
    const parsed = parsePartyDraft(organisation);
    expect(parsed.displayName).toBe('Cedar Kite Grocers');
    expect(parsed.channels[0]?.value).toBe('accounts@cedarkite.example');
    expect(parsed.addresses[0]?.country).toBe('ZA');
    expect(parsed.tags).toEqual(['retail']);

    const errors = partyFieldErrors({
      ...organisation,
      displayName: '',
      vatNumber: '123',
      roles: [],
    });
    expect(errors.displayName).toMatch(/name/i);
    expect(errors.vatNumber).toMatch(/10 digits/);
    expect(errors.roles).toMatch(/role/i);
    expect(() => parsePartyDraft({ kind: 'nope' })).toThrow(PartyInputError);
  });

  it('keeps an ID on a person and refuses it on an organisation', () => {
    const person = parsePartyDraft({
      kind: 'person',
      givenName: 'Lindiwe',
      familyName: 'Jacobs',
      roles: ['staff'],
      popiaConsent: false,
      idNumber: '9204144800082',
    });
    expect(person.displayName).toBe('Lindiwe Jacobs');
    expect(person.idNumber).toBe('9204144800082');
    expect(person.popiaConsent).toBe(false);

    const errors = partyFieldErrors({
      ...organisation,
      idNumber: '9204144800082',
    });
    expect(errors.idNumber).toMatch(/person/i);
  });
});
