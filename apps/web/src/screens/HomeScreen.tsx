import {
  isHealthResponse,
  moduleAvailability,
  moduleIndex,
  type HealthResponse,
} from '@omnivate/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton, usePhone } from '@omnivate/ui';
import { PhoneHome } from './PhoneHome';
import { useEffect, useState } from 'react';
import { api, type Navigate } from '../api';

type HealthState =
  { kind: 'loading' } | { kind: 'ready'; health: HealthResponse } | { kind: 'unreachable' };

type StockCard = {
  stockValueLabel: string | null;
  lowStockCount: number | null;
  catalogCount: number;
  pendingAdjustments: number | null;
  recent: {
    id: string;
    itemId: string;
    itemName: string;
    what: string;
    branch: string;
    whenLabel: string;
    valueLabel: string | null;
  }[];
};

export function HomeScreen({
  navigate,
  signedIn,
  modules = [],
  documentsOn = false,
  personName = '',
  companyName = 'Omnivate',
  city = null,
}: {
  navigate: Navigate;
  signedIn: boolean;
  modules?: readonly string[];
  documentsOn?: boolean;
  personName?: string;
  companyName?: string;
  city?: string | null;
}) {
  const [state, setState] = useState<HealthState>({ kind: 'loading' });
  const [stock, setStock] = useState<StockCard | null>(null);
  const [stockHidden, setStockHidden] = useState(false);

  useEffect(() => {
    if (!signedIn) {
      return;
    }
    let cancel = false;
    api('/scm/dashboard').then(({ status, body }) => {
      if (cancel) {
        return;
      }
      if (status === 403) {
        setStockHidden(true);
        return;
      }
      if (status === 200 && body && typeof body === 'object') {
        setStock(body as StockCard);
      }
    });
    return () => {
      cancel = true;
    };
  }, [signedIn]);

  useEffect(() => {
    let cancelled = false;
    api('/health')
      .then(({ body }) => {
        if (!isHealthResponse(body)) {
          throw new Error('Health payload did not match the contract.');
        }
        if (!cancelled) {
          setState({ kind: 'ready', health: body });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ kind: 'unreachable' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const label =
    state.kind === 'loading'
      ? 'Checking…'
      : state.kind === 'unreachable'
        ? 'We can’t reach Omnivate right now'
        : state.health.status === 'ok'
          ? 'Everything is running'
          : 'Something needs attention';

  const tone =
    state.kind === 'ready' && state.health.status === 'ok'
      ? 'ok'
      : state.kind === 'loading'
        ? 'info'
        : 'bad';

  const phone = usePhone();

  if (signedIn && phone) {
    const ready = moduleIndex().filter((entry) => moduleAvailability(entry, modules) === 'ready');
    return (
      <PhoneHome
        navigate={navigate}
        personName={personName}
        companyName={companyName}
        city={city}
        salesOn={ready.some((entry) => entry.id === 'SAL-01' || entry.id === 'FIN-02')}
        stockOn={ready.some((entry) => entry.id === 'SCM-01') && !stockHidden}
      />
    );
  }

  if (signedIn) {
    const ready = moduleIndex().filter((entry) => moduleAvailability(entry, modules) === 'ready');
    const stockOn = ready.some((entry) => entry.id === 'SCM-01') && !stockHidden;
    const contactsOn = ready.some((entry) => entry.id === 'KRN-02');
    const reportsOn = ready.some((entry) => entry.id === 'ANA-03');
    return (
      <>
        <PageHeader
          title="Today"
          description="A short look at what is open for this company, and the shortcuts you use most."
          actions={
            phone ? undefined : stockOn ? (
              <Button onClick={() => navigate('/stock/receive')}>Receive Stock</Button>
            ) : contactsOn ? (
              <Button onClick={() => navigate('/contacts/new')}>New Contact</Button>
            ) : undefined
          }
        />
        <div className="ui-actions ui-shortcut-row">
          {contactsOn && stockOn ? (
            <Button variant="secondary" onClick={() => navigate('/contacts/new')}>
              New Contact
            </Button>
          ) : null}
          {stockOn ? (
            <Button variant="secondary" onClick={() => navigate('/stock')}>
              Open Stock
            </Button>
          ) : null}
          {documentsOn ? (
            <Button variant="secondary" onClick={() => navigate('/documents')}>
              Documents
            </Button>
          ) : null}
          {reportsOn ? (
            <Button variant="secondary" onClick={() => navigate('/reports/new')}>
              New Report
            </Button>
          ) : null}
        </div>
        <div style={{ height: 16 }} />
        {stockOn && !stock ? <Skeleton lines={3} /> : null}
        {stockOn && stock ? (
          <div className="ui-grid stats">
            <button type="button" className="ui-stat-button" onClick={() => navigate('/stock')}>
              <div className="ui-card">
                <div className="ui-stat">
                  <strong>{stock.catalogCount}</strong>
                  <span>Catalog Items</span>
                </div>
              </div>
            </button>
            <button
              type="button"
              className="ui-stat-button"
              onClick={() => navigate(stock.lowStockCount !== null ? '/stock/low' : '/stock')}
            >
              <div className="ui-card">
                <div className="ui-stat">
                  <strong>{stock.lowStockCount ?? '—'}</strong>
                  <span>{stock.lowStockCount === null ? 'Low stock is hidden' : 'Low Stock'}</span>
                </div>
              </div>
            </button>
            <button
              type="button"
              className="ui-stat-button"
              onClick={() => navigate(stock.stockValueLabel ? '/stock/value' : '/stock')}
            >
              <div className="ui-card">
                <div className="ui-stat">
                  <strong>{stock.stockValueLabel ?? '—'}</strong>
                  <span>{stock.stockValueLabel ? 'Stock Value' : 'Value is hidden'}</span>
                </div>
              </div>
            </button>
          </div>
        ) : null}
        {ready.length > 0 ? (
          <div className="ui-module-tiles">
            {ready.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="ui-stat-button"
                onClick={() => navigate(entry.href)}
              >
                <div className="ui-card">
                  <strong>{entry.name}</strong>
                  <p className="ui-hint">{entry.summary}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <Card title="Your Sections">
            <p>Nothing is switched on for your role yet.</p>
          </Card>
        )}
        {stockOn ? (
          <Card title="Recent Stock">
            {stock && stock.recent.length > 0 && phone ? (
              <ul className="ui-record-list">
                {stock.recent.map((row) => (
                  <li key={row.id} className="ui-record">
                    <button
                      type="button"
                      className="ui-record-hit"
                      onClick={() => navigate(`/stock/items/${row.itemId}`)}
                    >
                      <span className="ui-record-main">
                        <span className="ui-record-title">{row.itemName}</span>
                        <span className="ui-record-meta">
                          <span>{row.what}</span>
                          <span>{row.whenLabel}</span>
                        </span>
                      </span>
                      {row.valueLabel ? (
                        <span className="ui-record-value">{row.valueLabel}</span>
                      ) : null}
                      <span className="ui-record-chevron" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : stock && stock.recent.length > 0 ? (
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>What Happened</th>
                      <th>Branch</th>
                      <th>Date</th>
                      {stock.stockValueLabel ? <th>Value</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {stock.recent.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <button
                            type="button"
                            className="ui-text-link"
                            onClick={() => navigate(`/stock/items/${row.itemId}`)}
                          >
                            {row.itemName}
                          </button>
                        </td>
                        <td>{row.what}</td>
                        <td>{row.branch}</td>
                        <td>{row.whenLabel}</td>
                        {stock.stockValueLabel ? <td>{row.valueLabel ?? '—'}</td> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="Nothing has moved yet"
                body="Receive stock and the latest movements will show up here."
                action={
                  <Button variant="secondary" onClick={() => navigate('/stock/receive')}>
                    Receive Stock
                  </Button>
                }
              />
            )}
          </Card>
        ) : null}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Omnivate"
        description="Sign in to work in your company."
        actions={
          <>
            <Button onClick={() => navigate('/login')}>Sign In</Button>
            <Button variant="secondary" onClick={() => navigate('/users')}>
              People
            </Button>
          </>
        }
      />
      <Card title="Status">
        {state.kind === 'loading' ? <Skeleton lines={2} /> : null}
        <p>
          <Badge tone={tone}>
            <span role="status">{label}</span>
          </Badge>
        </p>
        {state.kind === 'unreachable' ? (
          <p className="ui-hint">Check your connection, then try again.</p>
        ) : null}
      </Card>
    </>
  );
}
