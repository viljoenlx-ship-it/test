import { ADDRESS_KIND_LABELS, type AddressKind } from '@omnivate/shared';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Form,
  PageHeader,
  Skeleton,
  TabsBar,
  TextAreaField,
  usePhone,
  useToast,
} from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api, errorMessage, type Navigate } from '../../api';
import { roleLabel, whenLabel, type PartyDetail } from './types';

export function ContactDetailScreen({
  navigate,
  partyId,
}: {
  navigate: Navigate;
  partyId: string;
}) {
  const notify = useToast();
  const phone = usePhone();
  const [party, setParty] = useState<PartyDetail | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState('overview');
  const [note, setNote] = useState('');
  const [confirmArchive, setConfirmArchive] = useState(false);

  async function load() {
    const { status, body } = await api(`/krn/parties/${partyId}`);
    if (status === 401) {
      setMessage('Sign in to see this contact.');
      setParty(null);
      return;
    }
    if (status === 404 || status === 403) {
      setMessage(errorMessage(body, 'That contact was not found.'));
      setParty(null);
      return;
    }
    if (!body || typeof body !== 'object' || !('party' in body)) {
      setMessage('The contact did not load.');
      return;
    }
    const payload = body as { party: PartyDetail; canEdit: boolean };
    setParty(payload.party);
    setCanEdit(payload.canEdit);
    setMessage('');
  }

  useEffect(() => {
    let cancelled = false;
    load().catch(() => {
      if (!cancelled) setMessage('The API is unreachable.');
    });
    return () => {
      cancelled = true;
    };
  }, [partyId]);

  async function setArchived(archived: boolean) {
    const { status, body } = await api(
      `/krn/parties/${partyId}/${archived ? 'archive' : 'restore'}`,
      { method: 'POST', body: '{}' },
    );
    if (status === 200) {
      notify({ title: archived ? 'Contact archived. Nothing was deleted.' : 'Contact restored.' });
      setConfirmArchive(false);
      await load();
      return;
    }
    notify({ title: errorMessage(body, 'That change was not saved.'), tone: 'bad' });
  }

  async function saveNote() {
    const { status, body } = await api(`/krn/parties/${partyId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
    if (status === 201 && body && typeof body === 'object' && 'party' in body) {
      setParty((body as { party: PartyDetail }).party);
      setNote('');
      notify({ title: 'Note added.' });
      return;
    }
    notify({ title: errorMessage(body, 'The note was not added.'), tone: 'bad' });
  }

  if (!party && !message) {
    return <Skeleton lines={8} />;
  }
  if (!party) {
    return (
      <EmptyState
        title="Contact unavailable"
        body={message}
        action={
          <Button variant="secondary" onClick={() => navigate('/contacts')}>
            Back to contacts
          </Button>
        }
      />
    );
  }

  const archived = party.status === 'archived';

  return (
    <>
      <PageHeader
        title={party.displayName}
        description={`${party.kind === 'person' ? 'Person' : 'Organisation'} · ${party.roles.map(roleLabel).join(', ')}`}
        breadcrumbs={[{ label: 'Contacts', href: '/contacts' }, { label: party.displayName }]}
        onNavigate={navigate}
        actions={
          canEdit ? (
            archived ? (
              <Button onClick={() => void setArchived(false)}>Restore Contact</Button>
            ) : (
              <Button onClick={() => navigate(`/contacts/${party.id}/edit`)}>Edit</Button>
            )
          ) : null
        }
      />
      <div className="ui-actions" style={{ marginBottom: 12 }}>
        {party.roles.map((role) => (
          <Badge key={role}>{roleLabel(role)}</Badge>
        ))}
        {archived ? <Badge tone="neutral">Archived</Badge> : <Badge tone="ok">Active</Badge>}
        <Badge tone={party.popiaConsent ? 'ok' : 'warn'}>
          {party.popiaConsent ? 'POPIA Consent On File' : 'No POPIA Consent Yet'}
        </Badge>
      </div>
      <TabsBar
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'people', label: 'People' },
          { value: 'addresses', label: 'Addresses' },
          { value: 'channels', label: 'Phones And Email' },
          { value: 'notes', label: 'Notes' },
        ]}
      />
      {tab === 'overview' ? (
        <Card>
          <p>Legal Name: {party.legalName ?? '—'}</p>
          <p>Trading Name: {party.tradingName ?? '—'}</p>
          <p>Registration Number: {party.registrationNumber ?? '—'}</p>
          <p>VAT Number: {party.vatNumber ?? '—'}</p>
          {party.kind === 'person' ? (
            <>
              <p>ID Number: {party.idNumber ?? '—'}</p>
              <p>Passport: {party.passportNumber ?? '—'}</p>
            </>
          ) : null}
          <p>
            POPIA Consent:{' '}
            {party.popiaConsent ? `Agreed ${whenLabel(party.popiaConsentAt)}` : 'Not Recorded'}
          </p>
          <p>Tags: {party.tags.length > 0 ? party.tags.join(', ') : '—'}</p>
          {!party.identityVisible && (party.idNumber || party.passportNumber) ? (
            <p className="ui-hint">
              The ID or passport is hidden. Only the company owner can read it.
            </p>
          ) : null}
          {canEdit && !archived ? (
            <div className="ui-actions" style={{ marginTop: 16 }}>
              <Button variant="danger" onClick={() => setConfirmArchive(true)}>
                Archive
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}
      {tab === 'people' ? (
        party.contacts.length === 0 ? (
          <EmptyState
            title="No people yet"
            body="Add someone who works at this contact, such as an accounts clerk, from Edit."
          />
        ) : (
          <div className="ui-stack">
            {party.contacts.map((contact) => (
              <Card key={contact.id} title={contact.name}>
                <p>{contact.jobTitle ?? 'No job title'}</p>
                <p>{contact.email ?? 'No email'}</p>
                <p>
                  {contact.phone && phone ? (
                    <a href={`tel:${contact.phone.replace(/\s/g, '')}`}>{contact.phone}</a>
                  ) : (
                    (contact.phone ?? 'No phone')
                  )}
                </p>
                {contact.isPrimary ? <Badge>Main Person</Badge> : null}
              </Card>
            ))}
          </div>
        )
      ) : null}
      {tab === 'addresses' ? (
        party.addresses.length === 0 ? (
          <EmptyState
            title="No addresses yet"
            body="Add a physical, postal, billing, or delivery address from Edit."
          />
        ) : (
          <div className="ui-stack">
            {party.addresses.map((address) => (
              <Card
                key={address.id}
                title={ADDRESS_KIND_LABELS[address.kind as AddressKind] ?? address.kind}
              >
                <p>
                  {[
                    address.line1,
                    address.line2,
                    address.suburb,
                    address.city,
                    address.province,
                    address.postalCode,
                    address.country,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </p>
                {address.isPrimary ? <Badge>Main Address</Badge> : null}
              </Card>
            ))}
          </div>
        )
      ) : null}
      {tab === 'channels' ? (
        party.channels.length === 0 ? (
          <EmptyState
            title="No phones or emails yet"
            body="Add a number or an email address from Edit."
          />
        ) : (
          <div className="ui-stack">
            {party.channels.map((channel) => (
              <Card key={channel.id} title={channel.kind === 'email' ? 'Email' : 'Phone'}>
                <p>{channel.value}</p>
                <p className="ui-hint">{channel.label ?? (channel.isPrimary ? 'Main' : '')}</p>
              </Card>
            ))}
          </div>
        )
      ) : null}
      {tab === 'notes' ? (
        <div className="ui-stack">
          {party.notes.length === 0 ? (
            <EmptyState
              title="No notes yet"
              body="A note stays with the contact. Notes are not deleted."
            />
          ) : (
            party.notes.map((item) => (
              <Card key={item.id} title={whenLabel(item.createdAt) || 'Note'}>
                <p>{item.body}</p>
              </Card>
            ))
          )}
          {canEdit ? (
            <Card title="Add A Note">
              <Form onSubmit={() => void saveNote()}>
                <TextAreaField label="Note" value={note} onChange={setNote} />
                <Button type="submit" variant="secondary">
                  Add note
                </Button>
              </Form>
            </Card>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title="Archive this contact?"
        body="They stay in the record and can be found under Archived. Nothing is deleted."
        confirmLabel="Archive"
        onConfirm={() => void setArchived(true)}
      />
    </>
  );
}
