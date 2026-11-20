import { Button, PageHeader, Skeleton } from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api, errorMessage, type Navigate } from '../../api';

type Receipt = {
  id: string;
  number: string;
  note: string;
  receivedOn: string;
  lines: {
    id: string;
    name: string;
    code: string;
    barcode: string;
    quantityLabel: string;
    defaultCopies: number;
  }[];
};

export function GrvDetailScreen({
  navigate,
  receiptId,
}: {
  navigate: Navigate;
  receiptId: string;
}) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [canPrint, setCanPrint] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancel = false;
    api(`/scm/goods-receipts/${receiptId}`).then(({ status, body }) => {
      if (cancel) {
        return;
      }
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object' || !('receipt' in body)) {
        setError(errorMessage(body, 'That goods receipt did not load.'));
        return;
      }
      const payload = body as { receipt: Receipt; access: { canPrint: boolean } };
      setReceipt(payload.receipt);
      setCanPrint(payload.access.canPrint);
    });
    return () => {
      cancel = true;
    };
  }, [navigate, receiptId]);

  const total = receipt?.lines.reduce((sum, line) => sum + line.defaultCopies, 0) ?? 0;

  return (
    <>
      <PageHeader
        title={receipt?.number ?? 'Goods Receipt'}
        description={receipt ? `Received ${receipt.receivedOn}` : 'The goods that were received.'}
        breadcrumbs={[
          { label: 'Stock', href: '/stock' },
          { label: 'Receive Stock', href: '/stock/receive' },
          { label: receipt?.number ?? 'Goods Receipt' },
        ]}
        onNavigate={navigate}
        actions={
          receipt && canPrint ? (
            <Button onClick={() => navigate(`/stock/receipts/${receipt.id}/labels`)}>
              Print Labels
            </Button>
          ) : null
        }
      />
      {error ? <p className="ui-error">{error}</p> : null}
      {!receipt && !error ? <Skeleton lines={6} /> : null}
      {receipt ? (
        <section className="ui-card">
          {receipt.note ? <p>{receipt.note}</p> : null}
          <p className="label-batch-total">{total} Labels</p>
          <ul className="grv-lines">
            {receipt.lines.map((line) => (
              <li key={line.id} className="grv-line">
                <div>
                  <strong>{line.name}</strong>
                  <div>
                    {line.code}
                    {line.barcode ? ` · ${line.barcode}` : ''}
                  </div>
                </div>
                <div>
                  {line.quantityLabel}
                  <div>{line.defaultCopies} Labels</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
