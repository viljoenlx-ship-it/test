import { formatSaDate, type CustomFieldDefinition, type CustomFieldValue } from '@omnivate/shared';
import {
  Badge,
  Button,
  Card,
  CustomFieldsForm,
  DataTable,
  Form,
  PageHeader,
  TabsBar,
  TextField,
  type Column,
} from '@omnivate/ui';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, type Navigate } from '../../api';
import { CreditScreen, DocumentScreen } from './editor';
import { PaymentScreen } from './payment';

type MoneyLabel = { cents: string; label: string };

function tone(status: string): 'ok' | 'warn' | 'bad' | 'info' | 'neutral' {
  if (status === 'Paid' || status === 'Accepted') return 'ok';
  if (status === 'Overdue' || status === 'Declined') return 'bad';
  if (status === 'Expired' || status === 'Partly Paid') return 'warn';
  if (status === 'Sent' || status === 'Issued') return 'info';
  return 'neutral';
}

type CustomerOption = {
  id: string;
  name: string;
  vatNumber: string;
  address: string;
  contactName: string;
  paymentTermsDays: number;
  creditLimit: string;
  creditHold: boolean;
  creditHoldReason: string;
};

export function CustomersScreen({ navigate }: { navigate: Navigate }) {
  const [rows, setRows] = useState<CustomerOption[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({ q: query });
    void api(`/sales/customers?${params.toString()}`).then(({ status, body }) => {
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object' || !('customers' in body)) {
        setError(errorMessage(body, 'Customers did not load.'));
        setRows([]);
        return;
      }
      const payload = body as {
        customers: CustomerOption[];
        access: { editCustomers: boolean };
      };
      setRows(payload.customers);
      setCanEdit(payload.access.editCustomers);
      setError('');
    });
  }, [navigate, query]);

  const columns: Column<CustomerOption>[] = [
    { key: 'name', header: 'Name', cell: (row) => row.name, sortValue: (row) => row.name },
    { key: 'vat', header: 'VAT Number', cell: (row) => row.vatNumber || '—' },
    { key: 'address', header: 'Billing Address', cell: (row) => row.address || '—' },
    { key: 'contact', header: 'Contact', cell: (row) => row.contactName || '—' },
    {
      key: 'terms',
      header: 'Payment Terms',
      cell: (row) => `${row.paymentTermsDays} Days`,
    },
    {
      key: 'creditLimit',
      header: 'Credit Limit',
      cell: (row) => row.creditLimit ? `R ${row.creditLimit}` : 'No limit',
    },
    {
      key: 'creditHold',
      header: 'Credit Status',
      cell: (row) => row.creditHold ? <Badge tone="bad">On Hold</Badge> : <Badge tone="ok">Active</Badge>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Customers"
        description="Name, VAT number, billing address, contact, and payment terms."
        actions={
          canEdit ? (
            <Button onClick={() => navigate('/customers/new')}>New Customer</Button>
          ) : undefined
        }
      />
      {error ? (
        <Card>
          <p>{error}</p>
        </Card>
      ) : null}
      {rows ? (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          query={query}
          onQueryChange={setQuery}
          searchPlaceholder="Search Customers"
          emptyTitle="No Customers Yet"
          emptyBody="Add a customer before you write a quote."
          onRow={(row) => navigate(`/customers/${row.id}`)}
        />
      ) : null}
    </>
  );
}

export function CustomerScreen({
  navigate,
  customerId,
}: {
  navigate: Navigate;
  customerId: string | null;
}) {
  const [name, setName] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [terms, setTerms] = useState('30');
  const [creditLimit, setCreditLimit] = useState('');
  const [creditHold, setCreditHold] = useState(false);
  const [creditHoldReason, setCreditHoldReason] = useState('');
  const [more, setMore] = useState(false);
  const [line2, setLine2] = useState('');
  const [suburb, setSuburb] = useState('');
  const [fields, setFields] = useState<CustomFieldDefinition[]>([]);
  const [values, setValues] = useState<Record<string, CustomFieldValue | null>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!customerId) {
      return;
    }
    void api(`/sales/customers/${customerId}`).then(({ status, body }) => {
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object' || !('customer' in body)) {
        setError(errorMessage(body, 'That customer was not found.'));
        return;
      }
      const payload = body as {
        customer: CustomerOption & {
          line1: string;
          line2: string;
          suburb: string;
          city: string;
          province: string;
          postalCode: string;
          email: string;
          phone: string;
          creditLimit: string;
          creditHold: boolean;
          creditHoldReason: string;
        };
        definitions: CustomFieldDefinition[];
        values: Record<string, CustomFieldValue>;
      };
      const customer = payload.customer;
      setName(customer.name);
      setVatNumber(customer.vatNumber);
      setLine1(customer.line1);
      setLine2(customer.line2);
      setSuburb(customer.suburb);
      setCity(customer.city);
      setProvince(customer.province);
      setPostalCode(customer.postalCode);
      setContactName(customer.contactName);
      setEmail(customer.email);
      setPhone(customer.phone);
      setTerms(String(customer.paymentTermsDays));
      setCreditLimit(customer.creditLimit ?? '');
      setCreditHold(customer.creditHold ?? false);
      setCreditHoldReason(customer.creditHoldReason ?? '');
      setFields(payload.definitions);
      setValues(payload.values);
    });
  }, [customerId, navigate]);

  async function save() {
    setBusy(true);
    setError('');
    const path = customerId ? `/sales/customers/${customerId}` : '/sales/customers';
    const { status, body } = await api(path, {
      method: customerId ? 'PATCH' : 'POST',
      body: JSON.stringify({
        name,
        vatNumber,
        line1,
        line2,
        suburb,
        city,
        province,
        postalCode,
        contactName,
        email,
        phone,
        paymentTermsDays: terms,
        creditLimit,
        creditHold,
        creditHoldReason,
        customFields: values,
      }),
    });
    setBusy(false);
    if (status !== 200 && status !== 201) {
      setError(errorMessage(body, 'The customer was not saved.'));
      return;
    }
    const saved = body as { customer: { id: string } };
    navigate(`/customers/${saved.customer.id}`);
  }

  return (
    <Form onSubmit={() => void save()}>
      <PageHeader
        title={customerId ? name || 'Customer' : 'New Customer'}
        description="The billing details that print on a quote and a tax invoice."
        actions={
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save Customer'}
          </Button>
        }
      />
      {error ? (
        <Card>
          <p>{error}</p>
        </Card>
      ) : null}
      <Card title="Customer">
        <TextField label="Name" value={name} onChange={setName} />
        <TextField label="VAT Number" value={vatNumber} onChange={setVatNumber} />
        <TextField label="Billing Address" value={line1} onChange={setLine1} />
        <TextField label="City" value={city} onChange={setCity} />
        <TextField label="Contact" value={contactName} onChange={setContactName} />
        <TextField
          label="Payment Terms"
          value={terms}
          onChange={setTerms}
          hint="Days until a tax invoice is due."
        />
        <TextField label="Credit Limit (R)" value={creditLimit} onChange={setCreditLimit} hint="Leave blank for no limit. Example: 25000.00" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <input type="checkbox" checked={creditHold} onChange={(event) => setCreditHold(event.target.checked)} />
          Place customer on credit hold
        </label>
        {creditHold ? <TextField label="Credit Hold Reason" value={creditHoldReason} onChange={setCreditHoldReason} /> : null}
      </Card>
      {more ? (
        <Card title="More Details">
          <TextField label="Address Line 2" value={line2} onChange={setLine2} />
          <TextField label="Suburb" value={suburb} onChange={setSuburb} />
          <TextField label="Province" value={province} onChange={setProvince} />
          <TextField label="Postal Code" value={postalCode} onChange={setPostalCode} />
          <TextField label="Email" value={email} onChange={setEmail} />
          <TextField label="Phone" value={phone} onChange={setPhone} />
          <CustomFieldsForm
            fields={fields}
            values={values}
            onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
          />
        </Card>
      ) : null}
      <Button variant="ghost" onClick={() => setMore((open) => !open)}>
        {more ? 'Hide Details' : 'More Details'}
      </Button>
      {customerId ? (
        <Button variant="secondary" onClick={() => navigate(`/customers/${customerId}/statement`)}>
          Customer Statement
        </Button>
      ) : null}
    </Form>
  );
}

export function QuotesScreen({ navigate }: { navigate: Navigate }) {
  return (
    <DocumentList
      navigate={navigate}
      kind="quote"
      title="Quotes"
      description="Draft a price, send it, and turn an accepted quote into a tax invoice."
      action="New Quote"
      href="/quotes/new"
    />
  );
}

export function InvoicesScreen({ navigate }: { navigate: Navigate }) {
  return (
    <DocumentList
      navigate={navigate}
      kind="invoice"
      title="Invoices"
      description="Tax invoices, what has been paid, and what is still open."
      action="New Invoice"
      href="/invoices/new"
    />
  );
}

function DocumentList({
  navigate,
  kind,
  title,
  description,
  action,
  href,
}: {
  navigate: Navigate;
  kind: 'quote' | 'invoice';
  title: string;
  description: string;
  action: string;
  href: string;
}) {
  const tabs =
    kind === 'quote'
      ? ['All', 'Draft', 'Sent', 'Accepted', 'Declined', 'Expired']
      : ['All', 'Draft', 'Unpaid', 'Partly Paid', 'Paid', 'Overdue'];
  const [tab, setTab] = useState('All');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<
    | {
        id: string;
        number: string | null;
        customerName: string;
        statusLabel: string;
        total: MoneyLabel;
      }[]
    | null
  >(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams({ status: tab, q: query });
    const path = kind === 'quote' ? '/sales/quotes' : '/sales/invoices';
    void api(`${path}?${params.toString()}`).then(({ status, body }) => {
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object') {
        setError(errorMessage(body, `${title} did not load.`));
        setRows([]);
        return;
      }
      const payload = body as {
        quotes?: {
          id: string;
          number: string | null;
          customerName: string;
          statusLabel: string;
          total: MoneyLabel;
        }[];
        invoices?: {
          id: string;
          number: string | null;
          customerName: string;
          statusLabel: string;
          total: MoneyLabel;
        }[];
        canEdit: boolean;
      };
      setRows(payload.quotes ?? payload.invoices ?? []);
      setCanEdit(payload.canEdit);
      setError('');
    });
  }, [kind, navigate, query, tab, title]);

  const columns: Column<typeof rows extends (infer R)[] | null ? R : never>[] = [
    { key: 'number', header: 'Number', cell: (row) => row.number ?? 'Draft' },
    { key: 'customer', header: 'Customer', cell: (row) => row.customerName },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <Badge tone={tone(row.statusLabel)}>{row.statusLabel}</Badge>,
    },
    { key: 'total', header: 'Total', cell: (row) => row.total.label },
  ];

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={canEdit ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {kind === 'invoice' ? (
              <Button variant="secondary" onClick={() => navigate('/invoices/reminders')}>Debtor Reminders</Button>
            ) : null}
            <Button onClick={() => navigate(href)}>{action}</Button>
          </div>
        ) : undefined}
      />
      <TabsBar
        value={tab}
        onValueChange={setTab}
        tabs={tabs.map((item) => ({ value: item, label: item }))}
      />
      {error ? (
        <Card>
          <p>{error}</p>
        </Card>
      ) : null}
      {rows ? (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          query={query}
          onQueryChange={setQuery}
          searchPlaceholder="Search"
          emptyTitle={`No ${title}`}
          emptyBody="Nothing matches this filter."
          onRow={(row) => navigate(kind === 'quote' ? `/quotes/${row.id}` : `/invoices/${row.id}`)}
        />
      ) : null}
    </>
  );
}

export function DebtorRemindersScreen({ navigate }: { navigate: Navigate }) {
  type Reminder = {
    id: string;
    reminder_stage: string;
    status: string;
    recipient_email: string;
    subject: string;
    message: string;
    queued_at: string;
    invoice_number: string;
    customer_name: string;
    due_on: string;
  };
  const [rows, setRows] = useState<Reminder[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { status, body } = await api('/sales/reminders');
    if (status === 401) { navigate('/login'); return; }
    if (status !== 200 || !body || typeof body !== 'object' || !('reminders' in body)) {
      setError(errorMessage(body, 'Debtor reminders did not load.'));
      return;
    }
    setRows((body as { reminders: Reminder[] }).reminders);
    setError('');
  }, [navigate]);

  useEffect(() => { void load(); }, [load]);

  async function generate() {
    setBusy(true);
    const { status, body } = await api('/sales/reminders/generate', { method: 'POST', body: '{}' });
    setBusy(false);
    if (status !== 200) { setError(errorMessage(body, 'Reminders could not be generated.')); return; }
    await load();
  }

  async function markSent(id: string) {
    setBusy(true);
    const { status, body } = await api(`/sales/reminders/${id}/sent`, { method: 'POST', body: '{}' });
    setBusy(false);
    if (status !== 200) { setError(errorMessage(body, 'Reminder could not be updated.')); return; }
    await load();
  }

  return (
    <>
      <PageHeader
        title="Debtor Reminders"
        description="Generate an auditable queue for overdue invoices. Review and send each message using your normal email process, then mark it sent."
        actions={<Button disabled={busy} onClick={() => void generate()}>{busy ? 'Working…' : 'Generate Reminders'}</Button>}
      />
      {error ? <Card><p>{error}</p></Card> : null}
      <Card title="Reminder Queue">
        <DataTable
          rows={rows}
          columns={[
            { key: 'invoice', header: 'Invoice', cell: (row) => row.invoice_number },
            { key: 'customer', header: 'Customer', cell: (row) => row.customer_name },
            { key: 'stage', header: 'Stage', cell: (row) => row.reminder_stage },
            { key: 'recipient', header: 'Email', cell: (row) => row.recipient_email || 'No email on file' },
            { key: 'status', header: 'Status', cell: (row) => <Badge tone={row.status === 'sent' ? 'ok' : 'warn'}>{row.status}</Badge> },
            { key: 'action', header: 'Action', cell: (row) => row.status === 'queued' ? <Button variant="secondary" disabled={busy} onClick={() => void markSent(row.id)}>Mark sent</Button> : '—' },
          ]}
          getRowId={(row) => row.id}
          emptyTitle="No Reminders Queued"
          emptyBody="Generate reminders to find overdue invoices with an outstanding balance."
        />
      </Card>
      {rows.filter((row) => row.status === 'queued').map((row) => (
        <Card key={row.id} title={`${row.subject} · ${row.customer_name}`}>
          <p>To: {row.recipient_email || 'No email address on file'}</p>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{row.message}</pre>
        </Card>
      ))}
    </>
  );
}

export function StatementScreen({
  navigate,
  customerId,
}: {
  navigate: Navigate;
  customerId: string;
}) {
  const [statement, setStatement] = useState<{
    customer: { name: string; vatNumber: string; address: string };
    asAt: string;
    openItems: {
      id: string;
      number: string;
      issuedOn: string;
      dueOn: string | null;
      balance: string;
      statusLabel: string;
      ageDays: number;
    }[];
    aging: { current: string; days30: string; days60: string; days90: string; total: string };
  } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void api(`/sales/customers/${customerId}/statement`).then(({ status, body }) => {
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object' || !('openItems' in body)) {
        setError(errorMessage(body, 'The statement did not load.'));
        return;
      }
      setStatement(body as NonNullable<typeof statement>);
    });
  }, [customerId, navigate]);

  if (!statement) {
    return error ? (
      <Card>
        <p>{error}</p>
      </Card>
    ) : null;
  }

  return (
    <>
      <PageHeader
        title="Customer Statement"
        description={`${statement.customer.name} · ${formatSaDate(statement.asAt)}`}
      />
      <Card title="Aging">
        <p>Current {statement.aging.current}</p>
        <p>30 Days {statement.aging.days30}</p>
        <p>60 Days {statement.aging.days60}</p>
        <p>90 Days And Over {statement.aging.days90}</p>
        <p>Total {statement.aging.total}</p>
      </Card>
      <DataTable
        rows={statement.openItems}
        columns={[
          { key: 'number', header: 'Invoice', cell: (row) => row.number },
          { key: 'issued', header: 'Date', cell: (row) => formatSaDate(row.issuedOn) },
          { key: 'due', header: 'Due', cell: (row) => (row.dueOn ? formatSaDate(row.dueOn) : '') },
          {
            key: 'status',
            header: 'Status',
            cell: (row) => <Badge tone={tone(row.statusLabel)}>{row.statusLabel}</Badge>,
          },
          { key: 'balance', header: 'Balance', cell: (row) => row.balance },
        ]}
        getRowId={(row) => row.id}
        emptyTitle="Nothing Open"
        emptyBody="This customer has no open tax invoices."
        onRow={(row) => navigate(`/invoices/${row.id}`)}
      />
    </>
  );
}

export function salesScreen(path: string, navigate: Navigate) {
  if (path === '/customers') {
    return <CustomersScreen navigate={navigate} />;
  }
  if (path === '/customers/new') {
    return <CustomerScreen navigate={navigate} customerId={null} />;
  }
  const statement = /^\/customers\/([0-9a-f-]{36})\/statement$/i.exec(path);
  if (statement?.[1]) {
    return <StatementScreen navigate={navigate} customerId={statement[1]} />;
  }
  const customer = /^\/customers\/([0-9a-f-]{36})$/i.exec(path);
  if (customer?.[1]) {
    return <CustomerScreen navigate={navigate} customerId={customer[1]} />;
  }
  if (path === '/quotes') {
    return <QuotesScreen navigate={navigate} />;
  }
  if (path === '/quotes/new') {
    return <DocumentScreen navigate={navigate} kind="quote" documentId={null} />;
  }
  const quote = /^\/quotes\/([0-9a-f-]{36})$/i.exec(path);
  if (quote?.[1]) {
    return <DocumentScreen navigate={navigate} kind="quote" documentId={quote[1]} />;
  }
  if (path === '/invoices') {
    return <InvoicesScreen navigate={navigate} />;
  }
  if (path === '/invoices/reminders') {
    return <DebtorRemindersScreen navigate={navigate} />;
  }
  if (path === '/invoices/new') {
    return <DocumentScreen navigate={navigate} kind="invoice" documentId={null} />;
  }
  const payment = /^\/invoices\/([0-9a-f-]{36})\/payment$/i.exec(path);
  if (payment?.[1]) {
    return <PaymentScreen navigate={navigate} invoiceId={payment[1]} />;
  }
  const credit = /^\/invoices\/([0-9a-f-]{36})\/credit$/i.exec(path);
  if (credit?.[1]) {
    return <CreditScreen navigate={navigate} invoiceId={credit[1]} />;
  }
  const invoice = /^\/invoices\/([0-9a-f-]{36})$/i.exec(path);
  if (invoice?.[1]) {
    return <DocumentScreen navigate={navigate} kind="invoice" documentId={invoice[1]} />;
  }
  return null;
}
