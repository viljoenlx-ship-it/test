import { Badge, Button, DataTable, PageHeader } from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api, errorMessage, type Navigate } from '../../api';
import type { StockRow } from './types';

export function LowStockScreen({ navigate }: { navigate: Navigate }) {
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/scm/low-stock').then(({ status, body }) => {
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object') {
        setError(errorMessage(body, 'The low-stock list did not load.'));
        setRows([]);
        return;
      }
      setRows((body as { items: StockRow[] }).items);
    });
  }, [navigate]);

  return (
    <>
      <PageHeader
        title="Low Stock"
        description="Items at or under the quantity you asked to be warned about."
        breadcrumbs={[{ label: 'Stock', href: '/stock' }, { label: 'Low Stock' }]}
        onNavigate={navigate}
        actions={<Button onClick={() => navigate('/stock/receive')}>Receive Stock</Button>}
      />
      {error ? <p className="ui-error">{error}</p> : null}
      {rows ? (
        <DataTable
          rows={rows}
          getRowId={(row) => row.id}
          onRow={(row) => navigate(`/stock/items/${row.id}`)}
          emptyTitle="Nothing is running low"
          emptyBody="When an item falls to its reorder level, it will show up here."
          columns={[
            {
              key: 'name',
              header: 'Item',
              cell: (row) => (
                <span>
                  {row.name} <Badge tone="warn">Low</Badge>
                </span>
              ),
            },
            { key: 'onHand', header: 'On hand', cell: (row) => row.onHandLabel ?? '—' },
            { key: 'code', header: 'Code', cell: (row) => row.code },
          ]}
        />
      ) : null}
    </>
  );
}

export function ValuationScreen({ navigate }: { navigate: Navigate }) {
  const [lines, setLines] = useState<
    | { id: string; name: string; onHandLabel: string; costLabel: string; valueLabel: string }[]
    | null
  >(null);
  const [total, setTotal] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api('/scm/valuation').then(({ status, body }) => {
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status === 403) {
        setError('Your role can see quantities, not the stock value.');
        setLines([]);
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object') {
        setError(errorMessage(body, 'The stock value report did not load.'));
        setLines([]);
        return;
      }
      const payload = body as { lines: NonNullable<typeof lines>; totalLabel: string };
      setLines(payload.lines);
      setTotal(payload.totalLabel);
    });
  }, [navigate]);

  return (
    <>
      <PageHeader
        title="Stock Value"
        description="What the stock on hand is worth, at average cost, excluding VAT."
        breadcrumbs={[{ label: 'Stock', href: '/stock' }, { label: 'Stock Value' }]}
        onNavigate={navigate}
      />
      {error ? <p className="ui-error">{error}</p> : null}
      {total ? (
        <p>
          <strong>{total}</strong> on hand
        </p>
      ) : null}
      {lines ? (
        <DataTable
          rows={lines}
          getRowId={(row) => row.id}
          onRow={(row) => navigate(`/stock/items/${row.id}`)}
          emptyTitle="No stock value yet"
          emptyBody="Receive stock and the value will show here."
          columns={[
            { key: 'name', header: 'Item', cell: (row) => row.name },
            { key: 'onHand', header: 'On hand', cell: (row) => row.onHandLabel },
            { key: 'cost', header: 'Average cost', cell: (row) => row.costLabel },
            { key: 'value', header: 'Value', cell: (row) => row.valueLabel },
          ]}
        />
      ) : null}
    </>
  );
}
