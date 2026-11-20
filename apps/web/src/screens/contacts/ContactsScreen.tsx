import { columnHeading, orderColumns, PARTY_ROLE_LABELS } from '@omnivate/shared';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  Skeleton,
  TabsBar,
  usePhone,
  type Column,
} from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api, errorMessage, type Navigate } from '../../api';
import { useWorkspace } from '../../workspace';
import { roleLabel, type PartySummary } from './types';

export function ContactsScreen({ navigate }: { navigate: Navigate }) {
  const { layouts } = useWorkspace();
  const phone = usePhone();
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('active');
  const [counts, setCounts] = useState<{ all: number; customer: number; supplier: number } | null>(
    null,
  );
  const [parties, setParties] = useState<PartySummary[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (role) params.set('role', role);
      if (status) params.set('status', status);
      const search = params.toString();
      api(`/krn/parties${search ? `?${search}` : ''}`)
        .then(({ status: code, body }) => {
          if (cancelled) return;
          if (code === 401) {
            setParties([]);
            setMessage('Sign in to see contacts at your company.');
            return;
          }
          if (code === 403) {
            setParties([]);
            setMessage(errorMessage(body, 'Your role cannot open contacts.'));
            return;
          }
          if (code !== 200 || !body || typeof body !== 'object' || !('parties' in body)) {
            setParties([]);
            setMessage(errorMessage(body, 'The contact list did not load.'));
            return;
          }
          const payload = body as { parties: PartySummary[]; canEdit: boolean };
          setParties(payload.parties);
          setCanEdit(payload.canEdit);
          setMessage('');
        })
        .catch(() => {
          if (!cancelled) {
            setParties([]);
            setMessage('The API is unreachable.');
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, role, status]);

  useEffect(() => {
    void api('/krn/parties?status=active').then(({ status: code, body }) => {
      if (code !== 200 || !body || typeof body !== 'object' || !('parties' in body)) {
        return;
      }
      const list = (body as { parties: PartySummary[] }).parties;
      setCounts({
        all: list.length,
        customer: list.filter((row) => row.roles.includes('customer')).length,
        supplier: list.filter((row) => row.roles.includes('supplier')).length,
      });
    });
  }, []);

  const newContact = canEdit ? (
    <Button onClick={() => navigate('/contacts/new')}>New Contact</Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="Contacts"
        description="One list for customers, suppliers, and staff. A contact can be more than one of those."
        actions={phone ? undefined : newContact}
      />
      {counts ? (
        <div className="ui-grid stats">
          <div className="ui-card">
            <div className="ui-stat">
              <strong>{counts.all}</strong>
              <span>Contacts</span>
            </div>
          </div>
          <div className="ui-card">
            <div className="ui-stat">
              <strong>{counts.customer}</strong>
              <span>Customers</span>
            </div>
          </div>
          <div className="ui-card">
            <div className="ui-stat">
              <strong>{counts.supplier}</strong>
              <span>Suppliers</span>
            </div>
          </div>
        </div>
      ) : null}
      <TabsBar
        value={role || 'all'}
        onValueChange={(value) => setRole(value === 'all' ? '' : value)}
        tabs={[
          { value: 'all', label: 'All' },
          { value: 'customer', label: PARTY_ROLE_LABELS.customer },
          { value: 'supplier', label: PARTY_ROLE_LABELS.supplier },
          { value: 'staff', label: PARTY_ROLE_LABELS.staff },
        ]}
      />
      <TabsBar
        value={status}
        onValueChange={setStatus}
        tabs={[
          { value: 'active', label: 'Active' },
          { value: 'archived', label: 'Archived' },
          { value: 'all', label: 'Active And Archived' },
        ]}
      />
      {parties === null ? (
        <Skeleton lines={5} />
      ) : message ? (
        <EmptyState
          title="Contacts are not available"
          body={message}
          action={
            message.startsWith('Sign in') ? (
              <Button onClick={() => navigate('/login')}>Sign In</Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          rows={parties}
          getRowId={(row) => row.id}
          query={query}
          onQueryChange={setQuery}
          searchPlaceholder="Search name, email, phone, VAT, or tag"
          onRow={(row) => navigate(`/contacts/${row.id}`)}
          emptyTitle={query || role || status !== 'active' ? 'Nothing matches' : 'No contacts yet'}
          emptyBody={
            query || role || status !== 'active'
              ? 'Try another name, or show all roles.'
              : 'Customers, suppliers, and staff all start here. One record can hold several roles.'
          }
          emptyAction={undefined}
          columns={orderColumns(
            [
              {
                key: 'name',
                header: columnHeading('contacts', 'name', layouts),
                sortValue: (row) => row.displayName,
                text: (row) => row.displayName,
                cell: (row) => row.displayName,
              },
              {
                key: 'roles',
                header: columnHeading('contacts', 'roles', layouts),
                text: (row) =>
                  [
                    ...row.roles.map((item) => roleLabel(item)),
                    row.status === 'archived' ? 'Archived' : '',
                  ]
                    .filter(Boolean)
                    .join(', '),
                cell: (row) => (
                  <span>
                    {row.roles.map((item) => (
                      <Badge
                        key={item}
                        tone={item === 'supplier' ? 'ok' : item === 'staff' ? 'warn' : 'info'}
                      >
                        {roleLabel(item)}
                      </Badge>
                    ))}
                    {row.status === 'archived' ? <Badge tone="neutral">Archived</Badge> : null}
                  </span>
                ),
              },
              {
                key: 'reach',
                header: columnHeading('contacts', 'reach', layouts),
                sortValue: (row) => row.email ?? row.phone ?? '',
                text: (row) => row.email ?? row.phone ?? '—',
                cell: (row) => row.email ?? row.phone ?? '—',
              },
              {
                key: 'city',
                header: columnHeading('contacts', 'city', layouts),
                sortValue: (row) => row.city ?? '',
                text: (row) => row.city ?? '—',
                cell: (row) => row.city ?? '—',
              },
            ] as Column<PartySummary>[],
            layouts.contacts,
          )}
        />
      )}
    </>
  );
}
