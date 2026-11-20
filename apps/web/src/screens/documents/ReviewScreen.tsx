import { Button, ConfirmDialog, SelectField, Skeleton, useToast } from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { API_BASE, api, errorMessage, type Navigate } from '../../api';
import { rands, saDate } from './format';

type Line = {
  id: string;
  lineNo: number;
  description: string;
  supplierCode: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  vat: string;
  lineTotal: string;
  itemId: string | null;
  itemName: string | null;
  matchMethod: string;
  confidence: Record<string, number>;
};

type DocumentView = {
  id: string;
  status: string;
  statusLabel: string;
  contentType: string;
  documentType: string;
  supplierName: string;
  supplierVat: string;
  partyId: string | null;
  partyName: string | null;
  documentNumber: string;
  documentDate: string;
  dueDate: string;
  currency: string;
  subtotal: string;
  vat: string;
  total: string;
  totalLabel: string;
  branchId: string;
  branches: { id: string; name: string; headOffice: boolean }[];
  confidence: Record<string, number>;
  lowConfidence: string[];
  lines: Line[];
  warnings: string[];
  duplicate: { id: string; documentNumber: string; statusLabel: string } | null;
  receipts: { movementId: string; itemId: string | null; itemName: string }[];
  failureMessage: string | null;
  goodsReceiptId: string | null;
  canCapture: boolean;
};

type CatalogHit = { id: string; name: string; kind: string };

function unsure(confidence: Record<string, number> | undefined, key: string): boolean {
  const value = confidence?.[key];
  return value !== undefined && value < 0.75;
}

function payload(current: DocumentView) {
  return {
    documentType: current.documentType,
    supplierName: current.supplierName,
    supplierVat: current.supplierVat,
    partyId: current.partyId,
    documentNumber: current.documentNumber,
    documentDate: current.documentDate,
    dueDate: current.dueDate,
    currency: current.currency,
    subtotal: current.subtotal,
    vat: current.vat,
    total: current.total,
    branchId: current.branchId,
    lines: current.lines.map((line) => ({
      id: line.id,
      description: line.description,
      supplierCode: line.supplierCode,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      vat: line.vat,
      lineTotal: line.lineTotal,
      itemId: line.itemId,
    })),
  };
}

function EditValue({
  open,
  value,
  display,
  flagged,
  optional,
  label,
  onOpen,
  onChange,
  onClose,
}: {
  open: boolean;
  value: string;
  display: string;
  flagged: boolean;
  optional?: boolean;
  label: string;
  onOpen: () => void;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  if (open) {
    return (
      <input
        className={flagged ? 'doc-cell is-flagged' : 'doc-cell'}
        aria-label={label}
        value={value}
        autoFocus
        onChange={(event) => onChange(event.target.value)}
        onBlur={onClose}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
        }}
      />
    );
  }
  const missing = value.trim() === '' && !optional;
  return (
    <button
      type="button"
      className={flagged || missing ? 'doc-glance is-flagged' : 'doc-glance'}
      onClick={onOpen}
    >
      {value.trim() ? display : flagged || missing ? 'Could Not Read' : '—'}
    </button>
  );
}

export function ReviewScreen({ navigate, documentId }: { navigate: Navigate; documentId: string }) {
  const notify = useToast();
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scale, setScale] = useState(1);
  const [showDoc, setShowDoc] = useState(false);
  const [more, setMore] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);

  useEffect(() => {
    let stop = false;
    let timer = 0;
    async function load() {
      const { status, body } = await api(`/documents/${documentId}`);
      if (stop) {
        return;
      }
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object' || !('status' in body)) {
        setError(errorMessage(body, 'That document was not found.'));
        return;
      }
      const next = body as DocumentView;
      setDoc(next);
      setError('');
      if (next.status === 'queued' || next.status === 'reading') {
        timer = window.setTimeout(() => void load(), 800);
      }
    }
    void load();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [documentId, navigate]);

  function patch(change: Partial<DocumentView>) {
    setDoc((current) => (current ? { ...current, ...change } : current));
  }

  function patchLine(id: string, change: Partial<Line>) {
    setDoc((current) =>
      current
        ? {
            ...current,
            lines: current.lines.map((line) => (line.id === id ? { ...line, ...change } : line)),
          }
        : current,
    );
  }

  async function save(): Promise<DocumentView | null> {
    if (!doc) {
      return null;
    }
    const { status, body } = await api(`/documents/${documentId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload(doc)),
    });
    if (status >= 400 || !body || typeof body !== 'object') {
      notify({ title: errorMessage(body, 'The document was not saved.'), tone: 'bad' });
      return null;
    }
    const next = body as DocumentView;
    setDoc(next);
    return next;
  }

  async function receive() {
    setBusy(true);
    const saved = await save();
    if (!saved) {
      setBusy(false);
      return;
    }
    const { status, body } = await api(`/documents/${documentId}/receive`, {
      method: 'POST',
      body: JSON.stringify({ confirmDuplicate: Boolean(saved.duplicate) }),
    });
    setBusy(false);
    if (status >= 400) {
      notify({ title: errorMessage(body, 'Stock was not received.'), tone: 'bad' });
      return;
    }
    setDoc(body as DocumentView);
    notify({ title: 'Stock was received.' });
  }

  async function undo() {
    setBusy(true);
    const { status, body } = await api(`/documents/${documentId}/undo`, { method: 'POST' });
    setBusy(false);
    setUndoOpen(false);
    if (status >= 400) {
      notify({ title: errorMessage(body, 'The receipt was not reversed.'), tone: 'bad' });
      return;
    }
    setDoc(body as DocumentView);
    notify({ title: 'The receipt was reversed.' });
  }

  async function createSupplier() {
    setBusy(true);
    const saved = await save();
    if (!saved) {
      setBusy(false);
      return;
    }
    const { status, body } = await api(`/documents/${documentId}/supplier`, { method: 'POST' });
    setBusy(false);
    if (status >= 400) {
      notify({ title: errorMessage(body, 'The supplier was not created.'), tone: 'bad' });
      return;
    }
    setDoc(body as DocumentView);
  }

  async function createItem(lineId: string) {
    setBusy(true);
    const saved = await save();
    if (!saved) {
      setBusy(false);
      return;
    }
    const { status, body } = await api(`/documents/${documentId}/lines/${lineId}/item`, {
      method: 'POST',
    });
    setBusy(false);
    setLinking(null);
    if (status >= 400) {
      notify({ title: errorMessage(body, 'The item was not created.'), tone: 'bad' });
      return;
    }
    setDoc(body as DocumentView);
  }

  if (error && !doc) {
    return <p className="ui-error">{error}</p>;
  }
  if (!doc) {
    return <Skeleton lines={8} />;
  }

  const waiting = doc.status === 'queued' || doc.status === 'reading';
  const editable = doc.status === 'ready' && doc.canCapture;
  const fileUrl = `${API_BASE}/documents/${doc.id}/file`;
  const previewable = doc.contentType === 'image/jpeg' || doc.contentType === 'image/png';
  const pdf = doc.contentType === 'application/pdf';
  const branch = doc.branches.find((row) => row.id === doc.branchId);
  const branchName = branch?.name ?? 'Head Office';
  const unmatched = doc.lines.some((line) => !line.itemId);
  const visibleFlag =
    unsure(doc.confidence, 'supplierName') ||
    unsure(doc.confidence, 'documentNumber') ||
    unsure(doc.confidence, 'documentDate') ||
    unsure(doc.confidence, 'total') ||
    doc.lines.some(
      (line) =>
        unsure(line.confidence, 'description') ||
        unsure(line.confidence, 'quantity') ||
        unsure(line.confidence, 'unitPrice') ||
        unsure(line.confidence, 'lineTotal'),
    );
  const hiddenFlag =
    unsure(doc.confidence, 'supplierVat') ||
    unsure(doc.confidence, 'dueDate') ||
    unsure(doc.confidence, 'currency') ||
    doc.lines.some(
      (line) => unsure(line.confidence, 'supplierCode') || unsure(line.confidence, 'vat'),
    );
  const statusText = waiting
    ? 'Reading Document'
    : doc.warnings[0]
      ? doc.warnings[0]
      : unmatched
        ? 'Link the items that did not match.'
        : visibleFlag
          ? 'Check the highlighted fields.'
          : 'All totals add up.';
  const statusOk = !waiting && !doc.warnings[0] && !unmatched && !visibleFlag;

  const viewer = (
    <div className="doc-viewport">
      {previewable ? (
        <img alt="Document" src={fileUrl} style={{ width: `${scale * 100}%` }} />
      ) : pdf ? (
        <iframe title="Document" src={fileUrl} style={{ width: `${scale * 100}%` }} />
      ) : (
        <p>A preview is not available for this file. The fields beside it are ready to check.</p>
      )}
    </div>
  );

  return (
    <div className="doc-review">
      <button type="button" className="doc-thumb" onClick={() => setShowDoc((open) => !open)}>
        {previewable ? <img alt="" src={fileUrl} /> : <span>Document</span>}
        {showDoc ? 'Hide Document' : 'Show Document'}
      </button>
      <section className={showDoc ? 'doc-sheet is-open' : 'doc-sheet'} aria-label="Document">
        <div className="ui-actions">
          <Button
            variant="secondary"
            onClick={() => setScale((value) => Math.min(3, value + 0.25))}
          >
            Zoom In
          </Button>
          <Button
            variant="secondary"
            onClick={() => setScale((value) => Math.max(0.5, value - 0.25))}
          >
            Zoom Out
          </Button>
        </div>
        {viewer}
      </section>
      <div className="doc-work">
        {waiting ? (
          <p className="doc-status" role="status">
            Reading Document. You can leave this page.
          </p>
        ) : null}
        {doc.status === 'failed' ? (
          <p className="ui-error" role="status">
            {doc.failureMessage || 'Could Not Read'}
          </p>
        ) : null}
        {doc.duplicate && editable ? (
          <p className="doc-note">This supplier and document number are already on file.</p>
        ) : null}
        <section className="ui-card doc-summary">
          <div className="doc-supplier-row">
            {editable ? (
              <EditValue
                open={edit === 'supplier'}
                value={doc.supplierName}
                display={doc.partyName || doc.supplierName}
                flagged={unsure(doc.confidence, 'supplierName')}
                label="Supplier"
                onOpen={() => setEdit('supplier')}
                onChange={(supplierName) => patch({ supplierName })}
                onClose={() => setEdit(null)}
              />
            ) : (
              <strong className="doc-supplier">
                {doc.partyName || doc.supplierName || 'Could Not Read'}
              </strong>
            )}
            {doc.partyName ? (
              <span className="doc-tag">Matched</span>
            ) : editable ? (
              <Button variant="secondary" disabled={busy} onClick={() => void createSupplier()}>
                Create Supplier
              </Button>
            ) : (
              <span className="doc-tag is-warn">No Match</span>
            )}
          </div>
          <div className="doc-facts">
            <div>
              <span>Document No.</span>
              {editable ? (
                <EditValue
                  open={edit === 'number'}
                  value={doc.documentNumber}
                  display={doc.documentNumber}
                  flagged={unsure(doc.confidence, 'documentNumber')}
                  label="Document No."
                  onOpen={() => setEdit('number')}
                  onChange={(documentNumber) => patch({ documentNumber })}
                  onClose={() => setEdit(null)}
                />
              ) : (
                <strong>{doc.documentNumber || '—'}</strong>
              )}
            </div>
            <div>
              <span>Date</span>
              {editable ? (
                <EditValue
                  open={edit === 'date'}
                  value={doc.documentDate}
                  display={saDate(doc.documentDate)}
                  flagged={unsure(doc.confidence, 'documentDate')}
                  label="Date"
                  onOpen={() => setEdit('date')}
                  onChange={(documentDate) => patch({ documentDate })}
                  onClose={() => setEdit(null)}
                />
              ) : (
                <strong>{doc.documentDate ? saDate(doc.documentDate) : '—'}</strong>
              )}
            </div>
            <div>
              <span>Branch</span>
              {editable && doc.branches.length > 1 && edit === 'branch' ? (
                <select
                  aria-label="Branch"
                  value={doc.branchId}
                  autoFocus
                  onBlur={() => setEdit(null)}
                  onChange={(event) => patch({ branchId: event.target.value })}
                >
                  {doc.branches.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  className="doc-glance"
                  onClick={() => editable && setEdit('branch')}
                >
                  <strong>{branchName}</strong>
                </button>
              )}
            </div>
            <div>
              <span>Total Incl. VAT</span>
              {editable ? (
                <EditValue
                  open={edit === 'total'}
                  value={doc.total}
                  display={doc.totalLabel || rands(doc.total)}
                  flagged={unsure(doc.confidence, 'total')}
                  label="Total Incl. VAT"
                  onOpen={() => setEdit('total')}
                  onChange={(total) => patch({ total })}
                  onClose={() => setEdit(null)}
                />
              ) : (
                <strong>{doc.totalLabel || '—'}</strong>
              )}
            </div>
          </div>
          {doc.status !== 'failed' ? (
            <p className={statusOk ? 'doc-status is-ok' : 'doc-status is-warn'} role="status">
              {doc.status === 'posted'
                ? 'Stock was received.'
                : doc.status === 'reversed'
                  ? 'The receipt was reversed.'
                  : statusText}
            </p>
          ) : null}
        </section>

        {doc.lines.length === 0 && !waiting ? (
          <p>No lines were read.</p>
        ) : (
          <>
            <div className="doc-lines-table ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Unit Cost</th>
                    <th>Line Total</th>
                    <th>Matched Item</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        {editable ? (
                          <EditValue
                            open={edit === `${line.id}:item`}
                            value={line.description}
                            display={line.description}
                            flagged={unsure(line.confidence, 'description')}
                            label="Item"
                            onOpen={() => setEdit(`${line.id}:item`)}
                            onChange={(description) => patchLine(line.id, { description })}
                            onClose={() => setEdit(null)}
                          />
                        ) : (
                          line.description
                        )}
                      </td>
                      <td>
                        {editable ? (
                          <EditValue
                            open={edit === `${line.id}:qty`}
                            value={line.quantity}
                            display={line.quantity}
                            flagged={unsure(line.confidence, 'quantity')}
                            label="Qty"
                            onOpen={() => setEdit(`${line.id}:qty`)}
                            onChange={(quantity) => patchLine(line.id, { quantity })}
                            onClose={() => setEdit(null)}
                          />
                        ) : (
                          line.quantity
                        )}
                      </td>
                      <td>
                        {editable ? (
                          <EditValue
                            open={edit === `${line.id}:cost`}
                            value={line.unitPrice}
                            display={rands(line.unitPrice)}
                            flagged={unsure(line.confidence, 'unitPrice')}
                            label="Unit Cost"
                            onOpen={() => setEdit(`${line.id}:cost`)}
                            onChange={(unitPrice) => patchLine(line.id, { unitPrice })}
                            onClose={() => setEdit(null)}
                          />
                        ) : (
                          rands(line.unitPrice)
                        )}
                      </td>
                      <td>
                        {editable ? (
                          <EditValue
                            open={edit === `${line.id}:line`}
                            value={line.lineTotal}
                            display={rands(line.lineTotal)}
                            flagged={unsure(line.confidence, 'lineTotal')}
                            label="Line Total"
                            onOpen={() => setEdit(`${line.id}:line`)}
                            onChange={(lineTotal) => patchLine(line.id, { lineTotal })}
                            onClose={() => setEdit(null)}
                          />
                        ) : (
                          rands(line.lineTotal)
                        )}
                      </td>
                      <td>
                        <MatchTag
                          line={line}
                          editable={editable}
                          busy={busy}
                          open={linking === line.id}
                          onLink={() => setLinking(line.id)}
                          onClose={() => setLinking(null)}
                          onPick={(itemId, itemName) => {
                            patchLine(line.id, { itemId, itemName, matchMethod: 'chosen' });
                            setLinking(null);
                          }}
                          onCreate={() => void createItem(line.id)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="doc-lines-cards">
              {doc.lines.map((line) => (
                <article key={line.id} className="doc-card">
                  {editable ? (
                    <EditValue
                      open={edit === `${line.id}:item`}
                      value={line.description}
                      display={line.description}
                      flagged={unsure(line.confidence, 'description')}
                      label="Item"
                      onOpen={() => setEdit(`${line.id}:item`)}
                      onChange={(description) => patchLine(line.id, { description })}
                      onClose={() => setEdit(null)}
                    />
                  ) : (
                    <h3>{line.description}</h3>
                  )}
                  <p>
                    {editable ? (
                      <EditValue
                        open={edit === `${line.id}:qty`}
                        value={line.quantity}
                        display={line.quantity}
                        flagged={unsure(line.confidence, 'quantity')}
                        label="Qty"
                        onOpen={() => setEdit(`${line.id}:qty`)}
                        onChange={(quantity) => patchLine(line.id, { quantity })}
                        onClose={() => setEdit(null)}
                      />
                    ) : (
                      line.quantity
                    )}{' '}
                    ×{' '}
                    {editable ? (
                      <EditValue
                        open={edit === `${line.id}:cost`}
                        value={line.unitPrice}
                        display={rands(line.unitPrice)}
                        flagged={unsure(line.confidence, 'unitPrice')}
                        label="Unit Cost"
                        onOpen={() => setEdit(`${line.id}:cost`)}
                        onChange={(unitPrice) => patchLine(line.id, { unitPrice })}
                        onClose={() => setEdit(null)}
                      />
                    ) : (
                      rands(line.unitPrice)
                    )}{' '}
                    ={' '}
                    {editable ? (
                      <EditValue
                        open={edit === `${line.id}:line`}
                        value={line.lineTotal}
                        display={rands(line.lineTotal)}
                        flagged={unsure(line.confidence, 'lineTotal')}
                        label="Line Total"
                        onOpen={() => setEdit(`${line.id}:line`)}
                        onChange={(lineTotal) => patchLine(line.id, { lineTotal })}
                        onClose={() => setEdit(null)}
                      />
                    ) : (
                      rands(line.lineTotal)
                    )}
                  </p>
                  <MatchTag
                    line={line}
                    editable={editable}
                    busy={busy}
                    open={linking === line.id}
                    onLink={() => setLinking(line.id)}
                    onClose={() => setLinking(null)}
                    onPick={(itemId, itemName) => {
                      patchLine(line.id, { itemId, itemName, matchMethod: 'chosen' });
                      setLinking(null);
                    }}
                    onCreate={() => void createItem(line.id)}
                  />
                </article>
              ))}
            </div>
          </>
        )}

        <button type="button" className="doc-more" onClick={() => setMore((open) => !open)}>
          {more ? 'Hide Details' : 'More Details'}
          {hiddenFlag ? <span className="doc-tag is-warn">Check</span> : null}
        </button>
        {more ? (
          <section className="ui-card doc-more-panel">
            <SelectField
              label="Document Type"
              value={doc.documentType}
              disabled={!editable}
              onChange={(documentType) => patch({ documentType })}
            >
              <option value="tax_invoice">Tax Invoice</option>
              <option value="delivery_note">Delivery Note</option>
            </SelectField>
            <Detail
              label="VAT Number"
              value={doc.supplierVat}
              flagged={unsure(doc.confidence, 'supplierVat')}
              editable={editable}
              optional
              onChange={(supplierVat) => patch({ supplierVat })}
            />
            <Detail
              label="Due Date"
              value={doc.dueDate}
              display={doc.dueDate ? saDate(doc.dueDate) : ''}
              flagged={unsure(doc.confidence, 'dueDate')}
              editable={editable}
              optional
              onChange={(dueDate) => patch({ dueDate })}
            />
            <Detail
              label="Currency"
              value={doc.currency}
              flagged={unsure(doc.confidence, 'currency')}
              editable={editable}
              onChange={(currency) => patch({ currency })}
            />
            <Detail
              label="Subtotal"
              value={doc.subtotal}
              display={rands(doc.subtotal)}
              flagged={unsure(doc.confidence, 'subtotal')}
              editable={editable}
              onChange={(subtotal) => patch({ subtotal })}
            />
            <Detail
              label="VAT"
              value={doc.vat}
              display={rands(doc.vat)}
              flagged={unsure(doc.confidence, 'vat')}
              editable={editable}
              onChange={(vat) => patch({ vat })}
            />
            {doc.lines.map((line) => (
              <div key={`${line.id}-more`} className="doc-more-line">
                <span>{line.description || `Line ${line.lineNo}`}</span>
                <Detail
                  label="Supplier Code"
                  value={line.supplierCode}
                  flagged={unsure(line.confidence, 'supplierCode')}
                  editable={editable}
                  optional
                  onChange={(supplierCode) => patchLine(line.id, { supplierCode })}
                />
                <Detail
                  label="Line VAT"
                  value={line.vat}
                  display={rands(line.vat)}
                  flagged={unsure(line.confidence, 'vat')}
                  editable={editable}
                  onChange={(vat) => patchLine(line.id, { vat })}
                />
              </div>
            ))}
            {doc.status === 'posted' ? (
              <Button variant="secondary" disabled={busy} onClick={() => setUndoOpen(true)}>
                Undo Receipt
              </Button>
            ) : null}
          </section>
        ) : null}

        {doc.goodsReceiptId && doc.status === 'posted' ? (
          <div className="doc-actions">
            <Button onClick={() => navigate(`/stock/receipts/${doc.goodsReceiptId}/labels`)}>
              Print Labels
            </Button>
          </div>
        ) : null}

        {editable ? (
          <div className="doc-actions">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void save().then((saved) => {
                  if (saved) {
                    notify({ title: 'Saved For Later.' });
                  }
                })
              }
            >
              Save For Later
            </Button>
            <Button
              disabled={busy || unmatched || doc.lines.length === 0}
              onClick={() => void receive()}
            >
              Receive Stock
            </Button>
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={undoOpen}
        onOpenChange={setUndoOpen}
        title="Undo Receipt"
        body="This posts a reversing stock movement. The document stays on file."
        confirmLabel="Undo Receipt"
        busy={busy}
        onConfirm={() => void undo()}
      />
    </div>
  );
}

function Detail({
  label,
  value,
  display,
  flagged,
  editable,
  optional,
  onChange,
}: {
  label: string;
  value: string;
  display?: string;
  flagged: boolean;
  editable: boolean;
  optional?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <span className="doc-detail-label">{label}</span>
      {editable ? (
        <EditValue
          open={open}
          value={value}
          display={display || value}
          flagged={flagged}
          optional={optional}
          label={label}
          onOpen={() => setOpen(true)}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      ) : (
        <strong>{value.trim() ? display || value : optional ? '—' : 'Could Not Read'}</strong>
      )}
    </div>
  );
}

function MatchTag({
  line,
  editable,
  busy,
  open,
  onLink,
  onClose,
  onPick,
  onCreate,
}: {
  line: Line;
  editable: boolean;
  busy: boolean;
  open: boolean;
  onLink: () => void;
  onClose: () => void;
  onPick: (itemId: string, itemName: string) => void;
  onCreate: () => void;
}) {
  if (line.itemName && !open) {
    return <span className="doc-tag">{line.itemName}</span>;
  }
  return (
    <div className="doc-link">
      {!line.itemName ? <span className="doc-tag is-warn">No Match</span> : null}
      {editable && open ? (
        <ItemSearch onPick={onPick} onClose={onClose} />
      ) : editable ? (
        <span className="ui-actions">
          <Button variant="secondary" disabled={busy} onClick={onLink}>
            Link To Item
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onCreate}>
            Create Item
          </Button>
        </span>
      ) : null}
    </div>
  );
}

function ItemSearch({
  onPick,
  onClose,
}: {
  onPick: (itemId: string, itemName: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CatalogHit[]>([]);

  useEffect(() => {
    let cancel = false;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ filter: 'active', q: query });
      void api(`/scm/items?${params.toString()}`).then(({ status, body }) => {
        if (cancel || status !== 200 || !body || typeof body !== 'object' || !('items' in body)) {
          return;
        }
        const items = (body as { items: CatalogHit[] }).items.filter(
          (item) => item.kind === 'stock',
        );
        setHits(items.slice(0, 6));
      });
    }, 200);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="doc-search">
      <input
        aria-label="Link To Item"
        placeholder="Search the catalog"
        value={query}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul>
        {hits.map((hit) => (
          <li key={hit.id}>
            <button type="button" onClick={() => onPick(hit.id, hit.name)}>
              {hit.name}
            </button>
          </li>
        ))}
      </ul>
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
    </div>
  );
}
