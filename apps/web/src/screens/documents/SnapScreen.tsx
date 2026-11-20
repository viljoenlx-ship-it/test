import { Button, Card, EmptyState, PageHeader, Skeleton } from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api, errorMessage, upload, type Navigate } from '../../api';
import { ScanCamera } from '../stock/ScanCamera';

const ACCEPT =
  'image/jpeg,image/png,image/heic,image/heif,application/pdf,.jpg,.jpeg,.png,.heic,.heif,.pdf';

type Row = {
  id: string;
  statusLabel: string;
  supplierName: string;
  documentNumber: string;
};

/** Camera first. A document photo, or a barcode that receives stock. */
export function SnapScreen({ navigate }: { navigate: Navigate }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancel = false;
    void api('/documents/access').then(({ status, body }) => {
      if (cancel) {
        return;
      }
      const canCapture =
        status === 200 &&
        !!body &&
        typeof body === 'object' &&
        'canCapture' in body &&
        (body as { canCapture: boolean }).canCapture === true;
      setAllowed(canCapture);
    });
    void api('/documents').then(({ status, body }) => {
      if (cancel) {
        return;
      }
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object' || !('documents' in body)) {
        setRows([]);
        return;
      }
      setRows((body as { documents: Row[] }).documents.slice(0, 8));
    });
    return () => {
      cancel = true;
    };
  }, [navigate]);

  function take(file: File) {
    setBusy(true);
    setError('');
    void upload('/documents', file).then(({ status, body }) => {
      setBusy(false);
      if (status >= 400 || !body || typeof body !== 'object' || !('id' in body)) {
        setError(errorMessage(body, 'That document was not saved.'));
        return;
      }
      navigate(`/documents/${String((body as { id: string }).id)}`);
    });
  }

  return (
    <>
      <PageHeader
        title="Snap A Document"
        description="Photograph a supplier invoice or a delivery note. Or scan a barcode to receive stock."
      />
      <div className="ui-viewfinder">
        <p>Point the camera at the page. The photo is read on this phone.</p>
        {allowed ? (
          <label className="ui-btn">
            {busy ? 'Reading Document' : 'Open Camera'}
            <input
              type="file"
              accept={ACCEPT}
              capture="environment"
              aria-label="Snap A Document"
              disabled={busy}
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) {
                  take(file);
                }
              }}
            />
          </label>
        ) : (
          <p>Your role cannot snap a document.</p>
        )}
      </div>
      {error ? <p className="ui-error">{error}</p> : null}
      <div style={{ height: 16 }} />
      <ScanCamera
        onScan={(code) => navigate(`/stock/receive?barcode=${encodeURIComponent(code)}`)}
      />
      <div style={{ height: 12 }} />
      <Button variant="secondary" onClick={() => navigate('/stock/receive')}>
        Scan A Barcode
      </Button>
      <div style={{ height: 20 }} />
      <Card title="Recent Snaps">
        {rows === null ? <Skeleton lines={3} /> : null}
        {rows && rows.length === 0 ? (
          <EmptyState
            title="No documents yet"
            body="The last invoices and delivery notes you snap show up here."
          />
        ) : null}
        {rows && rows.length > 0 ? (
          <ul className="ui-record-list">
            {rows.map((row) => (
              <li key={row.id} className="ui-record">
                <button
                  type="button"
                  className="ui-record-hit"
                  onClick={() => navigate(`/documents/${row.id}`)}
                >
                  <span className="ui-record-title">{row.supplierName || 'Supplier'}</span>
                  <span className="ui-record-meta">
                    <span>{row.documentNumber || 'No number'}</span>
                    <span>{row.statusLabel}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </>
  );
}
