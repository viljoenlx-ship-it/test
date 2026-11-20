import {
  columnHeading,
  defaultColumnLayouts,
  moduleBySlug,
  orderColumns,
  plainRoleName,
  type ColumnLayouts,
  type ModuleId,
} from '@omnivate/shared';
import {
  AppShell,
  Badge,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  Skeleton,
  type Column,
} from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api, errorMessage, type Navigate } from '../api';
import { companyNav, phoneTabs } from '../module-nav';
import { ModuleOverview } from './ModuleOverview';

type Context = {
  companyName: string;
  displayName: string;
  packageName: string;
  city: string | null;
  vatNumber: string | null;
  branchName: string | null;
  modules: ModuleId[];
  columnLayouts: ColumnLayouts;
  logoUrl: string | null;
  summaries: {
    contacts: number | null;
    customers: number | null;
    suppliers: number | null;
    stockItems: number | null;
    lowStock: number | null;
    stockValueLabel: string | null;
  };
  exitUrl: string;
};

const exchanges = new Map<string, ReturnType<typeof api>>();

function exchangeTicket(ticket: string) {
  const existing = exchanges.get(ticket);
  if (existing) {
    return existing;
  }
  const pending = api('/preview/exchange', {
    method: 'POST',
    body: JSON.stringify({ ticket }),
  });
  exchanges.set(ticket, pending);
  return pending;
}

function pageOf(path: string): string {
  if (path === '/preview' || path === '/preview/') {
    return '/';
  }
  return path.replace(/^\/preview/, '') || '/';
}

export function PreviewScreen({
  path,
  search,
  navigate,
}: {
  path: string;
  search: string;
  navigate: Navigate;
}) {
  const [context, setContext] = useState<Context | null>(null);
  const [problem, setProblem] = useState('');
  const ticket = new URLSearchParams(search).get('ticket') ?? '';

  useEffect(() => {
    let cancel = false;
    const load = ticket ? exchangeTicket(ticket) : api('/preview/context');
    load.then(({ status, body }) => {
      if (cancel) {
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object' || !('companyName' in body)) {
        setProblem(errorMessage(body, 'This preview has ended. Open it again from the client.'));
        return;
      }
      setContext(body as Context);
      if (ticket) {
        window.history.replaceState({}, '', '/preview');
      }
    });
    return () => {
      cancel = true;
    };
  }, [ticket]);

  function exit() {
    const target = context?.exitUrl ?? '/';
    void api('/preview/exit', { method: 'POST', body: '{}' }).finally(() => {
      window.location.assign(target);
    });
  }

  if (problem) {
    return (
      <div className="ui-auth">
        <Card title="Preview ended">
          <p>{problem}</p>
        </Card>
      </div>
    );
  }

  if (!context) {
    return (
      <div className="ui-main">
        <Skeleton lines={6} />
      </div>
    );
  }

  const page = pageOf(path);
  const nav = companyNav({
    path: page,
    modules: context.modules,
    signedIn: true,
    prefix: '/preview',
  });
  const moduleSlug = /^\/modules\/([a-z0-9-]+)$/.exec(page)?.[1] ?? '';
  const moduleEntry = moduleSlug ? moduleBySlug(moduleSlug) : undefined;
  const crumbs = moduleEntry
    ? [{ label: moduleEntry.area }, { label: moduleEntry.name }]
    : [{ label: 'Today' }];
  const chips = [
    context.branchName ? context.branchName : null,
    context.city,
    context.vatNumber ? `VAT ${context.vatNumber}` : null,
  ].filter((chip): chip is string => Boolean(chip));

  return (
    <AppShell
      product="Omnivate"
      brandName={context.displayName}
      logoUrl={context.logoUrl}
      nav={nav}
      crumbs={crumbs}
      chips={chips}
      onNavigate={navigate}
      phoneTabs={phoneTabs(nav)}
      clientPreview={{
        message: `Viewing ${context.companyName}. Nothing you change here is saved.`,
        onExit: exit,
      }}
    >
      {page === '/' ? <PreviewHome context={context} navigate={navigate} /> : null}
      {page === '/stock' ? <PreviewStock layouts={context.columnLayouts} /> : null}
      {page === '/contacts' ? <PreviewContacts layouts={context.columnLayouts} /> : null}
      {page === '/users' ? <PreviewPeople /> : null}
      {moduleEntry ? (
        <ModuleOverview entry={moduleEntry} mode={moduleEntry.built ? 'locked' : 'soon'} />
      ) : null}
      {page !== '/' &&
      page !== '/stock' &&
      page !== '/contacts' &&
      page !== '/users' &&
      !moduleEntry ? (
        <ReadOnlyNote
          title="This stays as it is"
          body="You can look around. Changes are turned off in this view."
        />
      ) : null}
    </AppShell>
  );
}

function PreviewHome({ context, navigate }: { context: Context; navigate: Navigate }) {
  const stockOn = context.summaries.stockItems !== null;
  const contactsOn = context.summaries.contacts !== null;
  return (
    <>
      <PageHeader title="Today" description="A short look at what is open for this company." />
      <div className="ui-grid stats">
        {contactsOn ? (
          <Summary
            value={String(context.summaries.contacts)}
            label="Contacts"
            onClick={() => navigate('/preview/contacts')}
          />
        ) : null}
        {stockOn ? (
          <Summary
            value={context.summaries.stockValueLabel ?? '—'}
            label="Stock Value"
            onClick={() => navigate('/preview/stock')}
          />
        ) : null}
      </div>
    </>
  );
}

function Summary({
  value,
  label,
  onClick,
}: {
  value: string;
  label: string;
  onClick?: () => void;
}) {
  const card = (
    <div className="ui-card">
      <div className="ui-stat">
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
  if (!onClick) {
    return card;
  }
  return (
    <button type="button" className="ui-stat-button" onClick={onClick}>
      {card}
    </button>
  );
}

function ReadOnlyNote({ title, body }: { title: string; body: string }) {
  return (
    <>
      <PageHeader title={title} description={body} />
      <Card>
        <EmptyState
          title="Read Only"
          body="Exit the preview to change this client from the control panel."
        />
      </Card>
    </>
  );
}

type StockItem = {
  id: string;
  name: string;
  code: string;
  onHandLabel: string;
  valueLabel: string;
  priceLabel: string;
  low: boolean;
};

function PreviewStock({ layouts }: { layouts: ColumnLayouts }) {
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    void api('/preview/stock').then(({ body }) => {
      if (body && typeof body === 'object' && 'items' in body) {
        const payload = body as { available: boolean; items: StockItem[] };
        setAvailable(payload.available);
        setItems(payload.items);
      } else {
        setItems([]);
      }
    });
  }, []);
  const columns: Column<StockItem>[] = orderColumns(
    [
      {
        key: 'name',
        header: columnHeading('stock', 'name', layouts),
        text: (row) => row.name,
        cell: (row) => row.name,
      },
      {
        key: 'code',
        header: columnHeading('stock', 'code', layouts),
        text: (row) => row.code,
        cell: (row) => row.code,
      },
      {
        key: 'onHand',
        header: columnHeading('stock', 'onHand', layouts),
        text: (row) => row.onHandLabel,
        cell: (row) => row.onHandLabel,
      },
      {
        key: 'value',
        header: columnHeading('stock', 'value', layouts),
        text: (row) => row.valueLabel,
        cell: (row) => row.valueLabel,
      },
      {
        key: 'price',
        header: columnHeading('stock', 'price', layouts),
        text: (row) => row.priceLabel,
        cell: (row) => row.priceLabel,
      },
    ],
    layouts.stock ?? defaultColumnLayouts().stock,
  );
  return (
    <>
      <PageHeader
        title="Stock"
        description="What is on the shelf. This preview cannot receive, adjust, or edit items."
      />
      {!available ? (
        <Card>
          <EmptyState
            title="Stock is off"
            body="Turn the stock module on for this client to show the list."
          />
        </Card>
      ) : items ? (
        <Card>
          <DataTable
            rows={items}
            columns={columns}
            getRowId={(row) => row.id}
            emptyTitle="No items yet"
            emptyBody="This client has nothing in the catalog."
          />
        </Card>
      ) : (
        <Skeleton lines={5} />
      )}
    </>
  );
}

type ContactRow = { id: string; name: string; roles: string; reach: string; city: string };

function rolePhrase(value: string): string {
  if (!value) {
    return '—';
  }
  return value
    .split(', ')
    .map((role) => role.charAt(0).toUpperCase() + role.slice(1))
    .join(', ');
}

function PreviewContacts({ layouts }: { layouts: ColumnLayouts }) {
  const [rows, setRows] = useState<ContactRow[] | null>(null);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    void api('/preview/contacts').then(({ body }) => {
      if (body && typeof body === 'object' && 'contacts' in body) {
        const payload = body as { available: boolean; contacts: ContactRow[] };
        setAvailable(payload.available);
        setRows(payload.contacts);
      } else {
        setRows([]);
      }
    });
  }, []);
  const columns: Column<ContactRow>[] = orderColumns(
    [
      {
        key: 'name',
        header: columnHeading('contacts', 'name', layouts),
        text: (row) => row.name,
        cell: (row) => row.name,
      },
      {
        key: 'roles',
        header: columnHeading('contacts', 'roles', layouts),
        text: (row) => rolePhrase(row.roles),
        cell: (row) => rolePhrase(row.roles),
      },
      {
        key: 'reach',
        header: columnHeading('contacts', 'reach', layouts),
        text: (row) => row.reach,
        cell: (row) => row.reach,
      },
      {
        key: 'city',
        header: columnHeading('contacts', 'city', layouts),
        text: (row) => row.city,
        cell: (row) => row.city,
      },
    ],
    layouts.contacts ?? defaultColumnLayouts().contacts,
  );
  const customers = rows?.filter((row) => row.roles.includes('customer')).length ?? 0;
  const suppliers = rows?.filter((row) => row.roles.includes('supplier')).length ?? 0;
  return (
    <>
      <PageHeader
        title="Contacts"
        description="Customers, suppliers, and staff. This preview cannot add or edit a contact."
      />
      {rows ? (
        <div className="ui-grid stats">
          <Summary value={String(rows.length)} label="Contacts" />
          <Summary value={String(customers)} label="Customers" />
          <Summary value={String(suppliers)} label="Suppliers" />
        </div>
      ) : null}
      {!available ? (
        <Card>
          <EmptyState
            title="Contacts are off"
            body="Turn contacts on for this client to show the list."
          />
        </Card>
      ) : rows ? (
        <Card>
          <DataTable
            rows={rows}
            columns={columns}
            getRowId={(row) => row.id}
            emptyTitle="No contacts yet"
            emptyBody="This client has no contacts."
          />
        </Card>
      ) : (
        <Skeleton lines={4} />
      )}
    </>
  );
}

function roleList(value: string): string {
  if (!value || value === 'No role') {
    return 'No Role';
  }
  return value
    .split(',')
    .map((part) => plainRoleName({ name: part.trim() }))
    .join(', ');
}

function PreviewPeople() {
  const [rows, setRows] = useState<
    { id: string; name: string; email: string; status: string; roles: string }[] | null
  >(null);
  useEffect(() => {
    void api('/preview/people').then(({ body }) => {
      if (body && typeof body === 'object' && 'people' in body) {
        setRows(
          (
            body as {
              people: { id: string; name: string; email: string; status: string; roles: string }[];
            }
          ).people,
        );
      }
    });
  }, []);
  return (
    <>
      <PageHeader
        title="People"
        description="Who can sign in. Passwords and roles are changed from the control panel, not here."
      />
      {rows ? (
        <Card>
          <DataTable
            rows={rows}
            getRowId={(row) => row.id}
            emptyTitle="No people yet"
            emptyBody="Invite someone from the client page."
            columns={[
              { key: 'name', header: 'Name', text: (row) => row.name, cell: (row) => row.name },
              { key: 'email', header: 'Email', text: (row) => row.email, cell: (row) => row.email },
              {
                key: 'roles',
                header: 'Role',
                text: (row) => roleList(row.roles),
                cell: (row) => roleList(row.roles),
              },
              {
                key: 'status',
                header: 'Status',
                text: (row) => (row.status === 'active' ? 'Active' : 'Deactivated'),
                cell: (row) => (
                  <Badge tone={row.status === 'active' ? 'ok' : 'neutral'}>
                    {row.status === 'active' ? 'Active' : 'Deactivated'}
                  </Badge>
                ),
              },
            ]}
          />
        </Card>
      ) : (
        <Skeleton lines={4} />
      )}
    </>
  );
}
