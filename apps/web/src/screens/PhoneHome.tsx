import { johannesburgToday } from '@omnivate/shared';
import { Skeleton, usePhoneTools } from '@omnivate/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type Navigate } from '../api';
import { NotificationBell } from '../NotificationBell';

type StockCard = {
  stockValueLabel: string | null;
  lowStockCount: number | null;
  catalogCount: number;
  recent: {
    id: string;
    itemId: string;
    itemName: string;
    what: string;
    whenLabel: string;
    valueLabel: string | null;
  }[];
};

type QuoteRow = {
  id: string;
  number: string | null;
  customerName: string;
  statusLabel: string;
  total: { label: string };
};

type InvoiceRow = {
  id: string;
  number: string;
  customerName: string;
  statusLabel: string;
  issuedOn: string | null;
  total: { label: string };
};

type Activity = {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  tone: 'ok' | 'warn' | 'bad';
  href: string;
};

function firstName(name: string): string {
  const part = name.trim().split(/\s+/)[0];
  return part || 'there';
}

function toneFor(status: string): Activity['tone'] {
  const label = status.toLowerCase();
  if (/(paid|accepted|received)/.test(label)) return 'ok';
  if (/(overdue|declined|wrote off|rejected)/.test(label)) return 'bad';
  return 'warn';
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <span className="ui-soft-icon" aria-hidden="true">
      {children}
    </span>
  );
}

function DocIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24">
      <path
        d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path d="M14 3v6h6" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24">
      <path
        d="M3 8l9-4 9 4-9 4-9-4zM3 8v8l9 4 9-4V8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24">
      <path
        d="M4 8h3l2-2h6l2 2h3v11H4V8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="3" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function PhoneHome({
  navigate,
  personName,
  companyName,
  city,
  salesOn,
  stockOn,
}: {
  navigate: Navigate;
  personName: string;
  companyName: string;
  city: string | null;
  salesOn: boolean;
  stockOn: boolean;
}) {
  const tools = usePhoneTools();
  const [stock, setStock] = useState<StockCard | null>(null);
  const [quotes, setQuotes] = useState<QuoteRow[] | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const initial = (
    personName.trim().charAt(0) ||
    companyName.trim().charAt(0) ||
    'O'
  ).toUpperCase();

  useEffect(() => {
    if (!stockOn) return;
    void api('/scm/dashboard').then(({ status, body }) => {
      if (status === 200 && body && typeof body === 'object') {
        setStock(body as StockCard);
      }
    });
  }, [stockOn]);

  useEffect(() => {
    if (!salesOn) return;
    void api('/sales/quotes').then(({ status, body }) => {
      if (status === 200 && body && typeof body === 'object' && 'quotes' in body) {
        setQuotes((body as { quotes: QuoteRow[] }).quotes);
      } else {
        setQuotes([]);
      }
    });
    void api('/sales/invoices').then(({ status, body }) => {
      if (status === 200 && body && typeof body === 'object' && 'invoices' in body) {
        setInvoices((body as { invoices: InvoiceRow[] }).invoices);
      } else {
        setInvoices([]);
      }
    });
  }, [salesOn]);

  const month = johannesburgToday().slice(0, 7);
  const invoicesThisMonth = (invoices ?? []).filter((row) =>
    (row.issuedOn ?? '').startsWith(month),
  ).length;
  const quotesOpen = (quotes ?? []).filter(
    (row) => !['Accepted', 'Declined', 'Expired'].includes(row.statusLabel),
  ).length;

  const activity: Activity[] = [
    ...(invoices ?? []).slice(0, 4).map((row) => ({
      id: `inv-${row.id}`,
      title: row.number,
      subtitle: row.customerName,
      status: row.statusLabel,
      tone: toneFor(row.statusLabel),
      href: `/invoices/${row.id}`,
    })),
    ...(quotes ?? []).slice(0, 3).map((row) => ({
      id: `quo-${row.id}`,
      title: row.number ?? 'Draft Quote',
      subtitle: row.customerName,
      status: row.statusLabel,
      tone: toneFor(row.statusLabel),
      href: `/quotes/${row.id}`,
    })),
    ...(stock?.recent ?? []).slice(0, 3).map((row) => ({
      id: `stk-${row.id}`,
      title: row.itemName,
      subtitle: row.whenLabel,
      status: row.what,
      tone: toneFor(row.what),
      href: `/stock/items/${row.itemId}`,
    })),
  ].slice(0, 6);

  const actions: { label: string; href: string; icon: ReactNode }[] = [
    { label: 'Snap Document', href: '/scan', icon: <CameraIcon /> },
  ];
  if (salesOn) {
    actions.unshift(
      { label: 'New Invoice', href: '/invoices/new', icon: <DocIcon /> },
      { label: 'New Quote', href: '/quotes/new', icon: <DocIcon /> },
    );
  }
  if (stockOn) {
    actions.splice(salesOn ? 2 : 0, 0, {
      label: 'Receive Stock',
      href: '/stock/receive',
      icon: <BoxIcon />,
    });
  }

  return (
    <div className="ui-phone-home">
      <header className="ui-greet">
        <div>
          <h1>Hi, {firstName(personName)}</h1>
          <p>Welcome back</p>
        </div>
        <span className="ui-greet-tools">
          <button
            type="button"
            className="ui-icon-hit"
            aria-label="Search"
            onClick={tools.openSearch}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </button>
          <NotificationBell icon />
          <button
            type="button"
            className="ui-icon-hit"
            aria-label="Account"
            onClick={tools.openAccount}
          >
            <span className="ui-avatar">{initial}</span>
          </button>
        </span>
      </header>

      <button
        type="button"
        className="ui-hero"
        onClick={() => navigate(salesOn ? '/quotes' : '/stock')}
      >
        <span>
          <small>Company</small>
          <strong>{companyName}</strong>
          <em>{city ? city : 'Your business, in your pocket.'}</em>
          <span className="ui-hero-go">{salesOn ? 'Open Sales' : 'Open Stock'}</span>
        </span>
      </button>

      {actions.length > 0 ? (
        <section className="ui-quick-wrap">
          <h2>Quick Actions</h2>
          <div className="ui-quick">
            {actions.slice(0, 4).map((action) => (
              <button key={action.label} type="button" onClick={() => navigate(action.href)}>
                <Icon>{action.icon}</Icon>
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="ui-soft-stats">
        {salesOn ? (
          <button type="button" className="ui-soft-card" onClick={() => navigate('/invoices')}>
            <Icon>
              <DocIcon />
            </Icon>
            <strong>{invoices === null ? '—' : invoicesThisMonth}</strong>
            <span>Invoices This Month</span>
          </button>
        ) : null}
        {salesOn ? (
          <button type="button" className="ui-soft-card" onClick={() => navigate('/quotes')}>
            <Icon>
              <DocIcon />
            </Icon>
            <strong>{quotes === null ? '—' : quotesOpen}</strong>
            <span>Quotes Open</span>
          </button>
        ) : null}
        {stockOn ? (
          <button type="button" className="ui-soft-card" onClick={() => navigate('/stock/low')}>
            <Icon>
              <BoxIcon />
            </Icon>
            <strong>{stock ? (stock.lowStockCount ?? '—') : '—'}</strong>
            <span>Low Stock</span>
          </button>
        ) : null}
        {stockOn ? (
          <button type="button" className="ui-soft-card" onClick={() => navigate('/stock')}>
            <Icon>
              <BoxIcon />
            </Icon>
            <strong>{stock?.stockValueLabel ?? '—'}</strong>
            <span>Stock Value</span>
          </button>
        ) : null}
        {salesOn && invoices === null && quotes === null ? <Skeleton lines={2} /> : null}
      </section>

      <section className="ui-activity">
        <h2>Recent Activity</h2>
        {activity.length === 0 ? (
          <p className="ui-hint">New invoices, quotes, and stock movements show up here.</p>
        ) : (
          <ul>
            {activity.map((row) => (
              <li key={row.id}>
                <button type="button" onClick={() => navigate(row.href)}>
                  <Icon>
                    <DocIcon />
                  </Icon>
                  <span className="ui-activity-copy">
                    <strong>{row.title}</strong>
                    <small>{row.subtitle}</small>
                  </span>
                  <em className={`is-${row.tone}`}>{row.status}</em>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
