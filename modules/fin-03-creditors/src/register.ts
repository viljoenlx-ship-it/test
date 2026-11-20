import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { accountByKey, audit, postJournal } from '@omnivate/module-fin-01';
import { HttpError, inModule, integerBigint, isoDate, positiveCents, readBody, readText, requireActor, route, one, many, asBigint } from '@omnivate/finance-api';

const MODULE = 'FIN-03';
const SCOPE = 'fin.ledger';

export async function registerFin03(app: FastifyInstance): Promise<void> {
  app.get('/finance/creditors/bills', route(async (request, reply) => {
    const actor = await requireActor(request);
    const bills = await inModule(actor, MODULE, SCOPE, 'read', tx => many(tx, sql`
      SELECT b.id, b.supplier_id, p.display_name AS supplier_name, b.supplier_reference,
        b.document_number, b.bill_date::text, b.due_date::text, b.subtotal_cents::text,
        b.vat_cents::text, b.total_cents::text, b.status,
        COALESCE((SELECT SUM(a.amount_cents) FROM fin03_payment_allocations a WHERE a.bill_id=b.id),0)::text AS paid_cents
      FROM fin03_supplier_bills b JOIN parties p ON p.id=b.supplier_id
      ORDER BY b.bill_date DESC, b.created_at DESC LIMIT 250
    `));
    await reply.send({ bills });
  }));

  app.post('/finance/creditors/bills', route(async (request, reply) => {
    const actor = await requireActor(request); const body = readBody(request);
    const supplierId = readText(body.supplierId), documentNumber = readText(body.documentNumber).trim();
    const billDate = isoDate(body.billDate, 'Bill date'), dueDate = isoDate(body.dueDate, 'Due date');
    if (dueDate < billDate) throw new HttpError(400, 'bad_request', 'Due date cannot be before bill date.');
    if (!supplierId || !documentNumber || !Array.isArray(body.lines) || !body.lines.length) throw new HttpError(400, 'bad_request', 'Supplier, document number and at least one bill line are required.');
    const lines: { description: string; accountId: string; quantityMilli: bigint; unitCostCents: bigint; netCents: bigint; vatCents: bigint }[] = body.lines.map((entry: any) => ({ description: readText(entry?.description).trim(), accountId: readText(entry?.accountId), quantityMilli: integerBigint(entry?.quantityMilli, 'Quantity in thousandths'), unitCostCents: integerBigint(entry?.unitCostCents ?? 0, 'Unit cost'), netCents: positiveCents(entry?.netCents, 'Line net'), vatCents: integerBigint(entry?.vatCents ?? 0, 'Line VAT') }));
    if (lines.some(x => !x.description || !x.accountId || x.quantityMilli <= 0n || x.unitCostCents < 0n || x.vatCents < 0n)) throw new HttpError(400, 'bad_request', 'Each line needs a description, active account and valid amounts.');
    const subtotal = lines.reduce((n,x)=>n+x.netCents,0n), vat = lines.reduce((n,x)=>n+x.vatCents,0n), total = subtotal + vat;
    const bill = await inModule(actor, MODULE, SCOPE, 'operate', async tx => {
      const supplier = await one(tx, sql`SELECT id FROM parties WHERE id=${supplierId}`);
      if (!supplier) throw new HttpError(400, 'bad_request', 'Choose a supplier belonging to this company.');
      const accountIds = [...new Set(lines.map(line => line.accountId))];
      const validAccounts = await many(tx, sql`SELECT id FROM fin01_accounts WHERE id IN (${sql.join(accountIds.map(id => sql`${id}`), sql`, `)}) AND active=true`);
      if (validAccounts.length !== accountIds.length) throw new HttpError(400, 'bad_request', 'Choose active general-ledger accounts belonging to this company.');
      for (const line of lines) if ((line.quantityMilli * line.unitCostCents + 500n) / 1000n !== line.netCents) throw new HttpError(400, 'bad_request', 'A bill line net amount must equal quantity multiplied by unit cost.');
      const result = await one<{id:string}>(tx, sql`INSERT INTO fin03_supplier_bills (tenant_id,supplier_id,supplier_reference,document_number,bill_date,due_date,subtotal_cents,vat_cents,total_cents,created_by)
        VALUES (${tx.tenantId},${supplierId},${readText(body.supplierReference)},${documentNumber},${billDate}::date,${dueDate}::date,${subtotal},${vat},${total},${actor.userId}) RETURNING id`);
      if (!result) throw new HttpError(400, 'bad_request', 'Could not create supplier bill.');
      for (const line of lines) await tx.db.execute(sql`INSERT INTO fin03_supplier_bill_lines (tenant_id,bill_id,description,account_id,quantity_milli,unit_cost_cents,net_cents,vat_cents)
        VALUES (${tx.tenantId},${result.id},${line.description},${line.accountId},${line.quantityMilli},${line.unitCostCents},${line.netCents},${line.vatCents})`);
      await audit(tx, actor, 'fin.supplier_bill.created', 'fin03_supplier_bill', result.id, { documentNumber, totalCents: total.toString() });
      return result;
    });
    await reply.code(201).send(bill);
  }));

  app.post('/finance/creditors/bills/:id/post', route(async (request, reply) => {
    const actor = await requireActor(request); const { id } = request.params as {id:string};
    const result = await inModule(actor, MODULE, SCOPE, 'post', async tx => {
      const bill = await one<any>(tx, sql`SELECT * FROM fin03_supplier_bills WHERE id=${id} FOR UPDATE`);
      if (!bill || bill.status !== 'draft') throw new HttpError(400, 'bad_request', 'Only a draft supplier bill can be posted.');
      const lines = await many<any>(tx, sql`SELECT account_id,net_cents,vat_cents FROM fin03_supplier_bill_lines WHERE bill_id=${id}`);
      const inputVat = await accountByKey(tx, 'vat_input'), creditors = await accountByKey(tx, 'creditors');
      const journalLines = lines.filter(x=>asBigint(x.net_cents)>0n).map(x=>({accountId:x.account_id,debitCents:asBigint(x.net_cents),creditCents:0n}));
      const vatTotal = lines.reduce((n,x)=>n+asBigint(x.vat_cents),0n);
      if (vatTotal>0n) journalLines.push({accountId:inputVat,debitCents:vatTotal,creditCents:0n});
      journalLines.push({accountId:creditors,debitCents:0n,creditCents:asBigint(bill.total_cents)});
      const journalId = await postJournal(tx, actor, {date:String(bill.bill_date).slice(0,10),memo:`Supplier bill ${bill.document_number}`,source:'manual',sourceKey:`fin03-bill:${id}`,lines:journalLines});
      await tx.db.execute(sql`UPDATE fin03_supplier_bills SET status='posted',ledger_journal_id=${journalId},posted_by=${actor.userId},posted_at=now(),updated_at=now() WHERE id=${id}`);
      await audit(tx, actor, 'fin.supplier_bill.posted', 'fin03_supplier_bill', id, { journalId });
      return {id,journalId};
    });
    await reply.send(result);
  }));


  app.post('/finance/creditors/payments', route(async (request, reply) => {
    const actor = await requireActor(request); const body = readBody(request);
    const supplierId = readText(body.supplierId), bankId = readText(body.bankAccountId), bankGlAccountId = readText(body.bankGlAccountId);
    const paymentDate = isoDate(body.paymentDate, 'Payment date');
    const amount = positiveCents(body.amountCents, 'Payment amount');
    if (!supplierId || (!bankId && !bankGlAccountId) || !Array.isArray(body.allocations)) throw new HttpError(400, 'bad_request', 'Supplier, bank account and payment allocations are required.');
    const allocations = body.allocations.map((x: any) => ({ billId: readText(x.billId), amount: positiveCents(x.amountCents, 'Allocation amount') }));
    if (new Set(allocations.map(x => x.billId)).size !== allocations.length) throw new HttpError(400, 'bad_request', 'A bill can only be allocated once in one payment.');
    const result = await inModule(actor, MODULE, SCOPE, 'post', async tx => {
      const supplier = await one(tx, sql`SELECT id FROM parties WHERE id=${supplierId}`);
      if (!supplier) throw new HttpError(400, 'bad_request', 'Choose a supplier belonging to this company.');
      const bank = bankId ? await one<any>(tx, sql`SELECT b.gl_account_id FROM fin04_bank_accounts b JOIN fin01_accounts a ON a.id=b.gl_account_id WHERE b.id=${bankId} AND b.active=true AND a.active=true AND a.category='asset'`) : await one<any>(tx, sql`SELECT id AS gl_account_id FROM fin01_accounts WHERE id=${bankGlAccountId} AND active=true AND category='asset'`);
      if (!bank) throw new HttpError(400, 'bad_request', 'Choose an active bank or cash ledger account.');
      let allocated = 0n;
      for (const allocation of allocations) {
        const bill = await one<any>(tx, sql`SELECT b.id,b.supplier_id,b.total_cents,b.status,
          COALESCE((SELECT SUM(a.amount_cents) FROM fin03_payment_allocations a WHERE a.bill_id=b.id),0) AS paid
          FROM fin03_supplier_bills b WHERE b.id=${allocation.billId} FOR UPDATE`);
        if (!bill || bill.status !== 'posted' || bill.supplier_id !== supplierId) throw new HttpError(400, 'bad_request', 'Each allocation must reference a posted bill for the selected supplier.');
        if (allocation.amount > asBigint(bill.total_cents) - asBigint(bill.paid)) throw new HttpError(400, 'bad_request', 'An allocation exceeds the bill outstanding balance.');
        allocated += allocation.amount;
      }
      if (allocated > amount) throw new HttpError(400, 'bad_request', 'Allocations cannot exceed the payment amount.');
      const payment = await one<{id:string}>(tx, sql`INSERT INTO fin03_supplier_payments (tenant_id,supplier_id,payment_date,reference,amount_cents,bank_account_id,created_by)
        VALUES (${tx.tenantId},${supplierId},${paymentDate}::date,${readText(body.reference)},${amount},${bankId||null},${actor.userId}) RETURNING id`);
      if (!payment) throw new HttpError(400, 'bad_request', 'Could not create supplier payment.');
      const journalId = await postJournal(tx, actor, { date: paymentDate, memo: `Supplier payment ${readText(body.reference) || payment.id}`, source: 'payment', sourceKey: `fin03-payment:${payment.id}`, lines: [
        { accountId: await accountByKey(tx, 'creditors'), debitCents: amount, creditCents: 0n },
        { accountId: bank.gl_account_id, debitCents: 0n, creditCents: amount },
      ] });
      await tx.db.execute(sql`UPDATE fin03_supplier_payments SET journal_id=${journalId} WHERE id=${payment.id}`);
      for (const allocation of allocations) await tx.db.execute(sql`INSERT INTO fin03_payment_allocations (tenant_id,payment_id,bill_id,amount_cents)
        VALUES (${tx.tenantId},${payment.id},${allocation.billId},${allocation.amount})`);
      await audit(tx, actor, 'fin.supplier_payment.posted', 'fin03_supplier_payment', payment.id, { journalId, amountCents: amount.toString(), allocatedCents: allocated.toString() });
      return { paymentId: payment.id, journalId, allocatedCents: allocated.toString(), unallocatedCents: (amount-allocated).toString() };
    });
    await reply.code(201).send(result);
  }));

  app.get('/finance/creditors/ageing', route(async (request, reply) => {
    const actor = await requireActor(request);
    const rows = await inModule(actor, MODULE, SCOPE, 'read', tx => many(tx, sql`
      SELECT b.supplier_id,p.display_name AS supplier_name,b.id AS bill_id,b.document_number,b.due_date::text,
        (b.total_cents-COALESCE(SUM(a.amount_cents),0))::text AS outstanding_cents,
        GREATEST(0,CURRENT_DATE-b.due_date)::int AS days_overdue
      FROM fin03_supplier_bills b JOIN parties p ON p.id=b.supplier_id
      LEFT JOIN fin03_payment_allocations a ON a.bill_id=b.id
      WHERE b.status='posted' GROUP BY b.id,p.display_name HAVING b.total_cents-COALESCE(SUM(a.amount_cents),0)>0
      ORDER BY b.due_date ASC LIMIT 500
    `));
    await reply.send({ rows });
  }));
}
