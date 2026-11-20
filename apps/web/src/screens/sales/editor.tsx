import {
  bumpQuantity,
  formatSaDate,
  formatZar,
  johannesburgToday,
  money,
  parseSaDate,
  parseSalesQuantity,
  salesLineAmounts,
  sumSalesLines,
  zarFromDecimal,
  type CustomFieldDefinition,
  type CustomFieldValue,
} from '@omnivate/shared';
import {
  Badge,
  Button,
  Card,
  CheckField,
  CustomFieldsForm,
  Menu,
  PageHeader,
  SelectField,
  TextAreaField,
  TextField,
  usePhone,
} from '@omnivate/ui';
import { useEffect, useRef, useState } from 'react';
import { API_BASE, api, errorMessage, type Navigate } from '../../api';
import { ScanCamera } from '../stock/ScanCamera';
import { createScanBuffer, playScanTone } from '../stock/scan-feedback';

type MoneyLabel = { cents: string; label: string };

type CustomerOption = {
  id: string;
  name: string;
  vatNumber: string;
  address: string;
};

type CatalogItem = {
  id: string;
  code: string;
  name: string;
  barcode: string;
  unitPrice: string;
};

type LineDraft = {
  key: string;
  itemId: string;
  itemQuery: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  open: boolean;
};

type SalesDocument = {
  id: string;
  kind: 'quote' | 'invoice' | 'credit_note';
  status: string;
  statusLabel: string;
  number: string | null;
  customerId: string;
  customerName: string;
  customerVat: string;
  customerAddress: string;
  customerContact: string;
  issuedOn: string | null;
  dueOn: string | null;
  validUntil: string | null;
  notes: string;
  invoiceNumber: string | null;
  linkedInvoiceId: string | null;
  net: MoneyLabel;
  vat: MoneyLabel;
  total: MoneyLabel;
  balance: MoneyLabel | null;
  allocated: MoneyLabel | null;
  canEdit: boolean;
  lines: {
    id: string;
    itemId: string | null;
    description: string;
    quantity: string;
    unitPrice: string;
    discount: string;
    vat: MoneyLabel;
    total: MoneyLabel;
  }[];
  definitions: CustomFieldDefinition[];
  values: Record<string, CustomFieldValue>;
  canEditFields: boolean;
  vatRateBasisPoints: number;
};

function tone(status: string): 'ok' | 'warn' | 'bad' | 'info' | 'neutral' {
  if (status === 'Paid' || status === 'Accepted') return 'ok';
  if (status === 'Overdue' || status === 'Declined') return 'bad';
  if (status === 'Expired' || status === 'Partly Paid') return 'warn';
  if (status === 'Sent' || status === 'Issued') return 'info';
  return 'neutral';
}

function blankLine(): LineDraft {
  return {
    key: crypto.randomUUID(),
    itemId: '',
    itemQuery: '',
    description: '',
    quantity: '1',
    unitPrice: '',
    discount: '',
    open: false,
  };
}

function lineMoney(line: LineDraft, rate: number) {
  try {
    return salesLineAmounts({
      quantity: parseSalesQuantity(line.quantity),
      unitPriceCents: zarFromDecimal(line.unitPrice || '0').amountCents,
      discountCents: line.discount.trim() ? zarFromDecimal(line.discount).amountCents : 0n,
      vatBasisPoints: rate,
    });
  } catch {
    return null;
  }
}

function draftTotals(lines: LineDraft[], rate: number) {
  const priced = lines.map((line) => lineMoney(line, rate));
  if (priced.some((line) => !line)) return null;
  const totals = sumSalesLines(priced.flatMap((line) => (line ? [line] : [])));
  return {
    net: formatZar(money(totals.netCents)),
    vat: formatZar(money(totals.vatCents)),
    total: formatZar(money(totals.totalCents)),
  };
}

async function downloadPdf(id: string): Promise<string | null> {
  const response = await fetch(`${API_BASE}/sales/documents/${id}/pdf`, { credentials: 'include' });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    return body?.message ?? 'The PDF did not download.';
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const match = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '');
  link.href = url;
  link.download = match?.[1] ?? 'document.pdf';
  link.click();
  URL.revokeObjectURL(url);
  return null;
}

function useCustomers(navigate: Navigate) {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  useEffect(() => {
    void api('/sales/customers').then(({ status, body }) => {
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status === 200 && body && typeof body === 'object' && 'customers' in body) {
        setCustomers((body as { customers: CustomerOption[] }).customers);
      }
    });
  }, [navigate]);
  return customers;
}

function useCatalog(navigate: Navigate) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  useEffect(() => {
    void api('/sales/catalog').then(({ status, body }) => {
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status === 200 && body && typeof body === 'object' && 'items' in body) {
        setItems((body as { items: CatalogItem[] }).items);
      }
    });
  }, [navigate]);
  return items;
}

export function DocumentScreen({
  navigate,
  kind,
  documentId,
}: {
  navigate: Navigate;
  kind: 'quote' | 'invoice';
  documentId: string | null;
}) {
  const phone = usePhone();
  const customers = useCustomers(navigate);
  const catalog = useCatalog(navigate);
  const [doc, setDoc] = useState<SalesDocument | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [notes, setNotes] = useState('');
  const [when, setWhen] = useState('');
  const [deductStock, setDeductStock] = useState(false);
  const [more, setMore] = useState(false);
  const [fields, setFields] = useState<CustomFieldDefinition[]>([]);
  const [values, setValues] = useState<Record<string, CustomFieldValue | null>>({});
  const [canEditFields, setCanEditFields] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState('');
  const [flash, setFlash] = useState<'ok' | 'bad' | ''>('');
  const scans = useRef(createScanBuffer());

  useEffect(() => {
    if (!documentId) {
      setWhen(formatSaDate(johannesburgToday()));
      return;
    }
    const path = kind === 'quote' ? `/sales/quotes/${documentId}` : `/sales/invoices/${documentId}`;
    void api(path).then(({ status, body }) => {
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object' || !('id' in body)) {
        setError(errorMessage(body, 'That document was not found.'));
        return;
      }
      const loaded = body as SalesDocument;
      setDoc(loaded);
      setCustomerId(loaded.customerId);
      setLines(
        loaded.lines.map((line) => ({
          key: line.id,
          itemId: line.itemId ?? '',
          itemQuery: line.itemId ? line.description : '',
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount === '0.00' ? '' : line.discount,
          open: false,
        })),
      );
      setNotes(loaded.notes);
      const iso = kind === 'quote' ? loaded.validUntil : loaded.dueOn;
      setWhen(iso ? formatSaDate(iso) : '');
      setFields(loaded.definitions);
      setValues(loaded.values);
      setCanEditFields(loaded.canEditFields);
    });
  }, [documentId, kind, navigate]);

  const rate = doc?.vatRateBasisPoints ?? 1500;
  const totals = draftTotals(lines, rate);
  const customer = customers.find((item) => item.id === customerId);
  const editable = !doc || doc.canEdit;
  const heading = kind === 'quote' ? 'Quote' : 'Tax Invoice';
  const dateText = editable ? when : when || (doc?.issuedOn ? formatSaDate(doc.issuedOn) : '');

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addScannedItem(item: CatalogItem) {
    setLines((current) => {
      const index = current.findIndex((line) => line.itemId === item.id);
      if (index < 0) {
        const blank = current.length === 1 && !current[0]?.description && !current[0]?.itemId;
        const next = {
          key: crypto.randomUUID(),
          itemId: item.id,
          itemQuery: `${item.code} · ${item.name}`,
          description: item.name,
          quantity: '1',
          unitPrice: item.unitPrice,
          discount: '',
          open: false,
        };
        return blank ? [next] : [...current, next];
      }
      return current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, quantity: bumpQuantity(line.quantity) } : line,
      );
    });
    setScan('');
    setFlash('ok');
    playScanTone(true);
    window.setTimeout(() => setFlash(''), 400);
  }

  async function applyCode(code: string) {
    const needle = code.trim().toLowerCase();
    if (!needle) return;
    const local = catalog.find(
      (item) => item.barcode.toLowerCase() === needle || item.code.toLowerCase() === needle,
    );
    if (local) {
      addScannedItem(local);
      return;
    }
    const found = await api(`/sales/catalog?q=${encodeURIComponent(code.trim())}`);
    const items =
      found.status === 200 && found.body && typeof found.body === 'object' && 'items' in found.body
        ? (found.body as { items: CatalogItem[] }).items
        : [];
    const match =
      items.find((item) => item.barcode.toLowerCase() === needle) ??
      items.find((item) => item.code.toLowerCase() === needle) ??
      null;
    if (!match) {
      setFlash('bad');
      playScanTone(false);
      setError(`No item uses the barcode ${code.trim()}.`);
      window.setTimeout(() => setFlash(''), 400);
      setScan('');
      return;
    }
    setError('');
    addScannedItem(match);
  }

  async function persist(next: 'save' | 'send' | 'issue' | 'accept' | 'invoice') {
    setBusy(true);
    setError('');
    const parsedWhen = when.trim() ? parseSaDate(when) : null;
    if (when.trim() && !parsedWhen) {
      setBusy(false);
      setError('Enter the date as 19 Nov 2026.');
      return;
    }
    const payload = {
      customerId,
      notes,
      validUntil: kind === 'quote' ? parsedWhen : undefined,
      dueOn: kind === 'invoice' ? parsedWhen : undefined,
      customFields: values,
      lines: lines.map((line) => ({
        itemId: line.itemId || null,
        description: line.description || line.itemQuery,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
      })),
    };
    let id = documentId;
    if (editable && next !== 'accept' && next !== 'invoice') {
      const path = id
        ? kind === 'quote'
          ? `/sales/quotes/${id}`
          : `/sales/invoices/${id}`
        : kind === 'quote'
          ? '/sales/quotes'
          : '/sales/invoices';
      const saved = await api(path, {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      if (saved.status !== 200 && saved.status !== 201) {
        setBusy(false);
        setError(errorMessage(saved.body, 'The document was not saved.'));
        return;
      }
      id = (saved.body as { id: string }).id;
    }
    if (!id) {
      setBusy(false);
      return;
    }
    if (next === 'send' || next === 'accept') {
      const status = next === 'send' ? 'sent' : 'accepted';
      const result = await api(`/sales/quotes/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      if (result.status !== 200) {
        setBusy(false);
        setError(errorMessage(result.body, 'The quote was not updated.'));
        return;
      }
    }
    if (next === 'issue') {
      const issued = await api(`/sales/invoices/${id}/issue`, {
        method: 'POST',
        body: JSON.stringify({ deductStock }),
      });
      if (issued.status !== 200) {
        setBusy(false);
        setError(errorMessage(issued.body, 'The tax invoice was not issued.'));
        return;
      }
    }
    if (next === 'invoice') {
      const created = await api(`/sales/quotes/${id}/invoice`, {
        method: 'POST',
        body: JSON.stringify({ deductStock }),
      });
      setBusy(false);
      if (created.status !== 201) {
        setError(errorMessage(created.body, 'The invoice was not created.'));
        return;
      }
      navigate(`/invoices/${(created.body as { id: string }).id}`);
      return;
    }
    setBusy(false);
    navigate(kind === 'quote' ? `/quotes/${id}` : `/invoices/${id}`);
  }

  const primary =
    kind === 'invoice'
      ? doc?.status === 'issued'
        ? doc.balance && doc.balance.cents !== '0'
          ? { label: 'Record Payment', run: () => navigate(`/invoices/${doc.id}/payment`) }
          : null
        : { label: 'Issue Invoice', run: () => void persist('issue') }
      : doc?.statusLabel === 'Sent'
        ? { label: 'Mark Accepted', run: () => void persist('accept') }
        : doc?.statusLabel === 'Accepted'
          ? { label: 'Create Invoice', run: () => void persist('invoice') }
          : doc
            ? { label: 'Mark As Sent', run: () => void persist('send') }
            : { label: 'Save', run: () => void persist('save') };

  const menu = [
    ...(kind === 'quote' && (!doc || doc.status === 'draft')
      ? [{ label: 'Save', onSelect: () => void persist('save') }]
      : []),
    ...(kind === 'invoice' && (!doc || doc.status === 'draft')
      ? [{ label: 'Save Draft', onSelect: () => void persist('save') }]
      : []),
    ...(doc
      ? [
          {
            label: 'Download PDF',
            onSelect: () =>
              void downloadPdf(doc.id).then((message) => message && setError(message)),
          },
        ]
      : []),
    ...(doc && kind === 'invoice' && doc.status === 'issued'
      ? [{ label: 'Credit Note', onSelect: () => navigate(`/invoices/${doc.id}/credit`) }]
      : []),
    ...(doc?.linkedInvoiceId
      ? [{ label: 'Open Invoice', onSelect: () => navigate(`/invoices/${doc.linkedInvoiceId}`) }]
      : []),
    ...(kind === 'quote' && doc && (doc.status === 'draft' || doc.status === 'sent')
      ? [
          {
            label: 'Decline',
            onSelect: () =>
              void api(`/sales/quotes/${doc.id}/status`, {
                method: 'POST',
                body: JSON.stringify({ status: 'declined' }),
              }).then(() => navigate(`/quotes/${doc.id}`)),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={
          <>
            {heading}
            {doc?.number ? <span className="ui-doc-ref">{doc.number}</span> : null}
            {doc ? <Badge tone={tone(doc.statusLabel)}>{doc.statusLabel}</Badge> : null}
          </>
        }
        description={
          customer?.name ?? doc?.customerName ?? 'Choose a customer, then fill in the lines.'
        }
        actions={
          <>
            {menu.length > 0 ? <Menu items={menu} /> : null}
            {primary ? (
              <Button disabled={busy} onClick={primary.run}>
                {busy ? 'Saving…' : primary.label}
              </Button>
            ) : null}
          </>
        }
      />
      {error ? (
        <Card>
          <p>{error}</p>
        </Card>
      ) : null}
      <Card>
        <div className="ui-doc-head">
          {editable ? (
            <SelectField label="Customer" value={customerId} onChange={setCustomerId}>
              <option value="">Choose A Customer</option>
              {customers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SelectField>
          ) : (
            <div>
              <span className="ui-hint">Customer</span>
              <p>{doc?.customerName}</p>
              <p>{doc?.customerVat ? `VAT ${doc.customerVat}` : 'Not Registered For VAT'}</p>
              <p>{doc?.customerAddress}</p>
            </div>
          )}
          <TextField
            label={kind === 'quote' ? 'Valid Until' : 'Due Date'}
            type={phone ? 'date' : 'text'}
            value={phone ? (parseSaDate(dateText) ?? '') : dateText}
            onChange={(value) => setWhen(phone ? (value ? formatSaDate(value) : '') : value)}
            disabled={!editable}
          />
          {doc?.issuedOn ? (
            <TextField
              label="Date"
              value={formatSaDate(doc.issuedOn)}
              onChange={() => undefined}
              disabled
            />
          ) : (
            <TextField
              label="Date"
              value={formatSaDate(johannesburgToday())}
              onChange={() => undefined}
              disabled
            />
          )}
        </div>
        {editable ? (
          <div className={flash ? `scan-ready is-${flash}` : 'scan-ready'}>
            <TextField
              label="Scan A Barcode"
              value={scan}
              onChange={setScan}
              placeholder="Scan, then the reader sends Enter"
              autoComplete="off"
              onKeyDown={(event) => {
                scans.current.push(event.key);
                if (event.key !== 'Enter') return;
                event.preventDefault();
                void applyCode(event.currentTarget.value);
              }}
            />
            <ScanCamera onScan={(code) => void applyCode(code)} />
          </div>
        ) : null}
        <div className="ui-table-wrap ui-doc-lines">
          <table className="ui-table">
            <thead>
              <tr>
                <th className="is-item">Item</th>
                <th className="is-narrow">Qty</th>
                <th className="is-money">Unit Price</th>
                <th className="is-narrow">Discount</th>
                <th className="is-money">VAT</th>
                <th className="is-money">Line Total</th>
                <th className="is-end" />
              </tr>
            </thead>
            <tbody>
              {(editable ? lines : lines).map((line) => {
                const amounts = lineMoney(line, rate);
                const matches = catalog
                  .filter((item) => {
                    const q = line.itemQuery.trim().toLowerCase();
                    if (!q) return true;
                    return `${item.code} ${item.name}`.toLowerCase().includes(q);
                  })
                  .slice(0, 6);
                return (
                  <tr key={line.key}>
                    <td className="is-item" data-label="Item">
                      {editable ? (
                        <>
                          <input
                            className="ui-input"
                            aria-label="Item"
                            placeholder="Search or free text"
                            value={line.itemQuery}
                            onFocus={() => updateLine(line.key, { open: true })}
                            onChange={(event) =>
                              updateLine(line.key, {
                                itemQuery: event.target.value,
                                itemId: '',
                                open: true,
                              })
                            }
                          />
                          <input
                            className="ui-input ui-line-note"
                            aria-label="Description"
                            placeholder="Description"
                            value={line.description}
                            onChange={(event) =>
                              updateLine(line.key, { description: event.target.value })
                            }
                          />
                          {line.open ? (
                            <div className="ui-combo-list">
                              {matches.map((item) => (
                                <Button
                                  key={item.id}
                                  variant="ghost"
                                  onClick={() =>
                                    updateLine(line.key, {
                                      itemId: item.id,
                                      itemQuery: `${item.code} · ${item.name}`,
                                      description: item.name,
                                      unitPrice: item.unitPrice,
                                      open: false,
                                    })
                                  }
                                >
                                  {item.code} · {item.name}
                                </Button>
                              ))}
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  updateLine(line.key, {
                                    itemId: '',
                                    description: line.itemQuery || line.description,
                                    open: false,
                                  })
                                }
                              >
                                Free Text
                              </Button>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <div>{line.itemQuery || 'Free Text'}</div>
                          <div>{line.description}</div>
                        </>
                      )}
                    </td>
                    <td className="is-narrow" data-label="Quantity">
                      {editable ? (
                        <input
                          className="ui-input"
                          aria-label="Quantity"
                          placeholder="Qty"
                          inputMode="decimal"
                          value={line.quantity}
                          onChange={(event) =>
                            updateLine(line.key, { quantity: event.target.value })
                          }
                        />
                      ) : (
                        line.quantity
                      )}
                    </td>
                    <td className="is-money" data-label="Unit Price">
                      {editable ? (
                        <input
                          className="ui-input"
                          aria-label="Unit Price"
                          placeholder="Price"
                          inputMode="decimal"
                          value={line.unitPrice}
                          onChange={(event) =>
                            updateLine(line.key, { unitPrice: event.target.value })
                          }
                        />
                      ) : (
                        line.unitPrice
                      )}
                    </td>
                    <td className="is-narrow" data-label="Discount">
                      {editable ? (
                        <input
                          className="ui-input"
                          aria-label="Discount"
                          placeholder="Disc"
                          inputMode="decimal"
                          value={line.discount}
                          onChange={(event) =>
                            updateLine(line.key, { discount: event.target.value })
                          }
                        />
                      ) : (
                        line.discount || '0.00'
                      )}
                    </td>
                    <td className="is-money" data-label="VAT">
                      {amounts ? formatZar(money(amounts.vatCents)) : ''}
                    </td>
                    <td className="is-money" data-label="Line Total">
                      {amounts ? formatZar(money(amounts.totalCents)) : ''}
                    </td>
                    <td className="is-end">
                      {editable && lines.length > 1 ? (
                        <Button
                          variant="ghost"
                          aria-label="Remove Line"
                          onClick={() =>
                            setLines((current) => current.filter((item) => item.key !== line.key))
                          }
                        >
                          ×
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {editable ? (
          <Button variant="ghost" onClick={() => setLines((current) => [...current, blankLine()])}>
            Add Line
          </Button>
        ) : null}
        <div className="ui-totals">
          <span>Net</span>
          <strong>{editable ? (totals?.net ?? '—') : doc?.net.label}</strong>
          <span>VAT</span>
          <strong>{editable ? (totals?.vat ?? '—') : doc?.vat.label}</strong>
          <span>Total</span>
          <strong>{editable ? (totals?.total ?? '—') : doc?.total.label}</strong>
          {doc?.allocated && doc.allocated.cents !== '0' ? (
            <>
              <span>Amount Paid</span>
              <strong>{doc.allocated.label}</strong>
            </>
          ) : null}
          {doc?.balance ? (
            <>
              <span>Amount Due</span>
              <strong>{doc.balance.label}</strong>
            </>
          ) : null}
        </div>
        <Button variant="ghost" onClick={() => setMore((open) => !open)}>
          {more ? 'Hide Details' : 'More Details'}
        </Button>
        {more ? (
          <>
            {editable ? (
              <TextAreaField label="Notes" value={notes} onChange={setNotes} />
            ) : notes ? (
              <p>{notes}</p>
            ) : null}
            {kind === 'invoice' && editable ? (
              <CheckField
                label="Deduct Stock"
                hint="Catalog items leave stock when you issue the tax invoice."
                checked={deductStock}
                onChange={setDeductStock}
              />
            ) : null}
            {doc?.statusLabel === 'Accepted' ? (
              <CheckField
                label="Deduct Stock"
                hint="Catalog items leave stock when the tax invoice is created."
                checked={deductStock}
                onChange={setDeductStock}
              />
            ) : null}
            <CustomFieldsForm
              fields={fields}
              values={values}
              disabled={!editable || (!canEditFields && fields.length > 0)}
              onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
            />
          </>
        ) : null}
      </Card>
    </>
  );
}

export function CreditScreen({ navigate, invoiceId }: { navigate: Navigate; invoiceId: string }) {
  const [doc, setDoc] = useState<SalesDocument | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api(`/sales/invoices/${invoiceId}`).then(({ status, body }) => {
      if (status !== 200 || !body || typeof body !== 'object' || !('lines' in body)) {
        setError(errorMessage(body, 'That invoice was not found.'));
        return;
      }
      const loaded = body as SalesDocument;
      setDoc(loaded);
      setQuantities(Object.fromEntries(loaded.lines.map((line) => [line.id, line.quantity])));
    });
  }, [invoiceId]);

  async function save() {
    if (!doc) return;
    setBusy(true);
    const { status, body } = await api(`/sales/invoices/${invoiceId}/credit-notes`, {
      method: 'POST',
      body: JSON.stringify({
        lines: doc.lines.map((line) => ({ lineId: line.id, quantity: quantities[line.id] ?? '0' })),
      }),
    });
    setBusy(false);
    if (status !== 201 || !body || typeof body !== 'object' || !('id' in body)) {
      setError(errorMessage(body, 'The credit note was not issued.'));
      return;
    }
    navigate(`/invoices/${(body as { id: string }).id}`);
  }

  return (
    <>
      <PageHeader
        title={
          <>
            Credit Note
            {doc?.number ? <span className="ui-doc-ref">{doc.invoiceNumber}</span> : null}
          </>
        }
        description={doc ? `Against ${doc.number ?? 'the tax invoice'}` : ''}
        actions={
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? 'Issuing…' : 'Issue Credit Note'}
          </Button>
        }
      />
      {error ? (
        <Card>
          <p>{error}</p>
        </Card>
      ) : null}
      <Card>
        <div className="ui-table-wrap ui-compact-lines">
          <table className="ui-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>On Invoice</th>
                <th>Credit Qty</th>
              </tr>
            </thead>
            <tbody>
              {doc?.lines.map((line) => (
                <tr key={line.id}>
                  <td data-label="Description">{line.description}</td>
                  <td data-label="On Invoice">{line.quantity}</td>
                  <td data-label="Credit Qty">
                    <input
                      className="ui-input"
                      aria-label={`Credit ${line.description}`}
                      inputMode="decimal"
                      value={quantities[line.id] ?? ''}
                      onChange={(event) =>
                        setQuantities((current) => ({ ...current, [line.id]: event.target.value }))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
