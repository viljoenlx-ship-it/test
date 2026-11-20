import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { accountByKey, audit, postJournal } from '@omnivate/module-fin-01';
import { HttpError, inModule, integerBigint, isoDate, readBody, readText, requireActor, route, one, many, asBigint } from '@omnivate/finance-api';

const MODULE='FIN-05', SCOPE='fin.petty';
export async function registerFin05(app: FastifyInstance): Promise<void> {
  app.get('/finance/petty-cash/funds',route(async(request,reply)=>{
    const actor=await requireActor(request);
    const funds=await inModule(actor,MODULE,SCOPE,'read',tx=>many(tx,sql`SELECT f.id,f.name,f.branch_id,f.custodian_party_id,f.gl_account_id,f.float_limit_cents::text,f.active,
      COALESCE(SUM(CASE WHEN t.direction='in' THEN t.amount_cents ELSE -t.amount_cents END),0)::text AS movement_balance_cents
      FROM fin05_cash_funds f LEFT JOIN fin05_cash_transactions t ON t.fund_id=f.id GROUP BY f.id ORDER BY f.name`));
    await reply.send({funds});
  }));
  app.post('/finance/petty-cash/funds',route(async(request,reply)=>{
    const actor=await requireActor(request),body=readBody(request);
    const name=readText(body.name).trim(),gl=readText(body.glAccountId),limit=integerBigint(body.floatLimitCents??'0','Float limit');
    if(!name||!gl||limit<0n) throw new HttpError(400, 'bad_request', 'Fund name, general-ledger account and a non-negative float limit are required.');
    const fund=await inModule(actor,MODULE,SCOPE,'operate',async tx=>{ const account=await one(tx,sql`SELECT id FROM fin01_accounts WHERE id=${gl} AND active=true AND category='asset'`); if(!account) throw new HttpError(400, 'bad_request', 'Choose an active cash-on-hand account belonging to this company.'); if(body.branchId && !await one(tx,sql`SELECT id FROM branches WHERE id=${readText(body.branchId)}`)) throw new HttpError(400, 'bad_request', 'Choose a branch belonging to this company.'); if(body.custodianPartyId && !await one(tx,sql`SELECT id FROM parties WHERE id=${readText(body.custodianPartyId)}`)) throw new HttpError(400, 'bad_request', 'Choose a custodian belonging to this company.'); const created=await one(tx,sql`INSERT INTO fin05_cash_funds (tenant_id,name,branch_id,custodian_party_id,gl_account_id,float_limit_cents)
      VALUES (${tx.tenantId},${name},${readText(body.branchId)||null},${readText(body.custodianPartyId)||null},${gl},${limit}) RETURNING id,name`); if(created) await audit(tx,actor,'fin.cash_fund.created','fin05_cash_fund',String((created as any).id),{name,floatLimitCents:limit.toString()}); return created; });
    await reply.code(201).send(fund);
  }));
  app.post('/finance/petty-cash/funds/:id/movements',route(async(request,reply)=>{
    const actor=await requireActor(request),{id}=request.params as {id:string},body=readBody(request);
    const date=isoDate(body.date,'Movement date'),direction=readText(body.direction),category=readText(body.category),amount=integerBigint(body.amountCents,'Movement amount'),vat=integerBigint(body.vatCents??'0','Movement VAT');
    if(!['in','out'].includes(direction)||!['float_topup','purchase','refund','cash_return','correction'].includes(category)||amount<=0n||vat<0n||vat>amount||(direction==='in'&&vat>0n)||(category==='float_topup'&&direction!=='in')||(category==='purchase'&&direction!=='out')) throw new HttpError(400, 'bad_request', 'Movement direction, category, amount or VAT is invalid.');
    const offset=readText(body.offsetAccountId);
    const result=await inModule(actor,MODULE,SCOPE,'post',async tx=>{
      const fund=await one<any>(tx,sql`SELECT * FROM fin05_cash_funds WHERE id=${id} AND active=true FOR UPDATE`); if(!fund) throw new HttpError(400, 'bad_request', 'Active petty-cash fund not found.');
      const current=await one<{balance:unknown}>(tx,sql`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount_cents ELSE -amount_cents END),0) AS balance FROM fin05_cash_transactions WHERE fund_id=${id}`);
      const balance=asBigint(current?.balance)+(direction==='in'?amount:-amount), limit=asBigint(fund.float_limit_cents);
      if(balance<0n||(limit>0n&&balance>limit)) throw new HttpError(400, 'bad_request', 'This movement would put the fund outside its authorised float balance.');
      if(!offset || offset===fund.gl_account_id) throw new HttpError(400, 'bad_request', 'Select a different offset account for this movement.');
      const journalId=await postJournal(tx,actor,{date,memo:`Petty cash ${category}: ${readText(body.description)}`,source:'manual',sourceKey:`fin05-cash:${randomUUID()}`,lines:direction==='out'?[{accountId:offset,debitCents:amount-vat,creditCents:0n},{accountId:await accountByKey(tx,'vat_input'),debitCents:vat,creditCents:0n},{accountId:fund.gl_account_id,debitCents:0n,creditCents:amount}].filter(x=>x.debitCents>0n||x.creditCents>0n):[{accountId:fund.gl_account_id,debitCents:amount,creditCents:0n},{accountId:offset,debitCents:0n,creditCents:amount}]});
      const row=await one(tx,sql`INSERT INTO fin05_cash_transactions (tenant_id,fund_id,transaction_date,direction,category,description,amount_cents,vat_cents,receipt_reference,journal_id,created_by)
        VALUES (${tx.tenantId},${id},${date}::date,${direction},${category},${readText(body.description)},${amount},${vat},${readText(body.receiptReference)},${journalId},${actor.userId}) RETURNING id`);
      await audit(tx,actor,'fin.cash_movement.posted','fin05_cash_transaction',String((row as any)?.id),{journalId,amountCents:amount.toString(),direction,category});
      return {row,balanceCents:balance.toString(),journalId};
    });
    await reply.code(201).send(result);
  }));
  app.get('/finance/petty-cash/claims',route(async(request,reply)=>{
    const actor=await requireActor(request);
    const claims=await inModule(actor,MODULE,SCOPE,'read',tx=>many(tx,sql`SELECT c.id,c.claim_number,c.claim_date::text,c.purpose,c.net_cents::text,c.vat_cents::text,c.total_cents::text,c.status,p.display_name AS claimant
      FROM fin05_expense_claims c JOIN parties p ON p.id=c.claimant_party_id ORDER BY c.claim_date DESC LIMIT 250`));
    await reply.send({claims});
  }));
  app.post('/finance/petty-cash/claims',route(async(request,reply)=>{
    const actor=await requireActor(request),body=readBody(request),lines=body.lines;
    if(!Array.isArray(lines)||!lines.length) throw new HttpError(400, 'bad_request', 'An expense claim needs at least one line.');
    const parsed=lines.map((x:any)=>({accountId:readText(x.accountId),description:readText(x.description).trim(),net:integerBigint(x.netCents,'Claim line net'),vat:integerBigint(x.vatCents??'0','Claim line VAT'),receipt:readText(x.receiptFileId)||null}));
    if(parsed.some(x=>!x.accountId||!x.description||x.net<0n||x.vat<0n)) throw new HttpError(400, 'bad_request', 'Claim lines contain invalid descriptions or amounts.');
    const net=parsed.reduce((n,x)=>n+x.net,0n),vat=parsed.reduce((n,x)=>n+x.vat,0n),total=net+vat;
    if(total<=0n) throw new HttpError(400, 'bad_request', 'Claim total must be greater than zero.');
    const claim=await inModule(actor,MODULE,SCOPE,'submit',async tx=>{
      const claimant=await one(tx,sql`SELECT id FROM parties WHERE id=${readText(body.claimantPartyId)}`);
      if(!claimant) throw new HttpError(400, 'bad_request', 'Choose a claimant belonging to this company.');
      const row=await one<{id:string}>(tx,sql`INSERT INTO fin05_expense_claims (tenant_id,claimant_party_id,claim_number,claim_date,purpose,net_cents,vat_cents,total_cents)
        VALUES (${tx.tenantId},${readText(body.claimantPartyId)},${readText(body.claimNumber)},${isoDate(body.claimDate,'Claim date')}::date,${readText(body.purpose)},${net},${vat},${total}) RETURNING id`);
      if(!row) throw new HttpError(400, 'bad_request', 'Could not create claim.');
      const accountIds=[...new Set(parsed.map(line=>line.accountId))]; const validAccounts=await many(tx,sql`SELECT id FROM fin01_accounts WHERE id IN (${sql.join(accountIds.map(accountId=>sql`${accountId}`),sql`, `)}) AND active=true AND category IN ('expense','cost_of_sales')`); if(validAccounts.length!==accountIds.length) throw new HttpError(400, 'bad_request', 'Choose active expense accounts belonging to this company.');
      for(const line of parsed) await tx.db.execute(sql`INSERT INTO fin05_expense_claim_lines (tenant_id,claim_id,expense_account_id,description,net_cents,vat_cents,receipt_file_id)
        VALUES (${tx.tenantId},${row.id},${line.accountId},${line.description},${line.net},${line.vat},${line.receipt})`);
      await audit(tx,actor,'fin.expense_claim.submitted','fin05_expense_claim',row.id,{claimNumber:readText(body.claimNumber),totalCents:total.toString()});
      return row;
    });
    await reply.code(201).send(claim);
  }));
  app.post('/finance/petty-cash/claims/:id/decision',route(async(request,reply)=>{
    const actor=await requireActor(request),{id}=request.params as {id:string},body=readBody(request),action=readText(body.action);
    if(!['approve','reject','pay'].includes(action)) throw new HttpError(400, 'bad_request', 'Choose approve, reject or pay.');
    const result=await inModule(actor,MODULE,SCOPE,action==='pay'?'post':'approve',async tx=>{
      const claim=await one<any>(tx,sql`SELECT * FROM fin05_expense_claims WHERE id=${id} FOR UPDATE`); if(!claim) throw new HttpError(400, 'bad_request', 'Expense claim not found.');
      if(action==='reject'){
        if(claim.status!=='submitted') throw new HttpError(400, 'bad_request', 'Only submitted claims can be rejected.');
        await tx.db.execute(sql`UPDATE fin05_expense_claims SET status='rejected',approved_by=${actor.userId},approved_at=now() WHERE id=${id}`); await audit(tx,actor,'fin.expense_claim.rejected','fin05_expense_claim',id,{}); return {id,status:'rejected'};
      }
      if(action==='approve'){
        if(claim.status!=='submitted') throw new HttpError(400, 'bad_request', 'Only submitted claims can be approved.');
        const lines=await many<any>(tx,sql`SELECT * FROM fin05_expense_claim_lines WHERE claim_id=${id}`);
        if(!lines.length||lines.some(x=>!x.receipt_file_id)) throw new HttpError(400, 'bad_request', 'Every expense claim line must have a receipt before approval.');
        const vat=lines.reduce((n,x)=>n+asBigint(x.vat_cents),0n),vatAccount=await accountByKey(tx,'vat_input'),creditors=await accountByKey(tx,'creditors');
        const journalLines=lines.filter(x=>asBigint(x.net_cents)>0n).map(x=>({accountId:x.expense_account_id,debitCents:asBigint(x.net_cents),creditCents:0n}));
        if(vat>0n) journalLines.push({accountId:vatAccount,debitCents:vat,creditCents:0n});
        journalLines.push({accountId:creditors,debitCents:0n,creditCents:asBigint(claim.total_cents)});
        const journalId=await postJournal(tx,actor,{date:String(claim.claim_date).slice(0,10),memo:`Expense claim ${claim.claim_number}`,source:'manual',sourceKey:`fin05-claim-approve:${id}`,lines:journalLines});
        await tx.db.execute(sql`UPDATE fin05_expense_claims SET status='approved',approved_by=${actor.userId},approved_at=now(),journal_id=${journalId} WHERE id=${id}`); await audit(tx,actor,'fin.expense_claim.approved','fin05_expense_claim',id,{journalId}); return {id,status:'approved',journalId};
      }
      if(claim.status!=='approved') throw new HttpError(400, 'bad_request', 'Only approved claims can be paid.');
      const bank=await one<any>(tx,sql`SELECT b.gl_account_id FROM fin04_bank_accounts b JOIN fin01_accounts a ON a.id=b.gl_account_id WHERE b.id=${readText(body.bankAccountId)} AND b.active=true AND a.active=true AND a.category='asset'`); if(!bank) throw new HttpError(400, 'bad_request', 'Choose an active bank account.');
      const journalId=await postJournal(tx,actor,{date:isoDate(body.paymentDate,'Payment date'),memo:`Payment of expense claim ${claim.claim_number}`,source:'payment',sourceKey:`fin05-claim-pay:${id}`,lines:[{accountId:await accountByKey(tx,'creditors'),debitCents:asBigint(claim.total_cents),creditCents:0n},{accountId:bank.gl_account_id,debitCents:0n,creditCents:asBigint(claim.total_cents)}]});
      await tx.db.execute(sql`UPDATE fin05_expense_claims SET status='paid',paid_at=now(),payment_journal_id=${journalId} WHERE id=${id}`); await audit(tx,actor,'fin.expense_claim.paid','fin05_expense_claim',id,{journalId}); return {id,status:'paid',journalId};
    });
    await reply.send(result);
  }));
}
