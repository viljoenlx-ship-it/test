import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  Skeleton,
  type Column,
} from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api, errorMessage, type Navigate } from '../../api';
import { saDate } from './format';
import { SnapButton } from './SnapButton';

type Row = {
  id: string;
  status: string;
  statusLabel: string;
  supplierName: string;
  documentNumber: string;
  documentDate: string;
  totalLabel: string;
  receiptItemId: string | null;
  hasReceipt: boolean;
};

function toneFor(status: string): 'info' | 'ok' | 'warn' | 'bad' | 'neutral' {
  if (status === 'posted') return 'ok';
  if (status === 'ready') return 'warn';
  if (status === 'failed') return 'bad';
  if (status === 'reading' || status === 'queued') return 'info';
  return 'neutral';
}

export function DocumentsScreen({ navigate }: { navigate: Navigate }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancel = false;
    void api('/documents').then(({ status, body }) => {
      if (cancel) {
        return;
      }
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object' || !('documents' in body)) {
        setError(errorMessage(body, 'Documents did not load.'));
        setRows([]);
        return;
      }
      setRows((body as { documents: Row[] }).documents);
    });
    return () => {
      cancel = true;
    };
  }, [navigate]);

  const columns: Column<Row>[] = [
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <Badge tone={toneFor(row.status)}>{row.statusLabel}</Badge>,
      text: (row) => row.statusLabel,
    },
    {
      key: 'supplier',
      header: 'Supplier',
      cell: (row) => row.supplierName || '—',
      text: (row) => row.supplierName,
    },
    {
      key: 'number',
      header: 'Number',
      cell: (row) => row.documentNumber || '—',
    },
    {
      key: 'date',
      header: 'Date',
      cell: (row) => (row.documentDate ? saDate(row.documentDate) : '—'),
    },
    {
      key: 'total',
      header: 'Total',
      cell: (row) => row.totalLabel,
    },
    {
      key: 'receipt',
      header: 'Receipt',
      cell: (row) =>
        row.hasReceipt && row.receiptItemId ? (
          <Button variant="ghost" onClick={() => navigate(`/stock/items/${row.receiptItemId}`)}>
            View Receipt
          </Button>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Documents"
        description="Supplier invoices and delivery notes snapped for stock."
        actions={<SnapButton navigate={navigate} />}
      />
      {error ? <p className="ui-error">{error}</p> : null}
      {rows === null && !error ? <Skeleton lines={5} /> : null}
      {rows && rows.length === 0 && !error ? (
        <EmptyState
          title="No documents yet"
          body="Snap a Document to read a supplier invoice or a delivery note."
        />
      ) : null}
      {rows && rows.length > 0 ? (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          onRow={(row) => navigate(`/documents/${row.id}`)}
          emptyTitle="No documents yet"
          emptyBody="Snap a Document to read a supplier invoice or a delivery note."
        />
      ) : null}
    </>
  );
}
