export type PartyRole = 'customer' | 'supplier' | 'staff' | 'other';

export type PartySummary = {
  id: string;
  kind: string;
  displayName: string;
  roles: PartyRole[];
  status: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  updatedAt: string | null;
};

export type PartyContact = {
  id: string;
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
};

export type PartyAddress = {
  id: string;
  kind: string;
  line1: string;
  line2: string | null;
  suburb: string | null;
  city: string;
  province: string | null;
  postalCode: string | null;
  country: string;
  isPrimary: boolean;
};

export type PartyChannel = {
  id: string;
  kind: string;
  value: string;
  label: string | null;
  isPrimary: boolean;
};

export type PartyNote = {
  id: string;
  body: string;
  createdAt: string | null;
};

export type PartyDetail = {
  id: string;
  kind: 'organisation' | 'person';
  displayName: string;
  legalName: string | null;
  tradingName: string | null;
  givenName: string | null;
  familyName: string | null;
  roles: PartyRole[];
  registrationNumber: string | null;
  vatNumber: string | null;
  idNumber: string | null;
  passportNumber: string | null;
  identityVisible: boolean;
  popiaConsent: boolean;
  popiaConsentAt: string | null;
  status: string;
  contacts: PartyContact[];
  addresses: PartyAddress[];
  channels: PartyChannel[];
  tags: string[];
  notes: PartyNote[];
};

export type AccessFlags = {
  canEdit: boolean;
  canViewIdentity: boolean;
};

export function roleLabel(role: string): string {
  if (role === 'customer') return 'Customer';
  if (role === 'supplier') return 'Supplier';
  if (role === 'staff') return 'Staff';
  return 'Other';
}

export function whenLabel(value: string | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Johannesburg',
  }).format(new Date(value));
}
