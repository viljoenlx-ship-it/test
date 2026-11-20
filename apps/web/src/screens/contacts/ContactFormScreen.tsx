import {
  ADDRESS_KIND_LABELS,
  ADDRESS_KINDS,
  PARTY_ROLE_LABELS,
  PARTY_ROLES,
  SA_PROVINCES,
  partyFieldErrors,
  type PartyRole,
} from '@omnivate/shared';
import {
  Button,
  Card,
  CheckField,
  EmptyState,
  Form,
  PageHeader,
  SelectField,
  Skeleton,
  TextAreaField,
  TextField,
  useToast,
} from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api, errorMessage, type Navigate } from '../../api';
import type { PartyDetail } from './types';

type ContactRow = {
  name: string;
  jobTitle: string;
  email: string;
  phone: string;
  isPrimary: boolean;
};
type AddressRow = {
  kind: string;
  line1: string;
  line2: string;
  suburb: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  isPrimary: boolean;
};
type ChannelRow = { kind: 'phone' | 'email'; value: string; label: string; isPrimary: boolean };

type FormState = {
  kind: 'organisation' | 'person';
  displayName: string;
  legalName: string;
  tradingName: string;
  givenName: string;
  familyName: string;
  roles: PartyRole[];
  registrationNumber: string;
  vatNumber: string;
  idNumber: string;
  passportNumber: string;
  popiaConsent: boolean;
  contacts: ContactRow[];
  addresses: AddressRow[];
  channels: ChannelRow[];
  tags: string;
  note: string;
  confirmDuplicate: boolean;
};

type Match = { id: string; displayName: string; reasons: string[] };

const emptyContact = (): ContactRow => ({
  name: '',
  jobTitle: '',
  email: '',
  phone: '',
  isPrimary: true,
});
const emptyAddress = (): AddressRow => ({
  kind: 'physical',
  line1: '',
  line2: '',
  suburb: '',
  city: '',
  province: '',
  postalCode: '',
  country: 'ZA',
  isPrimary: true,
});
const emptyChannel = (): ChannelRow => ({ kind: 'email', value: '', label: '', isPrimary: true });

function blankForm(): FormState {
  return {
    kind: 'organisation',
    displayName: '',
    legalName: '',
    tradingName: '',
    givenName: '',
    familyName: '',
    roles: ['customer'],
    registrationNumber: '',
    vatNumber: '',
    idNumber: '',
    passportNumber: '',
    popiaConsent: false,
    contacts: [emptyContact()],
    addresses: [emptyAddress()],
    channels: [emptyChannel()],
    tags: '',
    note: '',
    confirmDuplicate: false,
  };
}

function fromParty(party: PartyDetail): FormState {
  return {
    kind: party.kind,
    displayName: party.displayName,
    legalName: party.legalName ?? '',
    tradingName: party.tradingName ?? '',
    givenName: party.givenName ?? '',
    familyName: party.familyName ?? '',
    roles: party.roles.length > 0 ? party.roles : ['customer'],
    registrationNumber: party.registrationNumber ?? '',
    vatNumber: party.vatNumber ?? '',
    idNumber: party.identityVisible ? (party.idNumber ?? '') : '',
    passportNumber: party.identityVisible ? (party.passportNumber ?? '') : '',
    popiaConsent: party.popiaConsent,
    contacts:
      party.contacts.length > 0
        ? party.contacts.map((contact) => ({
            name: contact.name,
            jobTitle: contact.jobTitle ?? '',
            email: contact.email ?? '',
            phone: contact.phone ?? '',
            isPrimary: contact.isPrimary,
          }))
        : [emptyContact()],
    addresses:
      party.addresses.length > 0
        ? party.addresses.map((address) => ({
            kind: address.kind,
            line1: address.line1,
            line2: address.line2 ?? '',
            suburb: address.suburb ?? '',
            city: address.city,
            province: address.province ?? '',
            postalCode: address.postalCode ?? '',
            country: address.country,
            isPrimary: address.isPrimary,
          }))
        : [emptyAddress()],
    channels:
      party.channels.length > 0
        ? party.channels.map((channel) => ({
            kind: channel.kind === 'phone' ? 'phone' : 'email',
            value: channel.value,
            label: channel.label ?? '',
            isPrimary: channel.isPrimary,
          }))
        : [emptyChannel()],
    tags: party.tags.join(', '),
    note: '',
    confirmDuplicate: false,
  };
}

function payloadOf(form: FormState, identityVisible: boolean) {
  const contacts = form.contacts.filter((row) =>
    [row.name, row.jobTitle, row.email, row.phone].some((value) => value.trim()),
  );
  const addresses = form.addresses.filter((row) =>
    [row.line1, row.line2, row.suburb, row.city, row.province, row.postalCode].some((value) =>
      value.trim(),
    ),
  );
  const channels = form.channels.filter((row) => row.value.trim() || row.label.trim());
  const body: Record<string, unknown> = {
    kind: form.kind,
    displayName: form.displayName,
    legalName: form.legalName,
    tradingName: form.tradingName,
    givenName: form.givenName,
    familyName: form.familyName,
    roles: form.roles,
    registrationNumber: form.registrationNumber,
    vatNumber: form.vatNumber,
    popiaConsent: form.popiaConsent,
    contacts,
    addresses,
    channels,
    tags: form.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    note: form.note,
    confirmDuplicate: form.confirmDuplicate,
  };
  if (identityVisible) {
    body.idNumber = form.idNumber;
    body.passportNumber = form.passportNumber;
  }
  return body;
}

function remapRowErrors(
  errors: Record<string, string>,
  prefix: string,
  indexes: number[],
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(errors)) {
    const match = new RegExp(`^${prefix}\\.(\\d+)\\.(.+)$`).exec(key);
    if (!match) {
      next[key] = value;
      continue;
    }
    const source = Number(match[1]);
    const target = indexes[source];
    next[target === undefined ? key : `${prefix}.${target}.${match[2]}`] = value;
  }
  return next;
}

function reasonText(reasons: string[]): string {
  return reasons
    .map((reason) => (reason === 'vat' ? 'VAT number' : reason === 'email' ? 'email' : 'name'))
    .join(', ');
}

export function ContactFormScreen({ navigate, partyId }: { navigate: Navigate; partyId?: string }) {
  const notify = useToast();
  const editing = Boolean(partyId);
  const [form, setForm] = useState<FormState>(blankForm);
  const [ready, setReady] = useState(!editing);
  const [canEdit, setCanEdit] = useState(true);
  const [identityVisible, setIdentityVisible] = useState(false);
  const [hiddenIdentity, setHiddenIdentity] = useState('');
  const [blocked, setBlocked] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [matches, setMatches] = useState<Match[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const path = partyId ? `/krn/parties/${partyId}` : '/krn/parties?status=active';
    api(path)
      .then(({ status, body }) => {
        if (cancelled) return;
        if (status === 401) {
          setBlocked('Sign in to add a contact.');
          setReady(true);
          return;
        }
        if (status === 403 || status === 404) {
          setBlocked(errorMessage(body, 'That contact is not available.'));
          setReady(true);
          return;
        }
        if (!body || typeof body !== 'object') {
          setBlocked('The form did not load.');
          setReady(true);
          return;
        }
        const access = body as {
          canEdit?: boolean;
          canViewIdentity?: boolean;
          party?: PartyDetail;
        };
        setCanEdit(access.canEdit !== false);
        setIdentityVisible(access.canViewIdentity === true);
        if (access.party) {
          if (access.party.status === 'archived') {
            setBlocked('Restore this contact before editing it.');
          }
          setForm(fromParty(access.party));
          if (
            !access.party.identityVisible &&
            (access.party.idNumber || access.party.passportNumber)
          ) {
            setHiddenIdentity(
              'An ID or passport is on file. Only the company owner can see or change it.',
            );
          }
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setBlocked('The API is unreachable.');
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [partyId]);

  function patch(partial: Partial<FormState>) {
    setForm((current) => ({ ...current, ...partial, confirmDuplicate: false }));
    setMatches([]);
  }

  const contactIndexes = form.contacts.flatMap((row, index) =>
    [row.name, row.jobTitle, row.email, row.phone].some((value) => value.trim()) ? [index] : [],
  );
  const addressIndexes = form.addresses.flatMap((row, index) =>
    [row.line1, row.line2, row.suburb, row.city, row.province, row.postalCode].some((value) =>
      value.trim(),
    )
      ? [index]
      : [],
  );
  const channelIndexes = form.channels.flatMap((row, index) =>
    row.value.trim() || row.label.trim() ? [index] : [],
  );
  const rawErrors = showErrors ? partyFieldErrors(payloadOf(form, identityVisible)) : {};
  const errors = {
    ...remapRowErrors(
      remapRowErrors(
        remapRowErrors(rawErrors, 'contacts', contactIndexes),
        'addresses',
        addressIndexes,
      ),
      'channels',
      channelIndexes,
    ),
    ...serverFields,
  };

  async function save() {
    setShowErrors(true);
    const nextErrors = partyFieldErrors(payloadOf(form, identityVisible));
    if (Object.keys(nextErrors).length > 0) {
      setServerFields({});
      return;
    }
    setSaving(true);
    const { status, body } = await api(editing ? `/krn/parties/${partyId}` : '/krn/parties', {
      method: editing ? 'PUT' : 'POST',
      body: JSON.stringify(payloadOf(form, identityVisible)),
    });
    setSaving(false);
    if ((status === 201 || status === 200) && body && typeof body === 'object' && 'party' in body) {
      const saved = (body as { party: PartyDetail }).party;
      notify({ title: editing ? 'Contact saved.' : 'Contact added.' });
      navigate(`/contacts/${saved.id}`);
      return;
    }
    if (status === 409 && body && typeof body === 'object' && 'matches' in body) {
      setMatches((body as { matches: Match[] }).matches);
      setServerFields({});
      return;
    }
    if (
      body &&
      typeof body === 'object' &&
      'fields' in body &&
      body.fields &&
      typeof body.fields === 'object'
    ) {
      setServerFields(body.fields as Record<string, string>);
    }
    notify({ title: errorMessage(body, 'The contact was not saved.'), tone: 'bad' });
  }

  if (!ready) {
    return <Skeleton lines={8} />;
  }
  if (blocked || !canEdit) {
    return (
      <EmptyState
        title="This form is closed"
        body={blocked || 'Your role can look at contacts but cannot change them.'}
        action={
          <Button variant="secondary" onClick={() => navigate('/contacts')}>
            Back to contacts
          </Button>
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title={editing ? 'Edit Contact' : 'New Contact'}
        description="Customers, suppliers, and staff all start as one contact."
        breadcrumbs={[
          { label: 'Contacts', href: '/contacts' },
          { label: editing ? form.displayName || 'Edit' : 'New Contact' },
        ]}
        onNavigate={navigate}
      />
      <Form onSubmit={() => void save()}>
        <Card title="Who They Are">
          <SelectField
            label="Kind"
            value={form.kind}
            onChange={(value) => patch({ kind: value === 'person' ? 'person' : 'organisation' })}
          >
            <option value="organisation">Organisation</option>
            <option value="person">Person</option>
          </SelectField>
          <TextField
            label="Name"
            value={form.displayName}
            error={errors.displayName}
            hint={
              form.kind === 'person'
                ? 'The name people search for. Leave this blank to use the first and last name.'
                : 'The name people search for.'
            }
            onChange={(displayName) => patch({ displayName })}
          />
          {form.kind === 'person' ? (
            <div className="ui-split two">
              <TextField
                label="First Name"
                value={form.givenName}
                error={errors.givenName}
                onChange={(givenName) => patch({ givenName })}
              />
              <TextField
                label="Last Name"
                value={form.familyName}
                error={errors.familyName}
                onChange={(familyName) => patch({ familyName })}
              />
            </div>
          ) : (
            <TextField
              label="Legal Name"
              value={form.legalName}
              error={errors.legalName}
              hint="Optional. The registered name, if it differs."
              onChange={(legalName) => patch({ legalName })}
            />
          )}
          <TextField
            label="Trading Name"
            value={form.tradingName}
            error={errors.tradingName}
            hint="Optional."
            onChange={(tradingName) => patch({ tradingName })}
          />
          <fieldset className="ui-fieldset">
            <legend>Roles</legend>
            {PARTY_ROLES.map((role) => (
              <CheckField
                key={role}
                label={PARTY_ROLE_LABELS[role]}
                checked={form.roles.includes(role)}
                onChange={(checked) => {
                  const roles = checked
                    ? [...form.roles, role]
                    : form.roles.filter((item) => item !== role);
                  patch({ roles });
                }}
              />
            ))}
            {errors.roles ? (
              <small className="ui-error">{errors.roles}</small>
            ) : (
              <small className="ui-hint">A contact can hold more than one role.</small>
            )}
          </fieldset>
        </Card>

        <Card title="South African Particulars">
          {form.kind === 'organisation' ? (
            <TextField
              label="Registration Number"
              value={form.registrationNumber}
              error={errors.registrationNumber}
              hint="For example 2019/123456/07."
              onChange={(registrationNumber) => patch({ registrationNumber })}
            />
          ) : null}
          <TextField
            label="VAT Number"
            value={form.vatNumber}
            error={errors.vatNumber}
            hint="10 digits, starting with 4. Leave blank if they are not VAT registered."
            onChange={(vatNumber) => patch({ vatNumber })}
          />
          {form.kind === 'person' && identityVisible ? (
            <>
              <TextField
                label="ID Number"
                value={form.idNumber}
                error={errors.idNumber}
                hint="13-digit South African ID. Only the company owner can see this later."
                onChange={(idNumber) => patch({ idNumber })}
              />
              <TextField
                label="Passport Number"
                value={form.passportNumber}
                error={errors.passportNumber}
                hint="Optional, if they do not have a South African ID."
                onChange={(passportNumber) => patch({ passportNumber })}
              />
            </>
          ) : null}
          {hiddenIdentity ? <p className="ui-hint">{hiddenIdentity}</p> : null}
          <CheckField
            label="They agreed that we may keep these details (POPIA)."
            hint="The date is stored with the contact. You can clear this later."
            checked={form.popiaConsent}
            onChange={(popiaConsent) => patch({ popiaConsent })}
          />
        </Card>

        <Card title="Phone And Email">
          {form.channels.map((channel, index) => (
            <div className="ui-repeat" key={`channel-${index}`}>
              <SelectField
                label="Type"
                value={channel.kind}
                onChange={(value) => {
                  const channels = form.channels.slice();
                  const next = channels[index];
                  if (!next) return;
                  channels[index] = { ...next, kind: value === 'phone' ? 'phone' : 'email' };
                  patch({ channels });
                }}
              >
                <option value="email">Email</option>
                <option value="phone">Phone</option>
              </SelectField>
              <TextField
                label={channel.kind === 'email' ? 'Email' : 'Phone'}
                value={channel.value}
                error={errors[`channels.${index}.value`]}
                onChange={(value) => {
                  const channels = form.channels.slice();
                  const next = channels[index];
                  if (!next) return;
                  channels[index] = { ...next, value };
                  patch({ channels });
                }}
              />
              <TextField
                label="Label"
                value={channel.label}
                hint="Optional. For example Accounts or Mobile."
                onChange={(label) => {
                  const channels = form.channels.slice();
                  const next = channels[index];
                  if (!next) return;
                  channels[index] = { ...next, label };
                  patch({ channels });
                }}
              />
              <CheckField
                label="Main One"
                checked={channel.isPrimary}
                onChange={(isPrimary) => {
                  const channels = form.channels.map((row, rowIndex) =>
                    row.kind === channel.kind
                      ? { ...row, isPrimary: isPrimary && rowIndex === index }
                      : row,
                  );
                  patch({ channels });
                }}
              />
              <Button
                variant="ghost"
                onClick={() =>
                  patch({ channels: form.channels.filter((_, rowIndex) => rowIndex !== index) })
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() =>
              patch({ channels: [...form.channels, { ...emptyChannel(), isPrimary: false }] })
            }
          >
            Add phone or email
          </Button>
        </Card>

        <Card title="Addresses">
          {form.addresses.map((address, index) => (
            <div className="ui-repeat" key={`address-${index}`}>
              <SelectField
                label="Address Type"
                value={address.kind}
                onChange={(kind) => {
                  const addresses = form.addresses.slice();
                  const next = addresses[index];
                  if (!next) return;
                  addresses[index] = { ...next, kind };
                  patch({ addresses });
                }}
              >
                {ADDRESS_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {ADDRESS_KIND_LABELS[kind]}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="Street"
                value={address.line1}
                error={errors[`addresses.${index}.line1`]}
                onChange={(line1) => {
                  const addresses = form.addresses.slice();
                  const next = addresses[index];
                  if (!next) return;
                  addresses[index] = { ...next, line1 };
                  patch({ addresses });
                }}
              />
              <TextField
                label="Line 2"
                value={address.line2}
                onChange={(line2) => {
                  const addresses = form.addresses.slice();
                  const next = addresses[index];
                  if (!next) return;
                  addresses[index] = { ...next, line2 };
                  patch({ addresses });
                }}
              />
              <div className="ui-split two">
                <TextField
                  label="Suburb"
                  value={address.suburb}
                  onChange={(suburb) => {
                    const addresses = form.addresses.slice();
                    const next = addresses[index];
                    if (!next) return;
                    addresses[index] = { ...next, suburb };
                    patch({ addresses });
                  }}
                />
                <TextField
                  label="City"
                  value={address.city}
                  error={errors[`addresses.${index}.city`]}
                  onChange={(city) => {
                    const addresses = form.addresses.slice();
                    const next = addresses[index];
                    if (!next) return;
                    addresses[index] = { ...next, city };
                    patch({ addresses });
                  }}
                />
              </div>
              <div className="ui-split two">
                <SelectField
                  label="Province"
                  value={address.province}
                  error={errors[`addresses.${index}.province`]}
                  onChange={(province) => {
                    const addresses = form.addresses.slice();
                    const next = addresses[index];
                    if (!next) return;
                    addresses[index] = { ...next, province };
                    patch({ addresses });
                  }}
                >
                  <option value="">Choose</option>
                  {SA_PROVINCES.map((province) => (
                    <option key={province} value={province}>
                      {province}
                    </option>
                  ))}
                </SelectField>
                <TextField
                  label="Postal Code"
                  value={address.postalCode}
                  error={errors[`addresses.${index}.postalCode`]}
                  onChange={(postalCode) => {
                    const addresses = form.addresses.slice();
                    const next = addresses[index];
                    if (!next) return;
                    addresses[index] = { ...next, postalCode };
                    patch({ addresses });
                  }}
                />
              </div>
              <CheckField
                label="Main Address"
                checked={address.isPrimary}
                onChange={(isPrimary) => {
                  patch({
                    addresses: form.addresses.map((row, rowIndex) => ({
                      ...row,
                      isPrimary: isPrimary && rowIndex === index,
                    })),
                  });
                }}
              />
              <Button
                variant="ghost"
                onClick={() =>
                  patch({ addresses: form.addresses.filter((_, rowIndex) => rowIndex !== index) })
                }
              >
                Remove address
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() =>
              patch({ addresses: [...form.addresses, { ...emptyAddress(), isPrimary: false }] })
            }
          >
            Add address
          </Button>
        </Card>

        <Card title="People">
          <p className="ui-hint">Someone who works at this contact, such as an accounts clerk.</p>
          {form.contacts.map((contact, index) => (
            <div className="ui-repeat" key={`person-${index}`}>
              <TextField
                label="Name"
                value={contact.name}
                error={errors[`contacts.${index}.name`]}
                onChange={(name) => {
                  const contacts = form.contacts.slice();
                  const next = contacts[index];
                  if (!next) return;
                  contacts[index] = { ...next, name };
                  patch({ contacts });
                }}
              />
              <TextField
                label="Job Title"
                value={contact.jobTitle}
                onChange={(jobTitle) => {
                  const contacts = form.contacts.slice();
                  const next = contacts[index];
                  if (!next) return;
                  contacts[index] = { ...next, jobTitle };
                  patch({ contacts });
                }}
              />
              <TextField
                label="Email"
                value={contact.email}
                error={errors[`contacts.${index}.email`]}
                onChange={(email) => {
                  const contacts = form.contacts.slice();
                  const next = contacts[index];
                  if (!next) return;
                  contacts[index] = { ...next, email };
                  patch({ contacts });
                }}
              />
              <TextField
                label="Phone"
                value={contact.phone}
                error={errors[`contacts.${index}.phone`]}
                onChange={(phone) => {
                  const contacts = form.contacts.slice();
                  const next = contacts[index];
                  if (!next) return;
                  contacts[index] = { ...next, phone };
                  patch({ contacts });
                }}
              />
              <CheckField
                label="Main Person"
                checked={contact.isPrimary}
                onChange={(isPrimary) => {
                  patch({
                    contacts: form.contacts.map((row, rowIndex) => ({
                      ...row,
                      isPrimary: isPrimary && rowIndex === index,
                    })),
                  });
                }}
              />
              <Button
                variant="ghost"
                onClick={() =>
                  patch({ contacts: form.contacts.filter((_, rowIndex) => rowIndex !== index) })
                }
              >
                Remove person
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() =>
              patch({ contacts: [...form.contacts, { ...emptyContact(), isPrimary: false }] })
            }
          >
            Add a person
          </Button>
        </Card>

        <Card title="Tags And A Note">
          <TextField
            label="Tags"
            value={form.tags}
            error={errors.tags}
            hint="Separate tags with commas. For example retail, packaging."
            onChange={(tags) => patch({ tags })}
          />
          {editing ? null : (
            <TextAreaField
              label="Note"
              value={form.note}
              error={errors.note}
              hint="Optional. You can add more notes after saving."
              onChange={(note) => patch({ note })}
            />
          )}
        </Card>

        {matches.length > 0 ? (
          <Card title="This looks like a contact you already have">
            <ul>
              {matches.map((match) => (
                <li key={match.id}>
                  <button
                    type="button"
                    className="ui-text-link"
                    onClick={() => navigate(`/contacts/${match.id}`)}
                  >
                    {match.displayName}
                  </button>{' '}
                  matches on {reasonText(match.reasons)}.
                </li>
              ))}
            </ul>
            <CheckField
              label="Save anyway. This is a different contact."
              checked={form.confirmDuplicate}
              onChange={(confirmDuplicate) =>
                setForm((current) => ({ ...current, confirmDuplicate }))
              }
            />
          </Card>
        ) : null}

        <div className="ui-actions ui-form-submit">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Save contact'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => navigate(editing ? `/contacts/${partyId}` : '/contacts')}
          >
            Cancel
          </Button>
        </div>
      </Form>
    </>
  );
}
