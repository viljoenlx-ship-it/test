import { Button, Form, PageHeader, SelectField, TextField, usePhone, useToast } from '@omnivate/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, type Navigate } from '../../api';
import type { BranchOption, StockRow } from './types';

type Mode = 'receive' | 'adjust' | 'transfer';

const copy: Record<Mode, { title: string; description: string; action: string; path: string }> = {
  receive: {
    title: 'Receive Stock',
    description: 'Goods that have arrived. The average cost updates from this cost.',
    action: 'Receive Stock',
    path: '/scm/receive',
  },
  adjust: {
    title: 'Adjust Stock',
    description: 'Correct a count, or write stock off. A large correction waits for a manager.',
    action: 'Save Adjustment',
    path: '/scm/adjust',
  },
  transfer: {
    title: 'Transfer Stock',
    description: 'Move stock from one branch to another. The company total does not change.',
    action: 'Transfer',
    path: '/scm/transfer',
  },
};

export function MoveScreen({
  navigate,
  mode,
  presetItem,
}: {
  navigate: Navigate;
  mode: Mode;
  presetItem: string;
}) {
  const notify = useToast();
  const phone = usePhone();
  const text = copy[mode];
  const [items, setItems] = useState<StockRow[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [pending, setPending] = useState<
    { id: string; itemName: string; summary: string; reason: string; valueLabel: string | null }[]
  >([]);
  const [canApprove, setCanApprove] = useState(false);
  const [itemId, setItemId] = useState(presetItem);
  const [branchId, setBranchId] = useState('');
  const [toBranchId, setToBranchId] = useState('');
  const [unit, setUnit] = useState('');
  const [quantity, setQuantity] = useState('');
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState('');
  const [direction, setDirection] = useState('up');
  const [purpose, setPurpose] = useState(mode === 'adjust' ? 'adjust' : 'adjust');
  const [batchCode, setBatchCode] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [serials, setSerials] = useState('');
  const [scan, setScan] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    Promise.all([
      api('/scm/items?filter=active'),
      api('/scm/branches'),
      api('/scm/adjustments'),
    ]).then(([itemResponse, branchResponse, pendingResponse]) => {
      if (cancel) {
        return;
      }
      if (itemResponse.status === 401) {
        navigate('/login');
        return;
      }
      const itemBody = itemResponse.body as { items?: StockRow[] };
      const stock = (itemBody.items ?? []).filter((row) => row.kind === 'stock' && !row.archived);
      setItems(stock);
      const branchBody = branchResponse.body as { branches?: BranchOption[] };
      const list = branchBody.branches ?? [];
      setBranches(list);
      const home = list.find((row) => row.headOffice) ?? list[0];
      if (home && !branchId) {
        setBranchId(home.id);
      }
      const other = list.find((row) => row.id !== home?.id);
      if (other) {
        setToBranchId(other.id);
      }
      if (
        pendingResponse.status === 200 &&
        pendingResponse.body &&
        typeof pendingResponse.body === 'object'
      ) {
        const payload = pendingResponse.body as {
          pending: typeof pending;
          access: { canApprove: boolean };
        };
        setPending(payload.pending);
        setCanApprove(payload.access.canApprove);
      }
      const chosen = stock.find((row) => row.id === presetItem) ?? stock[0];
      if (chosen) {
        setItemId(chosen.id);
        setUnit(chosen.unit);
      }
    });
    return () => {
      cancel = true;
    };
  }, [navigate, presetItem]);

  const chosen = items.find((row) => row.id === itemId);

  function applyScan() {
    const needle = scan.trim().toLowerCase();
    const match = items.find(
      (row) => row.barcode.toLowerCase() === needle || row.code.toLowerCase() === needle,
    );
    if (!match) {
      setError('No stock item uses that barcode.');
      return;
    }
    setItemId(match.id);
    setUnit(match.unit);
    setError('');
    setScan('');
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const writingOff = mode === 'adjust' && purpose === 'issue';
    const payload = {
      itemId,
      branchId,
      toBranchId,
      quantity,
      unit: unit || chosen?.unit || '',
      cost,
      reason,
      direction: writingOff ? 'down' : direction,
      batchCode,
      expiresOn,
      serials,
    };
    const path = writingOff ? '/scm/issue' : text.path;
    const { status, body } = await api(path, { method: 'POST', body: JSON.stringify(payload) });
    setBusy(false);
    if (status === 200 || status === 201 || status === 202) {
      const message =
        body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
          ? body.message
          : 'Stock updated';
      notify({ title: message });
      navigate(itemId ? `/stock/items/${itemId}` : '/stock');
      return;
    }
    setError(errorMessage(body, 'That stock movement was not saved.'));
  }

  async function decide(id: string, decision: 'approve' | 'reject') {
    const { status, body } = await api(`/scm/adjustments/${id}/${decision}`, { method: 'POST' });
    if (status !== 200) {
      notify({ title: errorMessage(body, 'That decision was not saved.'), tone: 'bad' });
      return;
    }
    notify({ title: decision === 'approve' ? 'Adjustment approved' : 'Adjustment declined' });
    setPending((current) => current.filter((row) => row.id !== id));
  }

  const singleBranch = mode === 'transfer' && branches.length === 1;

  return (
    <>
      <PageHeader
        title={text.title}
        description={text.description}
        breadcrumbs={[{ label: 'Stock', href: '/stock' }, { label: text.title }]}
        onNavigate={navigate}
      />
      {mode === 'adjust' && pending.length > 0 ? (
        <section className="ui-card">
          <h2>Waiting For A Manager</h2>
          <ul>
            {pending.map((row) => (
              <li key={row.id}>
                {row.itemName}: {row.summary}. {row.reason}
                {row.valueLabel ? ` (${row.valueLabel})` : ''}
                {canApprove ? (
                  <span className="ui-actions">
                    <Button onClick={() => void decide(row.id, 'approve')}>Approve</Button>
                    <Button variant="secondary" onClick={() => void decide(row.id, 'reject')}>
                      Decline
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {singleBranch ? (
        <p>
          This company works from {branches[0]?.name} only. Stock stays there until another branch
          is added.
        </p>
      ) : (
        <Form onSubmit={(event) => void onSubmit(event)}>
          <TextField
            label="Scan A Barcode"
            value={scan}
            onChange={setScan}
            placeholder="Scan, then press enter"
            autoComplete="off"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyScan();
              }
            }}
          />
          <SelectField
            label="Item"
            value={itemId}
            onChange={(value) => {
              setItemId(value);
              const next = items.find((row) => row.id === value);
              if (next) {
                setUnit(next.unit);
              }
            }}
          >
            {items.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Branch" value={branchId} onChange={setBranchId}>
            {branches.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </SelectField>
          {mode === 'transfer' ? (
            <SelectField label="To Branch" value={toBranchId} onChange={setToBranchId}>
              {branches.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </SelectField>
          ) : null}
          {mode === 'adjust' ? (
            <SelectField label="What Happened" value={purpose} onChange={setPurpose}>
              <option value="adjust">Correct The Count</option>
              <option value="issue">Write Stock Off</option>
            </SelectField>
          ) : null}
          {mode === 'adjust' && purpose === 'adjust' ? (
            <SelectField label="Direction" value={direction} onChange={setDirection}>
              <option value="up">Count Is Higher</option>
              <option value="down">Count Is Lower</option>
            </SelectField>
          ) : null}
          <TextField
            label="Quantity"
            value={quantity}
            onChange={setQuantity}
            inputMode="decimal"
            required
          />
          <TextField
            label="Unit"
            value={unit}
            onChange={setUnit}
            hint={chosen ? `Base unit is ${chosen.unit}.` : ''}
          />
          {mode === 'receive' ? (
            <TextField
              label={`Cost Per ${chosen?.unit ?? 'unit'}`}
              hint="Excluding VAT. This updates the average cost."
              value={cost}
              onChange={setCost}
              inputMode="decimal"
              required
            />
          ) : null}
          <TextField
            label={mode === 'receive' ? 'Note' : 'Reason'}
            value={reason}
            onChange={setReason}
            required={mode !== 'receive'}
          />
          <TextField
            label="Batch Or Lot"
            hint="Only for items that track batches."
            value={batchCode}
            onChange={setBatchCode}
          />
          <TextField
            label="Expiry"
            type={phone ? 'date' : 'text'}
            hint={phone ? 'If there is one.' : 'YYYY-MM-DD, if there is one.'}
            value={expiresOn}
            onChange={setExpiresOn}
          />
          <label className="ui-field">
            <span>Serial Numbers</span>
            <textarea
              value={serials}
              rows={3}
              placeholder="One per line, only when this item uses serial numbers"
              onChange={(event) => setSerials(event.target.value)}
            />
          </label>
          {mode === 'adjust' ? (
            <p className="ui-hint">
              Changes worth more than R10 000 wait for a manager to approve them.
            </p>
          ) : null}
          {error ? <p className="ui-error">{error}</p> : null}
          <div className="ui-form-submit">
            <Button type="submit" disabled={busy}>
              {busy
                ? 'Saving…'
                : purpose === 'issue' && mode === 'adjust'
                  ? 'Write Stock Off'
                  : text.action}
            </Button>
          </div>
        </Form>
      )}
    </>
  );
}
