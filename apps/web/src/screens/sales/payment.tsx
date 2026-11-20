import {
  centsToDecimal,
  formatSaDate,
  formatZar,
  johannesburgToday,
  money,
  parseSaDate,
  zarFromDecimal,
} from '@omnivate/shared';
import { Button, Card, PageHeader, TextField, usePhone } from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api, errorMessage, type Navigate } from '../../api';

type OpenInvoice = {
  id: string;
  number: string;
  issuedOn: string;
  dueOn: string | null;
  balance: { cents: string; label: string };
};

function allocateOldest(amountCents: bigint, invoices: OpenInvoice[]): Record<string, string> {
  const sorted = [...invoices].sort(
    (left, right) =>
      left.issuedOn.localeCompare(right.issuedOn) ||
      (left.dueOn ?? '').localeCompare(right.dueOn ?? ''),
  );
  let left = amountCents < 0n ? 0n : amountCents;
  const amounts: Record<string, string> = {};
  for (const invoice of sorted) {
    const open = BigInt(invoice.balance.cents);
    const take = left > open ? open : left;
    amounts[invoice.id] = centsToDecimal(take);
    left -= take;
  }
  return amounts;
}

export function PaymentScreen({ navigate, invoiceId }: { navigate: Navigate; invoiceId: string }) {
  const phone = usePhone();
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [invoices, setInvoices] = useState<OpenInvoice[]>([]);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(formatSaDate(johannesburgToday()));
  const [method, setMethod] = useState('eft');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api(`/sales/invoices/${invoiceId}`).then(async ({ status, body }) => {
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object' || !('customerId' in body)) {
        setError(errorMessage(body, 'That invoice was not found.'));
        return;
      }
      const document = body as { customerId: string; customerName: string };
      setCustomerId(document.customerId);
      setCustomerName(document.customerName);
      const open = await api(`/sales/invoices/${invoiceId}/open`);
      if (open.status !== 200 || !open.body || typeof open.body !== 'object') return;
      const list = (open.body as { invoices: OpenInvoice[] }).invoices;
      const total = list.reduce((sum, row) => sum + BigInt(row.balance.cents), 0n);
      setInvoices(list);
      setAmount(centsToDecimal(total));
      setAllocations(allocateOldest(total, list));
    });
  }, [invoiceId, navigate]);

  function changeAmount(next: string) {
    setAmount(next);
    try {
      setAllocations(allocateOldest(zarFromDecimal(next).amountCents, invoices));
    } catch {
      setAllocations(allocateOldest(0n, invoices));
    }
  }

  async function save() {
    setBusy(true);
    setError('');
    const date = parseSaDate(paidOn);
    if (!date) {
      setBusy(false);
      setError('Enter the date as 19 Nov 2026.');
      return;
    }
    const chosen = invoices
      .map((row) => ({ invoiceId: row.id, amount: allocations[row.id] ?? '0.00' }))
      .filter((row) => {
        try {
          return zarFromDecimal(row.amount).amountCents > 0n;
        } catch {
          return false;
        }
      });
    const { status, body } = await api('/sales/payments', {
      method: 'POST',
      body: JSON.stringify({
        customerId,
        paidOn: date,
        amount,
        method,
        reference,
        allocations: chosen,
      }),
    });
    setBusy(false);
    if (status !== 201) {
      setError(errorMessage(body, 'The payment was not recorded.'));
      return;
    }
    navigate(`/invoices/${invoiceId}`);
  }

  return (
    <>
      <PageHeader
        title="Record Payment"
        description={customerName}
        actions={
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Record Payment'}
          </Button>
        }
      />
      {error ? (
        <Card>
          <p>{error}</p>
        </Card>
      ) : null}
      <Card>
        <div className="ui-doc-head">
          <TextField
            label="Amount"
            value={amount}
            onChange={changeAmount}
            hint="Rand"
            inputMode="decimal"
          />
          <TextField
            label="Date"
            type={phone ? 'date' : 'text'}
            value={phone ? (parseSaDate(paidOn) ?? '') : paidOn}
            onChange={(value) => setPaidOn(phone ? (value ? formatSaDate(value) : '') : value)}
            hint={phone ? undefined : '19 Nov 2026'}
          />
          <label className="ui-field">
            <span>Method</span>
            <select value={method} onChange={(event) => setMethod(event.target.value)}>
              <option value="eft">EFT</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
            </select>
          </label>
          <TextField label="Reference" value={reference} onChange={setReference} />
        </div>
        <div className="ui-table-wrap ui-compact-lines">
          <table className="ui-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th>Due</th>
                <th>Open Amount</th>
                <th>Allocate</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((row) => (
                <tr key={row.id}>
                  <td>{row.number}</td>
                  <td>{formatSaDate(row.issuedOn)}</td>
                  <td>{row.dueOn ? formatSaDate(row.dueOn) : ''}</td>
                  <td>{row.balance.label}</td>
                  <td>
                    <input
                      className="ui-input"
                      aria-label={`Allocate ${row.number}`}
                      inputMode="decimal"
                      value={allocations[row.id] ?? ''}
                      onChange={(event) =>
                        setAllocations((current) => ({ ...current, [row.id]: event.target.value }))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {invoices.length === 0 ? <p>This customer has no open tax invoices.</p> : null}
        <p>
          Allocated{' '}
          {(() => {
            try {
              const sum = invoices.reduce(
                (total, row) => total + zarFromDecimal(allocations[row.id] || '0').amountCents,
                0n,
              );
              return formatZar(money(sum));
            } catch {
              return '—';
            }
          })()}
        </p>
      </Card>
    </>
  );
}
