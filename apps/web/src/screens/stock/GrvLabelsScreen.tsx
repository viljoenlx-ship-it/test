import { LABEL_COPY_MAX, totalLabelCopies } from '@omnivate/shared';
import { Button, CheckField, PageHeader } from '@omnivate/ui';
import { useEffect, useState, type CSSProperties } from 'react';
import { api, errorMessage, type Navigate } from '../../api';
import { CopiesStepper, LabelFace } from './LabelScreen';
import { downloadLabelBatch, type RasterLabel } from './label-sheet';
import {
  connectNiimbot,
  connectedPrinterName,
  printerError,
  printOnNiimbot,
  rememberedPrinter,
  webBluetoothAvailable,
} from './niimbot';

type Face = RasterLabel & {
  id: string;
  barcode: string;
  svg: string;
  quantityLabel: string;
  defaultCopies: number;
  widthMm: string;
  heightMm: string;
};

type Row = Face & { lineId: string; included: boolean; copies: number };

export function GrvLabelsScreen({
  navigate,
  receiptId,
}: {
  navigate: Navigate;
  receiptId: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [grvNumber, setGrvNumber] = useState('');
  const [receivedOn, setReceivedOn] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [printer, setPrinter] = useState(() => rememberedPrinter()?.name ?? '');
  const [progress, setProgress] = useState('');
  const bluetooth = webBluetoothAvailable();

  useEffect(() => {
    let cancel = false;
    api(`/scm/goods-receipts/${receiptId}/labels/preview`, {
      method: 'POST',
      body: '{}',
    }).then(({ status, body }) => {
      if (cancel) {
        return;
      }
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object' || !('labels' in body)) {
        setError(errorMessage(body, 'The labels did not load.'));
        return;
      }
      const payload = body as {
        grvNumber: string;
        receivedOn: string;
        labels: Face[];
      };
      setGrvNumber(payload.grvNumber);
      setReceivedOn(payload.receivedOn);
      setRows(
        payload.labels.map((label) => ({
          ...label,
          lineId: label.id,
          included: true,
          copies: label.defaultCopies,
        })),
      );
    });
    return () => {
      cancel = true;
    };
  }, [navigate, receiptId]);

  const total = totalLabelCopies(rows);
  const width = Number(rows[0]?.widthMm ?? '50');
  const height = Number(rows[0]?.heightMm ?? '15');
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 50;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 15;
  const preview = rows.find((row) => row.included && row.copies > 0) ?? rows[0];
  const frameStyle = {
    '--label-w': `${safeWidth}mm`,
    '--label-h': `${safeHeight}mm`,
    '--label-rw': String(safeWidth),
    '--label-rh': String(safeHeight),
  } as CSSProperties;

  function expand(): RasterLabel[] {
    const labels: RasterLabel[] = [];
    for (const row of rows) {
      if (!row.included || row.copies < 1) {
        continue;
      }
      for (let copy = 0; copy < row.copies; copy += 1) {
        labels.push(row);
      }
    }
    return labels;
  }

  async function record(): Promise<boolean> {
    const lines = rows
      .filter((row) => row.included && row.copies > 0)
      .map((row) => ({ lineId: row.lineId, copies: row.copies }));
    const { status, body } = await api(`/scm/goods-receipts/${receiptId}/labels`, {
      method: 'POST',
      body: JSON.stringify({ lines }),
    });
    if (status !== 201) {
      setError(errorMessage(body, 'Those labels were not recorded.'));
      return false;
    }
    return true;
  }

  async function printSheet() {
    setBusy(true);
    setError('');
    const saved = await record();
    setBusy(false);
    if (saved) {
      window.print();
    }
  }

  async function download(kind: 'pdf' | 'png') {
    setBusy(true);
    setError('');
    try {
      const saved = await record();
      if (!saved) {
        return;
      }
      await downloadLabelBatch(expand(), grvNumber || 'labels', kind);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The label file was not created.');
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setError('');
    setProgress('Connecting…');
    try {
      const name = await connectNiimbot();
      setPrinter(name);
      setProgress('');
    } catch (cause) {
      setProgress('');
      setError(printerError(cause));
    }
  }

  async function printDirect() {
    setBusy(true);
    setError('');
    const labels = expand();
    try {
      const saved = await record();
      if (!saved) {
        return;
      }
      await printOnNiimbot({
        labels,
        widthMm: safeWidth,
        heightMm: safeHeight,
        onProgress: (done, count) => setProgress(`Printing ${done} of ${count}`),
      });
      setPrinter(connectedPrinterName() || printer);
      setProgress(`Printed ${labels.length} of ${labels.length}`);
    } catch (cause) {
      setProgress('');
      setError(printerError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="label-print" style={frameStyle}>
      <style>{`
        @media print {
          @page { size: ${safeWidth}mm ${safeHeight}mm; margin: 0; }
        }
      `}</style>
      <PageHeader
        title="Print Labels"
        description={grvNumber ? `${grvNumber} · ${receivedOn}` : 'Preparing the labels.'}
        breadcrumbs={[
          { label: 'Stock', href: '/stock' },
          { label: grvNumber || 'Goods Receipt', href: `/stock/receipts/${receiptId}` },
          { label: 'Print Labels' },
        ]}
        onNavigate={navigate}
        actions={
          rows.length > 0 ? (
            <>
              <Button onClick={() => void printSheet()} disabled={busy || total < 1}>
                Print
              </Button>
              <Button
                variant="secondary"
                onClick={() => void download('pdf')}
                disabled={busy || total < 1}
              >
                Download PDF
              </Button>
              <Button
                variant="secondary"
                onClick={() => void download('png')}
                disabled={busy || total < 1}
              >
                Download PNG
              </Button>
            </>
          ) : null
        }
      />
      {error ? <p className="ui-error">{error}</p> : null}
      {rows.length === 0 && !error ? <p>Preparing the labels…</p> : null}
      {rows.length > 0 ? (
        <>
          <section className="ui-card no-print">
            <div className="grv-line-head">
              <strong className="label-batch-total">{total} Labels</strong>
              <Button
                variant="secondary"
                onClick={() =>
                  setRows((current) => current.map((row) => ({ ...row, included: true })))
                }
              >
                Select All
              </Button>
            </div>
            <p className="print-status">
              {bluetooth
                ? printer
                  ? `Connected to ${printer}`
                  : 'Printer is not connected.'
                : 'This browser cannot connect to a printer. Use Print or Download PDF. The Niimbot app can open the file.'}
            </p>
            {progress ? <p className="print-status">{progress}</p> : null}
            {bluetooth ? (
              <div className="ui-actions">
                <Button variant="secondary" onClick={() => void connect()} disabled={busy}>
                  Connect Printer
                </Button>
                <Button onClick={() => void printDirect()} disabled={busy || total < 1}>
                  Print to Niimbot
                </Button>
              </div>
            ) : null}
            <ul className="grv-lines">
              {rows.map((row) => (
                <li key={row.lineId} className="grv-line">
                  <div>
                    <strong>{row.name}</strong>
                    <div>
                      {row.code} · {row.barcode}
                    </div>
                    <div>{row.quantityLabel}</div>
                  </div>
                  <CheckField
                    label="Include"
                    checked={row.included}
                    onChange={(included) =>
                      setRows((current) =>
                        current.map((line) =>
                          line.lineId === row.lineId ? { ...line, included } : line,
                        ),
                      )
                    }
                  />
                  <CopiesStepper
                    id={`copies-${row.lineId}`}
                    label="Copies"
                    value={row.copies}
                    min={1}
                    max={LABEL_COPY_MAX}
                    onChange={(copies) =>
                      setRows((current) =>
                        current.map((line) =>
                          line.lineId === row.lineId ? { ...line, copies } : line,
                        ),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          </section>
          {preview ? (
            <div className="label-frame no-print">
              <LabelFace label={preview} />
            </div>
          ) : null}
          <div className="label-run">
            {rows.flatMap((row) =>
              row.included
                ? Array.from({ length: row.copies }, (_, index) => (
                    <LabelFace key={`${row.lineId}-${index}`} label={row} />
                  ))
                : [],
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
