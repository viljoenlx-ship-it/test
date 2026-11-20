import { columnHeading, orderColumns } from '@omnivate/shared';
import {
  Badge,
  Button,
  DataTable,
  PageHeader,
  TabsBar,
  TextField,
  usePhone,
  type Column,
} from '@omnivate/ui';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage, type Navigate } from '../../api';
import { useWorkspace } from '../../workspace';
import { SnapButton } from '../documents/SnapButton';
import { createScanBuffer, playScanTone } from './scan-feedback';
import type { Access, StockRow } from './types';

export function StockListScreen({ navigate }: { navigate: Navigate }) {
  const phone = usePhone();
  const { layouts } = useWorkspace();
  const [summary, setSummary] = useState<{
    catalogCount: number;
    lowStockCount: number | null;
    stockValueLabel: string | null;
  } | null>(null);
  const [filter, setFilter] = useState<'active' | 'low' | 'archived'>('active');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [error, setError] = useState('');
  const [scanFlash, setScanFlash] = useState<'ok' | 'bad' | ''>('');
  const scans = useRef(createScanBuffer());

  useEffect(() => {
    void api('/scm/dashboard').then(({ status, body }) => {
      if (status === 200 && body && typeof body === 'object' && 'catalogCount' in body) {
        setSummary(
          body as {
            catalogCount: number;
            lowStockCount: number | null;
            stockValueLabel: string | null;
          },
        );
      }
    });
  }, []);

  useEffect(() => {
    let cancel = false;
    const params = new URLSearchParams({ filter, q: query });
    api(`/scm/items?${params.toString()}`).then(({ status, body }) => {
      if (cancel) {
        return;
      }
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object') {
        setError(errorMessage(body, 'Stock did not load.'));
        setRows([]);
        return;
      }
      const payload = body as { items: StockRow[]; access: Access };
      setRows(payload.items);
      setAccess(payload.access);
      setError('');
    });
    return () => {
      cancel = true;
    };
  }, [filter, query, navigate]);

  const showQty = access?.canSeeQuantities !== false;
  const showValue = access?.canSeeCosts === true;

  return (
    <>
      <PageHeader
        title="Stock"
        description="Search the catalog, or scan a barcode."
        actions={
          <div className="ui-actions">
            <SnapButton navigate={navigate} variant="secondary" />
            {access?.canOperate ? (
              <Button onClick={() => navigate('/stock/receive')}>Receive Stock</Button>
            ) : access?.canEdit && !phone ? (
              <Button onClick={() => navigate('/stock/new')}>Add An Item</Button>
            ) : null}
          </div>
        }
      />
      {summary ? (
        <div className="ui-grid stats">
          <div className="ui-card">
            <div className="ui-stat">
              <strong>{summary.catalogCount}</strong>
              <span>Catalog Items</span>
            </div>
          </div>
          <div className="ui-card">
            <div className="ui-stat">
              <strong>{summary.lowStockCount ?? '—'}</strong>
              <span>{summary.lowStockCount === null ? 'Low Stock Is Hidden' : 'Low Stock'}</span>
            </div>
          </div>
          <div className="ui-card">
            <div className="ui-stat">
              <strong>{summary.stockValueLabel ?? '—'}</strong>
              <span>{summary.stockValueLabel ? 'Stock Value' : 'Value Is Hidden'}</span>
            </div>
          </div>
        </div>
      ) : null}
      {error ? <p className="ui-error">{error}</p> : null}
      <div className={scanFlash ? `scan-ready is-${scanFlash}` : 'scan-ready'}>
        <TextField
          label="Search"
          value={query}
          onChange={setQuery}
          placeholder="Name, item code, or barcode"
          autoFocus={!phone}
          autoComplete="off"
          onKeyDown={(event) => {
            const result = scans.current.push(event.key);
            if (event.key !== 'Enter' || !rows) {
              return;
            }
            const needle = event.currentTarget.value.trim().toLowerCase();
            const match = rows.find(
              (row) => row.barcode.toLowerCase() === needle || row.code.toLowerCase() === needle,
            );
            if (match) {
              if (result.burst) {
                setScanFlash('ok');
                playScanTone(true);
              }
              navigate(`/stock/items/${match.id}`);
              return;
            }
            if (result.burst) {
              setScanFlash('bad');
              playScanTone(false);
              window.setTimeout(() => setScanFlash(''), 400);
            }
          }}
        />
      </div>
      <TabsBar
        value={filter}
        onValueChange={(value) => setFilter(value as 'active' | 'low' | 'archived')}
        tabs={[
          { value: 'active', label: 'In The Catalog' },
          { value: 'low', label: 'Low Stock' },
          { value: 'archived', label: 'Archived' },
        ]}
      />
      <div style={{ height: 12 }} />
      {rows ? (
        <DataTable
          rows={rows}
          getRowId={(row) => row.id}
          onRow={(row) => navigate(`/stock/items/${row.id}`)}
          emptyTitle={filter === 'low' ? 'Nothing is running low' : 'No items yet'}
          emptyBody={
            filter === 'low'
              ? 'Items show up here when what you have is at or under the reorder level.'
              : 'Add the first thing this company sells or keeps on the shelf.'
          }
          emptyAction={
            access?.canEdit ? (
              <Button onClick={() => navigate('/stock/new')}>Add An Item</Button>
            ) : undefined
          }
          columns={orderColumns(
            [
              {
                key: 'name',
                header: columnHeading('stock', 'name', layouts),
                sortValue: (row: StockRow) => row.name,
                text: (row: StockRow) =>
                  `${row.name}${row.low ? ', low' : ''}${row.archived ? ', archived' : ''}`,
                cell: (row: StockRow) => (
                  <span>
                    {row.name} {row.low ? <Badge tone="warn">Low</Badge> : null}{' '}
                    {row.archived ? <Badge tone="neutral">Archived</Badge> : null}
                  </span>
                ),
              },
              {
                key: 'code',
                header: columnHeading('stock', 'code', layouts),
                sortValue: (row: StockRow) => row.code,
                text: (row: StockRow) => row.code,
                phone: 'detail' as const,
                cell: (row: StockRow) => row.code,
              },
              ...(showQty
                ? [
                    {
                      key: 'onHand',
                      header: columnHeading('stock', 'onHand', layouts),
                      text: (row: StockRow) => row.onHandLabel ?? '—',
                      phone: 'value' as const,
                      cell: (row: StockRow) => row.onHandLabel ?? '—',
                    },
                  ]
                : []),
              ...(showValue
                ? [
                    {
                      key: 'value',
                      header: columnHeading('stock', 'value', layouts),
                      text: (row: StockRow) => row.valueLabel ?? '—',
                      phone: 'hide' as const,
                      cell: (row: StockRow) => row.valueLabel ?? '—',
                    },
                  ]
                : []),
              {
                key: 'price',
                header: columnHeading('stock', 'price', layouts),
                text: (row: StockRow) => row.priceLabel,
                phone: 'detail' as const,
                cell: (row: StockRow) => row.priceLabel,
              },
            ] satisfies Column<StockRow>[],
            layouts.stock,
          )}
        />
      ) : null}
      {access?.canEdit && access.canOperate && !phone ? (
        <p>
          <Button variant="secondary" onClick={() => navigate('/stock/new')}>
            Add An Item
          </Button>
        </p>
      ) : null}
    </>
  );
}
