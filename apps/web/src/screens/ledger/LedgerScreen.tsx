import { formatSaDate } from '@omnivate/shared';
import {
  Badge,
  Button,
  Card,
  DataTable,
  DialogFrame,
  Form,
  PageHeader,
  SelectField,
  Skeleton,
  TabsBar,
  TextField,
  useToast,
} from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { API_BASE, api, errorMessage, type Navigate } from '../../api';

type MoneyCell = { cents: string; label: string } | null;

type Account = {
  id: string;
  code: string;
  name: string;
  category: string;
  categoryLabel: string;
  system: boolean;
  active: boolean;
  balance: { cents: string; label: string };
};

type Journal = {
  id: string;
  number: string;
  date: string;
  memo: string;
  total: { label: string };
  reverses: boolean;
};

type Trial = {
  title: string;
  from: string;
  to: string;
  lines: { id: string; code: string; name: string; debit: MoneyCell; credit: MoneyCell }[];
  debit: { label: string };
  credit: { label: string };
  balanced: boolean;
};

type StatementLine = { id: string | null; name: string; amount: { label: string } };

type Income = {
  from: string;
  to: string;
  income: StatementLine[];
  incomeTotal: { label: string };
  costOfSales: StatementLine[];
  costOfSalesTotal: { label: string };
  grossProfit: { label: string };
  expenses: StatementLine[];
  expenseTotal: { label: string };
  netProfit: { label: string };
};

type Sheet = {
  to: string;
  assets: StatementLine[];
  assetTotal: { label: string };
  liabilities: StatementLine[];
  liabilityTotal: { label: string };
  equity: StatementLine[];
  equityTotal: { label: string };
  balanced: boolean;
};

type Vat = {
  from: string;
  to: string;
  output: { label: string };
  input: { label: string };
  payable: { label: string };
};

type Ledger = {
  title: string;
  code: string;
  name: string;
  from: string;
  to: string;
  lines: {
    id: string;
    date: string;
    number: string;
    memo: string;
    debit: MoneyCell;
    credit: MoneyCell;
    balance: { label: string };
  }[];
  closing: { label: string };
};

const TABS = [
  { value: 'accounts', label: 'Accounts' },
  { value: 'journals', label: 'Journals' },
  { value: 'trial-balance', label: 'Trial Balance' },
  { value: 'income-statement', label: 'Income Statement' },
  { value: 'balance-sheet', label: 'Balance Sheet' },
  { value: 'vat', label: 'VAT' },
];

const CATEGORIES = [
  ['asset', 'Asset'],
  ['liability', 'Liability'],
  ['equity', 'Equity'],
  ['income', 'Income'],
  ['cost_of_sales', 'Cost Of Sales'],
  ['expense', 'Expense'],
] as const;

function money(value: MoneyCell): string {
  return value?.label ?? '';
}

async function downloadReport(
  kind: string,
  format: 'csv' | 'pdf',
  from: string,
  to: string,
  accountId?: string,
) {
  const query = new URLSearchParams({ format, from, to });
  if (accountId) query.set('accountId', accountId);
  const response = await fetch(`${API_BASE}/ledger/reports/${kind}/export?${query.toString()}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    return body?.message ?? 'The file did not download.';
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const match = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '');
  link.href = url;
  link.download = match?.[1] ?? `${kind}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
  return null;
}

export function LedgerScreen({
  navigate,
  tab,
  accountId,
}: {
  navigate: Navigate;
  tab: string;
  accountId: string | null;
}) {
  const notify = useToast();
  const [access, setAccess] = useState<{
    canEdit: boolean;
    canPost: boolean;
    from: string;
    to: string;
  } | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [journals, setJournals] = useState<Journal[] | null>(null);
  const [trial, setTrial] = useState<Trial | null>(null);
  const [income, setIncome] = useState<Income | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [vat, setVat] = useState<Vat | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<Account | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('expense');
  const [journalDate, setJournalDate] = useState('');
  const [memo, setMemo] = useState('');
  const [draftLines, setDraftLines] = useState([
    { key: '1', accountId: '', debit: '', credit: '' },
    { key: '2', accountId: '', debit: '', credit: '' },
  ]);

  useEffect(() => {
    void api('/ledger/access').then(({ status, body }) => {
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object') {
        setError(errorMessage(body, 'The general ledger did not open.'));
        return;
      }
      const next = body as { canEdit: boolean; canPost: boolean; from: string; to: string };
      setAccess(next);
      setFrom(next.from);
      setTo(next.to);
      setJournalDate(next.to);
    });
  }, [navigate]);

  useEffect(() => {
    if (!from || !to) return;
    const query = `from=${from}&to=${to}`;
    if (tab === 'accounts' || tab === 'journals') {
      void api('/ledger/accounts').then(({ body }) => {
        if (body && typeof body === 'object' && 'accounts' in body) {
          setAccounts((body as { accounts: Account[] }).accounts);
        }
      });
    }
    if (tab === 'journals') {
      void api('/ledger/journals').then(({ body }) => {
        if (body && typeof body === 'object' && 'journals' in body) {
          setJournals((body as { journals: Journal[] }).journals);
        }
      });
    }
    if (tab === 'trial-balance') {
      void api(`/ledger/reports/trial-balance?${query}`).then(({ status, body }) => {
        if (status === 200) setTrial(body as Trial);
        else setError(errorMessage(body, 'The trial balance did not load.'));
      });
    }
    if (tab === 'income-statement') {
      void api(`/ledger/reports/income-statement?${query}`).then(({ status, body }) => {
        if (status === 200) setIncome(body as Income);
        else setError(errorMessage(body, 'The income statement did not load.'));
      });
    }
    if (tab === 'balance-sheet') {
      void api(`/ledger/reports/balance-sheet?${query}`).then(({ status, body }) => {
        if (status === 200) setSheet(body as Sheet);
        else setError(errorMessage(body, 'The balance sheet did not load.'));
      });
    }
    if (tab === 'vat') {
      void api(`/ledger/reports/vat?${query}`).then(({ status, body }) => {
        if (status === 200) setVat(body as Vat);
        else setError(errorMessage(body, 'The VAT summary did not load.'));
      });
    }
    if (accountId) {
      void api(`/ledger/reports/ledger?${query}&accountId=${accountId}`).then(
        ({ status, body }) => {
          if (status === 200) setLedger(body as Ledger);
          else setError(errorMessage(body, 'That account did not open.'));
        },
      );
    }
  }, [tab, from, to, accountId]);

  async function saveAccount(event: React.FormEvent) {
    event.preventDefault();
    const path = editor?.id ? `/ledger/accounts/${editor.id}` : '/ledger/accounts';
    const { status, body } = await api(path, {
      method: editor?.id ? 'PATCH' : 'POST',
      body: JSON.stringify({
        code,
        name,
        category: editor?.category ?? category,
        active: editor ? editor.active : true,
      }),
    });
    if (status !== 200 && status !== 201) {
      setError(errorMessage(body, 'The account was not saved.'));
      return;
    }
    setEditor(null);
    notify({ title: 'Account saved' });
    const refreshed = await api('/ledger/accounts');
    if (refreshed.body && typeof refreshed.body === 'object' && 'accounts' in refreshed.body) {
      setAccounts((refreshed.body as { accounts: Account[] }).accounts);
    }
  }

  async function postJournal(event: React.FormEvent) {
    event.preventDefault();
    const { status, body } = await api('/ledger/journals', {
      method: 'POST',
      body: JSON.stringify({
        date: journalDate,
        memo,
        lines: draftLines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
        })),
      }),
    });
    if (status !== 201) {
      setError(errorMessage(body, 'The journal was not posted.'));
      return;
    }
    setMemo('');
    notify({ title: 'Journal posted' });
    const refreshed = await api('/ledger/journals');
    if (refreshed.body && typeof refreshed.body === 'object' && 'journals' in refreshed.body) {
      setJournals((refreshed.body as { journals: Journal[] }).journals);
    }
  }

  async function reverse(id: string) {
    const { status, body } = await api(`/ledger/journals/${id}/reverse`, { method: 'POST' });
    if (status !== 200) {
      setError(errorMessage(body, 'The journal was not reversed.'));
      return;
    }
    notify({ title: 'Journal reversed' });
    const refreshed = await api('/ledger/journals');
    if (refreshed.body && typeof refreshed.body === 'object' && 'journals' in refreshed.body) {
      setJournals((refreshed.body as { journals: Journal[] }).journals);
    }
  }

  const section = accountId ? 'ledger' : tab;

  return (
    <>
      <PageHeader
        title={accountId ? (ledger?.title ?? 'Account') : 'General Ledger'}
        description={
          accountId
            ? 'Every debit and credit on this account.'
            : 'Accounts, journals, and the reports an accountant uses.'
        }
        actions={
          section === 'accounts' && access?.canEdit ? (
            <Button
              onClick={() => {
                setEditor({} as Account);
                setCode('');
                setName('');
                setCategory('expense');
              }}
            >
              Add Account
            </Button>
          ) : null
        }
      />
      {error ? (
        <Card>
          <p>{error}</p>
        </Card>
      ) : null}
      {!accountId ? (
        <TabsBar
          value={tab}
          onValueChange={(value) => navigate(value === 'accounts' ? '/ledger' : `/ledger/${value}`)}
          tabs={TABS}
        />
      ) : (
        <Button variant="ghost" onClick={() => navigate('/ledger/trial-balance')}>
          Back To Trial Balance
        </Button>
      )}
      {section !== 'journals' && section !== 'accounts' ? (
        <div className="ui-doc-head">
          <TextField label="From" type="date" value={from} onChange={setFrom} />
          <TextField label="To" type="date" value={to} onChange={setTo} />
          <Button
            variant="secondary"
            onClick={() => {
              const kind = accountId ? 'ledger' : tab;
              void downloadReport(kind, 'csv', from, to, accountId ?? undefined).then((message) => {
                if (message) setError(message);
              });
            }}
          >
            Export CSV
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const kind = accountId ? 'ledger' : tab;
              void downloadReport(kind, 'pdf', from, to, accountId ?? undefined).then((message) => {
                if (message) setError(message);
              });
            }}
          >
            Export PDF
          </Button>
        </div>
      ) : null}

      {section === 'accounts' ? (
        accounts ? (
          <DataTable
            rows={accounts}
            getRowId={(row) => row.id}
            emptyTitle="No accounts yet"
            emptyBody="Add an account, or open this page again in a moment."
            columns={[
              {
                key: 'code',
                header: 'Code',
                cell: (row) => row.code,
                sortValue: (row) => row.code,
                phone: 'title',
              },
              {
                key: 'name',
                header: 'Account',
                cell: (row) => row.name,
                sortValue: (row) => row.name,
              },
              { key: 'type', header: 'Type', cell: (row) => row.categoryLabel },
              {
                key: 'status',
                header: 'Status',
                cell: (row) => (
                  <Badge tone={row.active ? 'ok' : 'neutral'}>
                    {row.active ? 'Active' : 'Inactive'}
                  </Badge>
                ),
              },
              {
                key: 'balance',
                header: 'Balance',
                cell: (row) => row.balance.label,
                phone: 'value',
              },
              {
                key: 'actions',
                header: '',
                phone: 'hide',
                cell: (row) =>
                  access?.canEdit ? (
                    <Button
                      variant="ghost"
                      onClick={(event) => {
                        event.stopPropagation();
                        setEditor(row);
                        setCode(row.code);
                        setName(row.name);
                        setCategory(row.category);
                      }}
                    >
                      Rename
                    </Button>
                  ) : null,
              },
            ]}
          />
        ) : (
          <Skeleton />
        )
      ) : null}

      {section === 'journals' ? (
        <>
          {access?.canPost ? (
            <Card>
              <Form onSubmit={(event) => void postJournal(event)}>
                <TextField label="Date" type="date" value={journalDate} onChange={setJournalDate} />
                <TextField label="Memo" value={memo} onChange={setMemo} />
                {draftLines.map((line, index) => (
                  <div key={line.key} className="ui-doc-head">
                    <SelectField
                      label={`Account ${index + 1}`}
                      value={line.accountId}
                      onChange={(accountId) =>
                        setDraftLines((current) =>
                          current.map((item) =>
                            item.key === line.key ? { ...item, accountId } : item,
                          ),
                        )
                      }
                    >
                      <option value="">Choose An Account</option>
                      {(accounts ?? [])
                        .filter((account) => account.active)
                        .map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.code} {account.name}
                          </option>
                        ))}
                    </SelectField>
                    <TextField
                      label="Debit"
                      value={line.debit}
                      onChange={(debit) =>
                        setDraftLines((current) =>
                          current.map((item) =>
                            item.key === line.key ? { ...item, debit } : item,
                          ),
                        )
                      }
                    />
                    <TextField
                      label="Credit"
                      value={line.credit}
                      onChange={(credit) =>
                        setDraftLines((current) =>
                          current.map((item) =>
                            item.key === line.key ? { ...item, credit } : item,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setDraftLines((current) => [
                      ...current,
                      { key: crypto.randomUUID(), accountId: '', debit: '', credit: '' },
                    ])
                  }
                >
                  Add Line
                </Button>
                <Button type="submit">Post Journal</Button>
              </Form>
            </Card>
          ) : null}
          {journals ? (
            <DataTable
              rows={journals}
              getRowId={(row) => row.id}
              emptyTitle="No journals yet"
              emptyBody="Issue a tax invoice, receive stock, or post a journal."
              columns={[
                { key: 'number', header: 'Journal', cell: (row) => row.number, phone: 'title' },
                { key: 'date', header: 'Date', cell: (row) => formatSaDate(row.date) },
                { key: 'memo', header: 'Memo', cell: (row) => row.memo },
                { key: 'total', header: 'Amount', cell: (row) => row.total.label, phone: 'value' },
                {
                  key: 'actions',
                  header: '',
                  cell: (row) =>
                    access?.canPost && !row.reverses ? (
                      <Button variant="ghost" onClick={() => void reverse(row.id)}>
                        Reverse
                      </Button>
                    ) : null,
                },
              ]}
            />
          ) : (
            <Skeleton />
          )}
        </>
      ) : null}

      {section === 'trial-balance' ? (
        trial ? (
          <Card>
            <p>
              Balances as at {formatSaDate(trial.to)}.{' '}
              {trial.balanced ? 'The trial balance balances.' : ''}
            </p>
            <DataTable
              rows={trial.lines}
              getRowId={(row) => row.id}
              emptyTitle="Nothing posted yet"
              emptyBody="Journals in this period will show here."
              onRow={(row) => navigate(`/ledger/accounts/${row.id}?from=${from}&to=${to}`)}
              columns={[
                { key: 'code', header: 'Code', cell: (row) => row.code, phone: 'title' },
                { key: 'name', header: 'Account', cell: (row) => row.name },
                { key: 'debit', header: 'Debit', cell: (row) => money(row.debit) },
                {
                  key: 'credit',
                  header: 'Credit',
                  cell: (row) => money(row.credit),
                  phone: 'value',
                },
              ]}
            />
            <p>
              Total debit {trial.debit.label}. Total credit {trial.credit.label}.
            </p>
          </Card>
        ) : (
          <Skeleton />
        )
      ) : null}

      {section === 'income-statement' && income ? (
        <Card>
          <p>
            {formatSaDate(income.from)} to {formatSaDate(income.to)}
          </p>
          <h2>Income</h2>
          {income.income.map((line) => (
            <p key={line.name}>
              {line.name} {line.amount.label}
            </p>
          ))}
          <p>
            <strong>Income {income.incomeTotal.label}</strong>
          </p>
          <h2>Cost Of Sales</h2>
          {income.costOfSales.map((line) => (
            <p key={line.name}>
              {line.name} {line.amount.label}
            </p>
          ))}
          <p>
            <strong>Gross Profit {income.grossProfit.label}</strong>
          </p>
          <h2>Expenses</h2>
          {income.expenses.map((line) => (
            <p key={line.name}>
              {line.name} {line.amount.label}
            </p>
          ))}
          <p>
            <strong>Net Profit {income.netProfit.label}</strong>
          </p>
        </Card>
      ) : null}

      {section === 'balance-sheet' && sheet ? (
        <Card>
          <p>As at {formatSaDate(sheet.to)}</p>
          <h2>Assets</h2>
          {sheet.assets.map((line) => (
            <p key={line.name}>
              {line.name} {line.amount.label}
            </p>
          ))}
          <p>
            <strong>Total Assets {sheet.assetTotal.label}</strong>
          </p>
          <h2>Liabilities</h2>
          {sheet.liabilities.map((line) => (
            <p key={line.name}>
              {line.name} {line.amount.label}
            </p>
          ))}
          <p>
            <strong>Total Liabilities {sheet.liabilityTotal.label}</strong>
          </p>
          <h2>Equity</h2>
          {sheet.equity.map((line) => (
            <p key={line.name}>
              {line.name} {line.amount.label}
            </p>
          ))}
          <p>
            <strong>Total Equity {sheet.equityTotal.label}</strong>
          </p>
        </Card>
      ) : null}

      {section === 'vat' && vat ? (
        <Card>
          <p>
            {formatSaDate(vat.from)} to {formatSaDate(vat.to)}
          </p>
          <p>Output VAT {vat.output.label}</p>
          <p>Input VAT {vat.input.label}</p>
          <p>
            <strong>VAT Payable {vat.payable.label}</strong>
          </p>
        </Card>
      ) : null}

      {section === 'ledger' && ledger ? (
        <Card>
          <DataTable
            rows={ledger.lines}
            getRowId={(row) => row.id}
            emptyTitle="No lines"
            emptyBody="Nothing was posted to this account in the dates you chose."
            columns={[
              {
                key: 'date',
                header: 'Date',
                cell: (row) => formatSaDate(row.date),
                phone: 'title',
              },
              { key: 'number', header: 'Journal', cell: (row) => row.number },
              { key: 'memo', header: 'Memo', cell: (row) => row.memo },
              { key: 'debit', header: 'Debit', cell: (row) => money(row.debit) },
              { key: 'credit', header: 'Credit', cell: (row) => money(row.credit) },
              {
                key: 'balance',
                header: 'Balance',
                cell: (row) => row.balance.label,
                phone: 'value',
              },
            ]}
          />
          <p>Closing balance {ledger.closing.label}</p>
        </Card>
      ) : null}

      <DialogFrame
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        title={editor?.id ? 'Rename Account' : 'Add Account'}
      >
        <Form onSubmit={(event) => void saveAccount(event)}>
          <TextField label="Code" value={code} onChange={setCode} />
          <TextField label="Name" value={name} onChange={setName} />
          {editor?.id ? (
            editor.system ? null : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void api(`/ledger/accounts/${editor.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ code, name, active: !editor.active }),
                  }).then(({ status, body }) => {
                    if (status !== 200) {
                      setError(errorMessage(body, 'The account was not changed.'));
                      return;
                    }
                    setEditor(null);
                    void api('/ledger/accounts').then((refreshed) => {
                      if (
                        refreshed.body &&
                        typeof refreshed.body === 'object' &&
                        'accounts' in refreshed.body
                      ) {
                        setAccounts((refreshed.body as { accounts: Account[] }).accounts);
                      }
                    });
                  });
                }}
              >
                {editor.active ? 'Deactivate' : 'Restore'}
              </Button>
            )
          ) : (
            <SelectField label="Type" value={category} onChange={setCategory}>
              {CATEGORIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
          )}
          <Button type="submit">{editor?.id ? 'Save' : 'Add Account'}</Button>
        </Form>
      </DialogFrame>
    </>
  );
}
