import { bumpQuantity } from '@omnivate/shared';
import {
  Button,
  DialogFrame,
  Form,
  PageHeader,
  SelectField,
  TextField,
  useToast,
} from '@omnivate/ui';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, errorMessage, type Navigate } from '../../api';
import { ScanCamera } from './ScanCamera';
import { createScanBuffer, playScanTone } from './scan-feedback';
import type { BranchOption, StockRow } from './types';

type DraftLine = {
  key: string;
  itemId: string;
  name: string;
  code: string;
  barcode: string;
  unit: string;
  quantity: string;
  cost: string;
  tracksSerials: boolean;
  tracksBatches: boolean;
  batchCode: string;
  expiresOn: string;
  serials: string;
};

type Recent = { id: string; number: string; receivedOn: string; lineCount: number; note: string };

function newLine(item: StockRow): DraftLine {
  return {
    key: `${item.id}-${Date.now()}`,
    itemId: item.id,
    name: item.name,
    code: item.code,
    barcode: item.barcode,
    unit: item.unit,
    quantity: '1',
    cost: item.cost ?? '',
    tracksSerials: item.tracksSerials === true,
    tracksBatches: item.tracksBatches === true,
    batchCode: '',
    expiresOn: '',
    serials: '',
  };
}

export function GrvCaptureScreen({
  navigate,
  presetItem,
  initialBarcode = '',
}: {
  navigate: Navigate;
  presetItem: string;
  initialBarcode?: string;
}) {
  const notify = useToast();
  const scanBox = useRef<HTMLDivElement>(null);
  const scans = useRef(createScanBuffer());
  const [items, setItems] = useState<StockRow[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [branchId, setBranchId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [scan, setScan] = useState('');
  const [flash, setFlash] = useState<'ok' | 'bad' | ''>('');
  const [unknown, setUnknown] = useState('');
  const [linkId, setLinkId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    Promise.all([
      api('/scm/items?filter=active'),
      api('/scm/branches'),
      api('/scm/goods-receipts'),
    ]).then(([itemResponse, branchResponse, receiptResponse]) => {
      if (cancel) {
        return;
      }
      if (itemResponse.status === 401) {
        navigate('/login');
        return;
      }
      const stock = ((itemResponse.body as { items?: StockRow[] }).items ?? []).filter(
        (row) => row.kind === 'stock' && !row.archived,
      );
      setItems(stock);
      const list = (branchResponse.body as { branches?: BranchOption[] }).branches ?? [];
      setBranches(list);
      const home = list.find((row) => row.headOffice) ?? list[0];
      if (home) {
        setBranchId(home.id);
      }
      if (
        receiptResponse.status === 200 &&
        receiptResponse.body &&
        typeof receiptResponse.body === 'object'
      ) {
        setRecent((receiptResponse.body as { receipts?: Recent[] }).receipts ?? []);
      }
      const preset = stock.find((row) => row.id === presetItem);
      if (preset) {
        setLines([newLine(preset)]);
      } else if (initialBarcode.trim()) {
        const needle = initialBarcode.trim().toLowerCase();
        const match = stock.find(
          (row) => row.barcode.toLowerCase() === needle || row.code.toLowerCase() === needle,
        );
        if (match) {
          setLines([newLine(match)]);
        } else {
          setUnknown(initialBarcode.trim());
        }
      }
    });
    return () => {
      cancel = true;
    };
  }, [navigate, presetItem, initialBarcode]);

  function focusScan() {
    scanBox.current?.querySelector('input')?.focus();
  }

  function acceptItem(item: StockRow) {
    setLines((current) => {
      const index = current.findIndex((line) => line.itemId === item.id);
      if (index < 0) {
        return [...current, newLine(item)];
      }
      return current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, quantity: bumpQuantity(line.quantity) } : line,
      );
    });
    setScan('');
    setError('');
    setFlash('ok');
    playScanTone(true);
    window.setTimeout(() => setFlash(''), 400);
    window.setTimeout(focusScan, 0);
  }

  function rejectScan(code: string) {
    setUnknown(code);
    setLinkId(items.find((row) => !row.barcode)?.id ?? '');
    setFlash('bad');
    playScanTone(false);
    window.setTimeout(() => setFlash(''), 400);
    setScan('');
  }

  function applyCode(code: string) {
    const needle = code.trim().toLowerCase();
    if (!needle) {
      return;
    }
    const match = items.find(
      (row) => row.barcode.toLowerCase() === needle || row.code.toLowerCase() === needle,
    );
    if (!match) {
      rejectScan(code.trim());
      return;
    }
    acceptItem(match);
  }

  function onScanKey(event: KeyboardEvent<HTMLInputElement>) {
    scans.current.push(event.key);
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    applyCode(event.currentTarget.value);
  }

  async function linkBarcode() {
    if (!linkId || !unknown) {
      return;
    }
    setBusy(true);
    const { status, body } = await api(`/scm/items/${linkId}/barcode`, {
      method: 'POST',
      body: JSON.stringify({ barcode: unknown }),
    });
    setBusy(false);
    if (status !== 200) {
      setError(errorMessage(body, 'That barcode was not linked.'));
      return;
    }
    const item = items.find((row) => row.id === linkId);
    if (item) {
      const linked = { ...item, barcode: unknown };
      setItems((current) => current.map((row) => (row.id === linkId ? linked : row)));
      acceptItem(linked);
    }
    setUnknown('');
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (lines.length === 0) {
      setError('Scan or add at least one line.');
      return;
    }
    setBusy(true);
    setError('');
    const { status, body } = await api('/scm/goods-receipts', {
      method: 'POST',
      body: JSON.stringify({
        branchId,
        note,
        lines: lines.map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity,
          unit: line.unit,
          cost: line.cost,
          batchCode: line.batchCode,
          expiresOn: line.expiresOn,
          serials: line.serials,
        })),
      }),
    });
    setBusy(false);
    if (status === 201 && body && typeof body === 'object' && 'receipt' in body) {
      const receipt = (body as { receipt: { id: string; number: string } }).receipt;
      notify({ title: `${receipt.number} received` });
      navigate(`/stock/receipts/${receipt.id}`);
      return;
    }
    setError(errorMessage(body, 'That goods receipt was not saved.'));
  }

  const linkChoices = items.filter((row) => !row.barcode);

  return (
    <>
      <PageHeader
        title="Receive Stock"
        description="Goods that have arrived. Scan each item, then save the goods receipt."
        breadcrumbs={[{ label: 'Stock', href: '/stock' }, { label: 'Receive Stock' }]}
        onNavigate={navigate}
      />
      <Form onSubmit={(event) => void onSubmit(event)}>
        <div ref={scanBox} className={flash ? `scan-ready is-${flash}` : 'scan-ready'}>
          <TextField
            label="Scan A Barcode"
            value={scan}
            onChange={setScan}
            placeholder="Scan, then the reader sends Enter"
            autoComplete="off"
            autoFocus
            onKeyDown={onScanKey}
          />
        </div>
        <ScanCamera onScan={applyCode} />
        <SelectField label="Branch" value={branchId} onChange={setBranchId}>
          {branches.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </SelectField>
        <TextField label="Note" value={note} onChange={setNote} />
        {lines.length === 0 ? <p>No lines yet. Scan a barcode to add the first one.</p> : null}
        <ul className="grv-lines">
          {lines.map((line) => (
            <li key={line.key} className="grv-line">
              <div className="grv-line-head">
                <div>
                  <strong>{line.name}</strong>
                  <div>
                    {line.code}
                    {line.barcode ? ` · ${line.barcode}` : ''}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setLines((current) => current.filter((row) => row.key !== line.key))
                  }
                >
                  Remove
                </Button>
              </div>
              <TextField
                label="Quantity"
                value={line.quantity}
                onChange={(quantity) =>
                  setLines((current) =>
                    current.map((row) => (row.key === line.key ? { ...row, quantity } : row)),
                  )
                }
                inputMode="decimal"
                required
              />
              <TextField
                label={`Cost Per ${line.unit}`}
                hint="Excluding VAT. This updates the average cost."
                value={line.cost}
                onChange={(cost) =>
                  setLines((current) =>
                    current.map((row) => (row.key === line.key ? { ...row, cost } : row)),
                  )
                }
                inputMode="decimal"
                required
              />
              {line.tracksBatches ? (
                <>
                  <TextField
                    label="Batch Or Lot"
                    value={line.batchCode}
                    onChange={(batchCode) =>
                      setLines((current) =>
                        current.map((row) => (row.key === line.key ? { ...row, batchCode } : row)),
                      )
                    }
                  />
                  <TextField
                    label="Expiry"
                    hint="YYYY-MM-DD, if there is one."
                    value={line.expiresOn}
                    onChange={(expiresOn) =>
                      setLines((current) =>
                        current.map((row) => (row.key === line.key ? { ...row, expiresOn } : row)),
                      )
                    }
                  />
                </>
              ) : null}
              {line.tracksSerials ? (
                <label className="ui-field">
                  <span>Serial Numbers</span>
                  <textarea
                    value={line.serials}
                    rows={3}
                    placeholder="One per line"
                    onChange={(event) => {
                      const serials = event.target.value;
                      setLines((current) =>
                        current.map((row) => (row.key === line.key ? { ...row, serials } : row)),
                      );
                    }}
                  />
                </label>
              ) : null}
            </li>
          ))}
        </ul>
        {error ? <p className="ui-error">{error}</p> : null}
        <div className="ui-form-submit">
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Receive Stock'}
          </Button>
        </div>
      </Form>
      {recent.length > 0 ? (
        <section className="ui-card">
          <h2>Recent Receipts</h2>
          <ul className="grv-lines">
            {recent.map((row) => (
              <li key={row.id} className="grv-line">
                <button
                  type="button"
                  className="grv-link"
                  onClick={() => navigate(`/stock/receipts/${row.id}`)}
                >
                  <strong>{row.number}</strong>
                  <span>
                    {row.receivedOn} · {row.lineCount} {row.lineCount === 1 ? 'Line' : 'Lines'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <DialogFrame
        open={unknown.length > 0}
        onOpenChange={(open) => {
          if (!open) {
            setUnknown('');
          }
        }}
        title="Unknown Barcode"
        description={`${unknown} is not on an item yet.`}
      >
        {linkChoices.length > 0 ? (
          <SelectField label="Link To An Item" value={linkId} onChange={setLinkId}>
            {linkChoices.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </SelectField>
        ) : (
          <p>Every item already has a barcode.</p>
        )}
        <div className="ui-actions">
          <Button type="button" onClick={() => void linkBarcode()} disabled={busy || !linkId}>
            Link To An Item
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate(`/stock/new?barcode=${encodeURIComponent(unknown)}`)}
          >
            Create An Item
          </Button>
        </div>
      </DialogFrame>
    </>
  );
}
