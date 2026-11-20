import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Card, PageHeader } from '@omnivate/ui';
import { api, errorMessage, type Navigate } from '../../api';

type FinanceModule = 'FIN-03' | 'FIN-04' | 'FIN-05' | 'FIN-06';
type Row = Record<string, unknown>;

const CONFIG: Record<FinanceModule, { title: string; description: string; endpoint: string; label: string }> = {
  'FIN-03': { title: 'Supplier Bills', description: 'Capture supplier invoices, post approved bills to the general ledger, and monitor outstanding balances.', endpoint: '/finance/creditors/bills', label: 'Bills' },
  'FIN-04': { title: 'Cashbook & Bank Reconciliation', description: 'Manage bank accounts, bring statement lines into the cashbook, match transactions, and reconcile closing balances.', endpoint: '/finance/cashbook/accounts', label: 'Bank accounts' },
  'FIN-05': { title: 'Petty Cash & Expense Claims', description: 'Control cash floats, record cash movements, and process staff expense claims with supporting receipts.', endpoint: '/finance/petty-cash/funds', label: 'Cash funds' },
  'FIN-06': { title: 'VAT & Tax', description: 'Maintain tax codes, capture input and output VAT, and prepare and file VAT periods.', endpoint: '/finance/tax/codes', label: 'Tax codes' },
};

function rowsFrom(body: unknown, key: string): Row[] {
  if (!body || typeof body !== 'object' || !(key in body)) return [];
  const value = (body as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.filter((item): item is Row => !!item && typeof item === 'object') : [];
}
function str(row: Row, key: string): string { return row[key] == null ? '' : String(row[key]); }
function money(cents: string): string {
  const value = Number(cents || 0);
  return Number.isFinite(value) ? `R ${(value / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
}
function Field({ label, name, type = 'text', required = true, placeholder }: { label: string; name: string; type?: string; required?: boolean; placeholder?: string }) {
  return <label style={{ display: 'grid', gap: 5, minWidth: 0, fontSize: 13 }}>{label}<input name={name} type={type} required={required} placeholder={placeholder} style={{ width: '100%', minHeight: 40, padding: '8px 10px', border: '1px solid var(--ui-border, #ccc)', borderRadius: 8, background: 'var(--ui-panel, white)', color: 'inherit' }} /></label>;
}
function SelectField({ label, name, options, valueKey = 'id', labelKey = 'name' }: { label: string; name: string; options: Row[]; valueKey?: string; labelKey?: string }) {
  return <label style={{ display: 'grid', gap: 5, minWidth: 0, fontSize: 13 }}>{label}<select name={name} required style={{ width: '100%', minHeight: 40, padding: '8px 10px', border: '1px solid var(--ui-border, #ccc)', borderRadius: 8, background: 'var(--ui-panel, white)', color: 'inherit' }}><option value="">Choose…</option>{options.map((option,i)=><option key={str(option,valueKey)||i} value={str(option,valueKey)}>{str(option,labelKey)} · {str(option,valueKey)}</option>)}</select></label>;
}
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <Card title={title}><div style={{ display: 'grid', gap: 12 }}>{children}</div></Card>;
}
function Table({ columns, rows, empty }: { columns: { key: string; label: string; format?: (value: string, row: Row) => string }[]; rows: Row[]; empty: string }) {
  return <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}><thead><tr>{columns.map(c => <th key={c.key} style={{ textAlign: 'left', padding: '10px 8px', borderBottom: '1px solid var(--ui-border, #ddd)', whiteSpace: 'nowrap' }}>{c.label}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row,i)=><tr key={str(row,'id')||i}>{columns.map(c=><td key={c.key} style={{ padding: '10px 8px', borderBottom: '1px solid var(--ui-border, #eee)', whiteSpace: 'nowrap' }}>{c.format ? c.format(str(row,c.key),row) : str(row,c.key)||'—'}</td>)}</tr>) : <tr><td colSpan={columns.length} style={{ padding: 18, opacity: .7 }}>{empty}</td></tr>}</tbody></table></div>;
}

export function FinanceOperationsScreen({ moduleId, navigate }: { moduleId: FinanceModule; navigate: Navigate }) {
  const config = CONFIG[moduleId];
  const [primary, setPrimary] = useState<Row[]>([]);
  const [secondary, setSecondary] = useState<Row[]>([]);
  const [tertiary, setTertiary] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [staff, setStaff] = useState<Row[]>([]);
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError('');
    if (moduleId === 'FIN-03') {
      const [bills, ageing, parties, gl] = await Promise.all([api('/finance/creditors/bills'), api('/finance/creditors/ageing'), api('/krn/parties?role=supplier'), api('/ledger/accounts')]);
      if (bills.status === 401 || ageing.status === 401) { navigate('/login'); return; }
      if (bills.status !== 200) { setError(errorMessage(bills.body, 'Supplier bills could not be loaded.')); return; }
      setPrimary(rowsFrom(bills.body,'bills')); setSecondary(rowsFrom(ageing.body,'rows')); setSuppliers(rowsFrom(parties.body,'parties')); setAccounts(rowsFrom(gl.body,'accounts')); return;
    }
    if (moduleId === 'FIN-04') {
      const [bankAccounts, txns, recs, gl] = await Promise.all([api('/finance/cashbook/accounts'), api('/finance/cashbook/transactions?unmatched=true'), api('/finance/cashbook/reconciliations'), api('/ledger/accounts')]);
      if (bankAccounts.status === 401) { navigate('/login'); return; }
      if (bankAccounts.status !== 200) { setError(errorMessage(bankAccounts.body,'Bank accounts could not be loaded.')); return; }
      setPrimary(rowsFrom(bankAccounts.body,'accounts')); setSecondary(rowsFrom(txns.body,'transactions')); setTertiary(rowsFrom(recs.body,'reconciliations')); setAccounts(rowsFrom(gl.body,'accounts')); return;
    }
    if (moduleId === 'FIN-05') {
      const [funds, claims, people, gl] = await Promise.all([api('/finance/petty-cash/funds'), api('/finance/petty-cash/claims'), api('/krn/parties?role=staff'), api('/ledger/accounts')]);
      if (funds.status === 401) { navigate('/login'); return; }
      if (funds.status !== 200) { setError(errorMessage(funds.body,'Petty-cash funds could not be loaded.')); return; }
      setPrimary(rowsFrom(funds.body,'funds')); setSecondary(rowsFrom(claims.body,'claims')); setStaff(rowsFrom(people.body,'parties')); setAccounts(rowsFrom(gl.body,'accounts')); return;
    }
    const [codes, periods, gl] = await Promise.all([api('/finance/tax/codes'), api('/finance/tax/periods'), api('/ledger/accounts')]);
    if (codes.status === 401) { navigate('/login'); return; }
    if (codes.status !== 200) { setError(errorMessage(codes.body,'Tax codes could not be loaded.')); return; }
    setPrimary(rowsFrom(codes.body,'codes')); setSecondary(rowsFrom(periods.body,'periods')); setAccounts(rowsFrom(gl.body,'accounts'));
  }, [moduleId, navigate]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function submit(event: FormEvent<HTMLFormElement>, path: string, transform?: (data: Record<string,string>) => unknown) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string,string>;
    const payload = transform ? transform(data) : data;
    const result = await api(path, { method: 'POST', body: JSON.stringify(payload) });
    setBusy(false);
    if (result.status < 200 || result.status >= 300) { setError(errorMessage(result.body, 'The action could not be completed.')); return; }
    form.reset(); setNotice('Saved successfully.'); await refresh();
  }
  async function action(path: string, payload: unknown = {}) {
    setBusy(true); setError(''); setNotice('');
    const result = await api(path, { method: 'POST', body: JSON.stringify(payload) });
    setBusy(false);
    if (result.status < 200 || result.status >= 300) { setError(errorMessage(result.body,'The action could not be completed.')); return; }
    setNotice('Action completed.'); await refresh();
  }

  return <div style={{ display: 'grid', gap: 18 }}>
    <PageHeader title={config.title} description={config.description} breadcrumbs={[{ label: 'Finance', href: '/ledger' }, { label: config.title }]} onNavigate={navigate} actions={<Button variant="secondary" onClick={() => void refresh()}>Refresh</Button>} />
    {error ? <div role="alert" style={{ padding: 12, borderRadius: 8, background: 'var(--ui-danger-soft, #fee)', color: 'var(--ui-danger, #900)' }}>{error}</div> : null}
    {notice ? <div role="status" style={{ padding: 12, borderRadius: 8, background: 'var(--ui-success-soft, #e8f6ed)' }}>{notice}</div> : null}

    {moduleId === 'FIN-03' ? <>
      <Panel title="New supplier bill"><form onSubmit={(e: FormEvent<HTMLFormElement>)=>submit(e,'/finance/creditors/bills',d=>({supplierId:d.supplierId, supplierReference:d.supplierReference, documentNumber:d.documentNumber, billDate:d.billDate, dueDate:d.dueDate, lines:[{description:d.description,accountId:d.accountId,quantityMilli:d.quantityMilli,unitCostCents:d.unitCostCents,netCents:d.netCents,vatCents:d.vatCents}]}))}>
        <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10 }}><SelectField label="Supplier" name="supplierId" options={suppliers} labelKey="displayName"/><Field label="Supplier reference" name="supplierReference" required={false}/><Field label="Document number" name="documentNumber"/><Field label="Bill date" name="billDate" type="date"/><Field label="Due date" name="dueDate" type="date"/><SelectField label="Expense account" name="accountId" options={accounts} labelKey="name"/><Field label="Line description" name="description"/><Field label="Quantity (thousandths)" name="quantityMilli"/><Field label="Unit cost (cents)" name="unitCostCents"/><Field label="Net (cents)" name="netCents"/><Field label="VAT (cents)" name="vatCents"/></div>
        <Button type="submit" disabled={busy}>Save draft bill</Button>
      </form></Panel>
      <Panel title="Supplier bills"><Table rows={primary} empty="No supplier bills yet." columns={[{key:'document_number',label:'Document'},{key:'supplier_name',label:'Supplier'},{key:'bill_date',label:'Bill date'},{key:'due_date',label:'Due date'},{key:'total_cents',label:'Total',format:v=>money(v)},{key:'paid_cents',label:'Paid',format:v=>money(v)},{key:'status',label:'Status'}]}/>
        <div style={{display:'flex',flexWrap:'wrap',gap:8}}>{primary.filter(x=>str(x,'status')==='draft').map(x=><Button key={str(x,'id')} disabled={busy} onClick={()=>void action(`/finance/creditors/bills/${str(x,'id')}/post`)}>Post {str(x,'document_number')}</Button>)}</div>
      </Panel>
      <Panel title="Record supplier payment"><form onSubmit={(e: FormEvent<HTMLFormElement>)=>submit(e,'/finance/creditors/payments',d=>({supplierId:d.supplierId,bankAccountId:d.bankAccountId,bankGlAccountId:d.bankGlAccountId,paymentDate:d.paymentDate,reference:d.reference,amountCents:d.amountCents,allocations:[{billId:d.billId,amountCents:d.allocationCents}]}))}><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}><SelectField label="Supplier" name="supplierId" options={suppliers} labelKey="displayName"/><Field label="Bank account ID (optional)" name="bankAccountId" required={false}/><SelectField label="Bank / cash GL account" name="bankGlAccountId" options={accounts} labelKey="name"/><Field label="Payment date" name="paymentDate" type="date"/><Field label="Reference" name="reference"/><Field label="Payment amount (cents)" name="amountCents"/><SelectField label="Posted bill" name="billId" options={primary.filter(x=>str(x,'status')==='posted')} labelKey="document_number"/><Field label="Allocation amount (cents)" name="allocationCents"/></div><Button type="submit" disabled={busy}>Post supplier payment</Button></form></Panel>
      <Panel title="Outstanding bills"><Table rows={secondary} empty="No outstanding supplier bills." columns={[{key:'supplier_name',label:'Supplier'},{key:'document_number',label:'Document'},{key:'due_date',label:'Due date'},{key:'days_overdue',label:'Days overdue'},{key:'outstanding_cents',label:'Outstanding',format:v=>money(v)}]}/></Panel>
    </> : null}

    {moduleId === 'FIN-04' ? <>
      <Panel title="Add bank account"><form onSubmit={(e: FormEvent<HTMLFormElement>)=>submit(e,'/finance/cashbook/accounts')}><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}><Field label="Account name" name="name"/><Field label="Bank name" name="bankName"/><Field label="Masked account number" name="maskedAccountNumber" required={false}/><SelectField label="Linked GL account" name="glAccountId" options={accounts} labelKey="name"/><Field label="Opening balance (cents)" name="openingBalanceCents" required={false}/></div><Button type="submit" disabled={busy}>Add bank account</Button></form></Panel>
      <Panel title="Bank accounts"><Table rows={primary} empty="No bank accounts configured." columns={[{key:'name',label:'Account'},{key:'bank_name',label:'Bank'},{key:'masked_account_number',label:'Account number'},{key:'opening_balance_cents',label:'Opening balance',format:v=>money(v)},{key:'active',label:'Active'}]}/></Panel>
      <Panel title="Import a statement line"><form onSubmit={(e: FormEvent<HTMLFormElement>)=>submit(e,'/finance/cashbook/import',d=>({bankAccountId:d.bankAccountId,fileName:'Manual statement entry',transactions:[{date:d.date,description:d.description,reference:d.reference,amountCents:d.amountCents,externalId:d.externalId}]}))}><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}><SelectField label="Bank account" name="bankAccountId" options={primary} labelKey="name"/><Field label="Transaction date" name="date" type="date"/><Field label="Description" name="description"/><Field label="Reference" name="reference" required={false}/><Field label="Amount in cents (+/-)" name="amountCents"/><Field label="External transaction ID" name="externalId" required={false}/></div><Button type="submit" disabled={busy}>Import statement line</Button></form></Panel>
      <Panel title="Import CSV statement"><form onSubmit={(e: FormEvent<HTMLFormElement>)=>submit(e,'/finance/cashbook/import',d=>({bankAccountId:d.bankAccountId,fileName:d.fileName,csv:d.csv}))}><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}><SelectField label="Bank account" name="bankAccountId" options={primary} labelKey="name"/><Field label="Statement file name" name="fileName"/><label style={{display:'grid',gap:5,fontSize:13}}>CSV contents<textarea name="csv" rows={6} required placeholder="date,description,reference,amount\n2026-11-01,Card purchase,12345,-120.50" style={{width:'100%',padding:10,border:'1px solid var(--ui-border, #ccc)',borderRadius:8,background:'var(--ui-panel, white)',color:'inherit'}}/></label></div><Button type="submit" disabled={busy}>Import CSV statement</Button></form></Panel>
      <Panel title="Unmatched statement lines"><Table rows={secondary} empty="No unmatched bank transactions." columns={[{key:'transaction_date',label:'Date'},{key:'description',label:'Description'},{key:'reference',label:'Reference'},{key:'amount_cents',label:'Amount',format:v=>money(v)},{key:'matched',label:'Matched'}]}/><div style={{display:'flex',flexWrap:'wrap',gap:8}}>{secondary.map(x=><Button key={str(x,'id')} variant="secondary" disabled={busy} onClick={()=>{const reconciliationId=window.prompt('Enter the open reconciliation ID for this bank transaction');const journalId=window.prompt('Enter the posted general-ledger journal ID for this bank transaction');if(journalId&&reconciliationId)void action(`/finance/cashbook/transactions/${str(x,'id')}/match`,{journalId,reconciliationId});}}>Mark matched · {str(x,'reference')||str(x,'transaction_date')}</Button>)}</div></Panel>
      <Panel title="Start reconciliation"><form onSubmit={(e: FormEvent<HTMLFormElement>)=>submit(e,'/finance/cashbook/reconciliations')}><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}><SelectField label="Bank account" name="bankAccountId" options={primary} labelKey="name"/><Field label="Statement date" name="statementDate" type="date"/><Field label="Statement closing (cents)" name="statementClosingCents"/><Field label="Book closing (cents)" name="bookClosingCents"/></div><Button type="submit" disabled={busy}>Create reconciliation</Button></form></Panel>
      <Panel title="Reconciliations"><Table rows={tertiary} empty="No reconciliations started." columns={[{key:'bank_account_name',label:'Bank account'},{key:'statement_date',label:'Statement date'},{key:'difference_cents',label:'Difference',format:v=>money(v)},{key:'status',label:'Status'}]}/><div style={{display:'flex',flexWrap:'wrap',gap:8}}>{tertiary.filter(x=>str(x,'status')==='open').map(x=><Button key={str(x,'id')} disabled={busy} onClick={()=>void action(`/finance/cashbook/reconciliations/${str(x,'id')}/complete`)}>Complete {str(x,'statement_date')}</Button>)}</div></Panel>
    </> : null}

    {moduleId === 'FIN-05' ? <>
      <Panel title="Create petty-cash fund"><form onSubmit={(e: FormEvent<HTMLFormElement>)=>submit(e,'/finance/petty-cash/funds')}><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}><Field label="Fund name" name="name"/><SelectField label="Cash-on-hand GL account" name="glAccountId" options={accounts} labelKey="name"/><Field label="Float limit (cents)" name="floatLimitCents"/><Field label="Branch ID" name="branchId" required={false}/><Field label="Custodian party ID" name="custodianPartyId" required={false}/></div><Button type="submit" disabled={busy}>Create fund</Button></form></Panel>
      <Panel title="Cash funds"><Table rows={primary} empty="No cash funds configured." columns={[{key:'name',label:'Fund'},{key:'float_limit_cents',label:'Float limit',format:v=>money(v)},{key:'movement_balance_cents',label:'Movement balance',format:v=>money(v)},{key:'active',label:'Active'}]}/></Panel>
      <Panel title="Record a cash movement"><form onSubmit={(e: FormEvent<HTMLFormElement>)=>submit(e,'/finance/petty-cash/funds/'+(new FormData(e.currentTarget).get('fundId')||'')+'/movements',d=>({date:d.date,direction:d.direction,category:d.category,description:d.description,amountCents:d.amountCents,vatCents:d.vatCents,receiptReference:d.receiptReference,offsetAccountId:d.offsetAccountId}))}><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}><SelectField label="Cash fund" name="fundId" options={primary} labelKey="name"/><Field label="Date" name="date" type="date"/><label>Direction<select name="direction" required style={{display:'block',width:'100%',minHeight:40}}><option value="out">Cash out</option><option value="in">Cash in</option></select></label><label>Category<select name="category" required style={{display:'block',width:'100%',minHeight:40}}>{['float_topup','purchase','refund','cash_return','correction'].map(x=><option key={x}>{x}</option>)}</select></label><Field label="Description" name="description"/><Field label="Amount (cents)" name="amountCents"/><Field label="VAT (cents)" name="vatCents" required={false}/><SelectField label="Offset GL account" name="offsetAccountId" options={accounts} labelKey="name"/><Field label="Receipt reference" name="receiptReference" required={false}/></div><Button type="submit" disabled={busy}>Post cash movement</Button></form></Panel>
      <Panel title="Submit expense claim"><form onSubmit={(e: FormEvent<HTMLFormElement>)=>submit(e,'/finance/petty-cash/claims',d=>({claimantPartyId:d.claimantPartyId,claimNumber:d.claimNumber,claimDate:d.claimDate,purpose:d.purpose,lines:[{accountId:d.accountId,description:d.description,netCents:d.netCents,vatCents:d.vatCents,receiptFileId:d.receiptFileId}]}))}><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}><SelectField label="Claimant" name="claimantPartyId" options={staff} labelKey="displayName"/><Field label="Claim number" name="claimNumber"/><Field label="Claim date" name="claimDate" type="date"/><Field label="Purpose" name="purpose"/><SelectField label="Expense account" name="accountId" options={accounts} labelKey="name"/><Field label="Line description" name="description"/><Field label="Net (cents)" name="netCents"/><Field label="VAT (cents)" name="vatCents" required={false}/><Field label="Receipt file ID" name="receiptFileId"/></div><Button type="submit" disabled={busy}>Submit claim</Button></form></Panel>
      <Panel title="Expense claims"><Table rows={secondary} empty="No expense claims yet." columns={[{key:'claim_number',label:'Claim'},{key:'claimant',label:'Claimant'},{key:'claim_date',label:'Date'},{key:'purpose',label:'Purpose'},{key:'total_cents',label:'Total',format:v=>money(v)},{key:'status',label:'Status'}]}/><div style={{display:'flex',flexWrap:'wrap',gap:8}}>{secondary.filter(x=>str(x,'status')==='submitted').map(x=><Button key={str(x,'id')} disabled={busy} onClick={()=>void action(`/finance/petty-cash/claims/${str(x,'id')}/decision`,{action:'approve'})}>Approve {str(x,'claim_number')}</Button>)}{secondary.filter(x=>str(x,'status')==='submitted').map(x=><Button key={`${str(x,'id')}-reject`} variant="secondary" disabled={busy} onClick={()=>void action(`/finance/petty-cash/claims/${str(x,'id')}/decision`,{action:'reject'})}>Reject {str(x,'claim_number')}</Button>)}{secondary.filter(x=>str(x,'status')==='approved').map(x=><Button key={str(x,'id')} disabled={busy} onClick={()=>{const bankAccountId=window.prompt('Enter the bank account ID used to pay this claim');const paymentDate=window.prompt('Payment date (YYYY-MM-DD)');if(bankAccountId&&paymentDate)void action(`/finance/petty-cash/claims/${str(x,'id')}/decision`,{action:'pay',bankAccountId,paymentDate});}}>Pay {str(x,'claim_number')}</Button>)}</div></Panel>
    </> : null}

    {moduleId === 'FIN-06' ? <>
      <Panel title="Create tax code"><form onSubmit={(e: FormEvent<HTMLFormElement>)=>submit(e,'/finance/tax/codes')}><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}><Field label="Code" name="code"/><Field label="Label" name="label"/><Field label="Rate (basis points)" name="rateBasisPoints"/><label>Treatment<select name="treatment" style={{display:'block',width:'100%',minHeight:40}}>{['standard','zero','exempt','out_of_scope','capital_goods'].map(x=><option key={x}>{x}</option>)}</select></label><SelectField label="Input VAT account" name="inputAccountId" options={accounts} labelKey="name"/><SelectField label="Output VAT account" name="outputAccountId" options={accounts} labelKey="name"/></div><Button type="submit" disabled={busy}>Create tax code</Button></form></Panel>
      <Panel title="Tax codes"><Table rows={primary} empty="No tax codes configured." columns={[{key:'code',label:'Code'},{key:'label',label:'Description'},{key:'rate_basis_points',label:'Rate (bps)'},{key:'treatment',label:'Treatment'},{key:'active',label:'Active'}]}/></Panel>
      <Panel title="Create VAT period"><form onSubmit={(e: FormEvent<HTMLFormElement>)=>submit(e,'/finance/tax/periods')}><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}><Field label="Period starts" name="startsOn" type="date"/><Field label="Period ends" name="endsOn" type="date"/></div><Button type="submit" disabled={busy}>Create period</Button></form></Panel>
      <Panel title="Capture VAT transaction"><form onSubmit={(e: FormEvent<HTMLFormElement>)=>submit(e,'/finance/tax/periods/'+(new FormData(e.currentTarget).get('periodId')||'')+'/transactions',d=>({sourceModule:'MANUAL',sourceId:d.sourceId,sourceLineId:d.sourceLineId,transactionDate:d.transactionDate,taxCodeId:d.taxCodeId,direction:d.direction,taxableCents:d.taxableCents,vatCents:d.vatCents}))}><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}><SelectField label="VAT period" name="periodId" options={secondary} labelKey="period_code"/><Field label="Source reference (UUID)" name="sourceId"/><Field label="Source line ID" name="sourceLineId" required={false}/><Field label="Transaction date" name="transactionDate" type="date"/><SelectField label="Tax code" name="taxCodeId" options={primary} labelKey="label"/><label>Direction<select name="direction" style={{display:'block',width:'100%',minHeight:40}}><option value="input">Input VAT</option><option value="output">Output VAT</option></select></label><Field label="Taxable amount (cents)" name="taxableCents"/><Field label="VAT amount (cents)" name="vatCents"/></div><Button type="submit" disabled={busy}>Add VAT transaction</Button></form></Panel>
      <Panel title="VAT periods"><Table rows={secondary} empty="No VAT periods configured." columns={[{key:'period_code',label:'Period'},{key:'starts_on',label:'From'},{key:'ends_on',label:'To'},{key:'output_vat_cents',label:'Output VAT',format:v=>money(v)},{key:'input_vat_cents',label:'Input VAT',format:v=>money(v)},{key:'net_vat_cents',label:'Net VAT',format:v=>money(v)},{key:'status',label:'Status'}]}/>
        <div style={{display:'flex',flexWrap:'wrap',gap:8}}>{secondary.filter(x=>str(x,'status')==='open').map(x=><Button key={str(x,'id')} disabled={busy} onClick={()=>void action(`/finance/tax/periods/${str(x,'id')}/prepare`)}>Prepare {str(x,'period_code')}</Button>)}{secondary.filter(x=>str(x,'status')==='prepared').map(x=><Button key={str(x,'id')} disabled={busy} onClick={()=>{const ref=window.prompt('Enter the SARS filing reference');if(ref)void action(`/finance/tax/periods/${str(x,'id')}/file`,{filingReference:ref});}}>File {str(x,'period_code')}</Button>)}{secondary.filter(x=>str(x,'status')==='filed').map(x=><Button key={str(x,'id')} disabled={busy} onClick={()=>void action(`/finance/tax/periods/${str(x,'id')}/lock`)}>Lock {str(x,'period_code')}</Button>)}</div>
      </Panel>
    </> : null}
  </div>;
}
