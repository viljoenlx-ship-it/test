import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { parseStatementCsv } from './domain';
import { audit, HttpError, inModule, integerBigint, isoDate, asBigint, readBody, readText, requireActor, route, one, many } from '@omnivate/finance-api';

const MODULE='FIN-04', SCOPE='fin.ledger';
export async function registerFin04(app: FastifyInstance): Promise<void> {
  app.get('/finance/cashbook/accounts', route(async (request,reply)=>{
    const actor=await requireActor(request);
    const accounts=await inModule(actor,MODULE,SCOPE,'read',tx=>many(tx,sql`SELECT id,name,bank_name,masked_account_number,currency,gl_account_id,opening_balance_cents::text,active FROM fin04_bank_accounts ORDER BY name`));
    await reply.send({accounts});
  }));
  app.post('/finance/cashbook/accounts', route(async(request,reply)=>{
    const actor=await requireActor(request), body=readBody(request);
    const name=readText(body.name).trim(), gl=readText(body.glAccountId);
    if(!name||!gl) throw new HttpError(400, 'bad_request', 'Bank account name and linked general-ledger account are required.');
    const row=await inModule(actor,MODULE,SCOPE,'operate',async tx=>{ const glAccount=await one(tx,sql`SELECT id FROM fin01_accounts WHERE id=${gl} AND active=true AND category='asset'`); if(!glAccount) throw new HttpError(400, 'bad_request', 'Choose an active general-ledger account belonging to this company.'); const created=await one(tx,sql`INSERT INTO fin04_bank_accounts (tenant_id,name,bank_name,masked_account_number,currency,gl_account_id,opening_balance_cents)
      VALUES (${tx.tenantId},${name},${readText(body.bankName)},${readText(body.maskedAccountNumber)},'ZAR',${gl},${integerBigint(body.openingBalanceCents??'0','Opening balance',true)}) RETURNING id,name`); if(created) await audit(tx,actor,'fin.bank_account.created','fin04_bank_account',String((created as any).id),{name}); return created; });
    await reply.code(201).send(row);
  }));
  app.get('/finance/cashbook/transactions', route(async(request,reply)=>{
    const actor=await requireActor(request), query=request.query as {bankAccountId?:string;unmatched?:string};
    const rows=await inModule(actor,MODULE,SCOPE,'read',tx=>many(tx,sql`SELECT id,bank_account_id,transaction_date::text,description,reference,amount_cents::text,matched,external_id FROM fin04_bank_transactions
      WHERE (${query.bankAccountId??null}::uuid IS NULL OR bank_account_id=${query.bankAccountId??null}::uuid) AND (${query.unmatched!=='true'} OR matched=false)
      ORDER BY transaction_date DESC,created_at DESC LIMIT 500`));
    await reply.send({transactions:rows});
  }));
  app.post('/finance/cashbook/import', route(async(request,reply)=>{
    const actor=await requireActor(request), body=readBody(request);
    const bankId=readText(body.bankAccountId), fileName=readText(body.fileName);
    let txns: unknown[];
    if(Array.isArray(body.transactions)) txns=body.transactions;
    else if(typeof body.csv==='string') { try { txns=parseStatementCsv(body.csv).map(line=>({date:line.date,description:line.description,reference:line.reference,amountCents:line.amountCents.toString(),externalId:line.externalId})); } catch(error) { throw new HttpError(400, 'bad_request', error instanceof Error ? error.message : 'The CSV statement could not be read.'); } }
    else txns=[];
    if(!bankId||!txns.length) throw new HttpError(400, 'bad_request', 'Choose a bank account and provide at least one statement transaction.');
    const normalized=txns.map((x:any)=>({date:isoDate(x.date,'Transaction date'),description:readText(x.description),reference:readText(x.reference),amount:integerBigint(x.amountCents,'Statement amount',true),externalId:readText(x.externalId)||null}));
    if(normalized.some(x=>x.amount===0n)) throw new HttpError(400, 'bad_request', 'Statement amounts cannot be zero.');
    const hash=createHash('sha256').update(JSON.stringify(normalized.map(x=>({...x,amount:x.amount.toString()})))).digest('hex');
    const result=await inModule(actor,MODULE,SCOPE,'operate',async tx=>{
      const account=await one(tx,sql`SELECT id FROM fin04_bank_accounts WHERE id=${bankId} AND active=true`); if(!account) throw new HttpError(400, 'bad_request', 'Active bank account not found.');
      const imp=await one<{id:string}>(tx,sql`INSERT INTO fin04_statement_imports (tenant_id,bank_account_id,file_name,file_sha256,imported_by,statement_from,statement_to)
        VALUES (${tx.tenantId},${bankId},${fileName},${hash},${actor.userId},${normalized.map(x=>x.date).sort()[0]}::date,${normalized.map(x=>x.date).sort().at(-1)}::date)
        ON CONFLICT (tenant_id,bank_account_id,file_sha256) DO NOTHING RETURNING id`);
      if(!imp) return {duplicate:true,imported:0};
      let imported=0;
      for(const x of normalized){ const inserted=await one(tx,sql`INSERT INTO fin04_bank_transactions (tenant_id,import_id,bank_account_id,transaction_date,description,reference,amount_cents,external_id)
        VALUES (${tx.tenantId},${imp.id},${bankId},${x.date}::date,${x.description},${x.reference},${x.amount},${x.externalId}) ON CONFLICT DO NOTHING RETURNING id`); if(inserted) imported++; }
      await audit(tx,actor,'fin.bank_statement.imported','fin04_statement_import',imp.id,{fileName,imported,sha256:hash});
      return {duplicate:false,imported,importId:imp.id};
    });
    await reply.code(201).send(result);
  }));
  app.post('/finance/cashbook/transactions/:id/match', route(async(request,reply)=>{
    const actor=await requireActor(request), {id}=request.params as {id:string}, body=readBody(request);
    const journalId=readText(body.journalId), reconciliationId=readText(body.reconciliationId);
    const result=await inModule(actor,MODULE,SCOPE,'operate',async tx=>{
      const txn=await one<any>(tx,sql`SELECT * FROM fin04_bank_transactions WHERE id=${id} FOR UPDATE`);
      if(!txn) throw new HttpError(404, 'not_found', 'Bank transaction not found.');
      if(txn.matched) throw new HttpError(409, 'already_matched', 'This bank transaction is already matched.');
      if(!journalId||!reconciliationId) throw new HttpError(400, 'bad_request', 'Choose both an open reconciliation and the posted ledger journal that matches this bank transaction.');
      const rec=await one<any>(tx,sql`SELECT * FROM fin04_reconciliations WHERE id=${reconciliationId} AND bank_account_id=${txn.bank_account_id} AND status='open' FOR UPDATE`);
      if(!rec||String(txn.transaction_date).slice(0,10)>String(rec.statement_date).slice(0,10)) throw new HttpError(400, 'bad_request', 'Choose an open reconciliation for this bank account and statement date.');
      const bank=await one<any>(tx,sql`SELECT gl_account_id FROM fin04_bank_accounts WHERE id=${txn.bank_account_id}`);
      const used=await one(tx,sql`SELECT 1 FROM fin04_reconciliation_matches WHERE reconciliation_id=${reconciliationId} AND journal_id=${journalId}`); if(used) throw new HttpError(409, 'already_matched', 'This journal is already matched in the selected reconciliation.');
      const journal=await one<any>(tx,sql`SELECT j.id,COALESCE(SUM(l.debit_cents-l.credit_cents) FILTER (WHERE l.account_id=${bank?.gl_account_id}),0) AS bank_effect
        FROM fin01_journals j JOIN fin01_journal_lines l ON l.journal_id=j.id WHERE j.id=${journalId} AND j.status='posted' GROUP BY j.id`);
      if(!journal||asBigint(journal.bank_effect)!==asBigint(txn.amount_cents)) throw new HttpError(400, 'bad_request', 'The selected posted journal does not match this bank account and transaction amount.');
      await tx.db.execute(sql`INSERT INTO fin04_reconciliation_matches (tenant_id,reconciliation_id,bank_transaction_id,journal_id,matched_amount_cents)
        VALUES (${tx.tenantId},${reconciliationId},${id},${journalId},${txn.amount_cents})`);
      await tx.db.execute(sql`UPDATE fin04_bank_transactions SET matched=true WHERE id=${id}`);
      await audit(tx,actor,'fin.bank_transaction.matched','fin04_bank_transaction',id,{journalId,reconciliationId});
      return {id,matched:true,journalId,reconciliationId};
    });
    await reply.send(result);
  }));
  app.get('/finance/cashbook/reconciliations', route(async(request,reply)=>{
    const actor=await requireActor(request);
    const rows=await inModule(actor,MODULE,SCOPE,'read',tx=>many(tx,sql`SELECT r.id,r.statement_date::text,r.statement_closing_cents::text,r.book_closing_cents::text,r.difference_cents::text,r.status,b.name AS bank_account_name FROM fin04_reconciliations r JOIN fin04_bank_accounts b ON b.id=r.bank_account_id ORDER BY r.statement_date DESC LIMIT 100`));
    await reply.send({reconciliations:rows});
  }));
  app.post('/finance/cashbook/reconciliations', route(async(request,reply)=>{
    const actor=await requireActor(request),body=readBody(request),bankId=readText(body.bankAccountId),date=isoDate(body.statementDate,'Statement date');
    const statement=integerBigint(body.statementClosingCents,'Statement closing balance',true),book=integerBigint(body.bookClosingCents,'Book closing balance',true);
    const result=await inModule(actor,MODULE,SCOPE,'operate',async tx=>{ const created=await one(tx,sql`INSERT INTO fin04_reconciliations (tenant_id,bank_account_id,statement_date,statement_closing_cents,book_closing_cents,difference_cents)
      VALUES (${tx.tenantId},${bankId},${date}::date,${statement},${book},${statement-book}) RETURNING id,status,difference_cents::text`); if(created) await audit(tx,actor,'fin.bank_reconciliation.created','fin04_reconciliation',String((created as any).id),{differenceCents:(statement-book).toString()}); return created; });
    await reply.code(201).send(result);
  }));
  app.post('/finance/cashbook/reconciliations/:id/complete', route(async(request,reply)=>{
    const actor=await requireActor(request),{id}=request.params as {id:string};
    const result=await inModule(actor,MODULE,SCOPE,'post',async tx=>{
      const rec=await one<any>(tx,sql`SELECT * FROM fin04_reconciliations WHERE id=${id} FOR UPDATE`); if(!rec||rec.status!=='open') throw new HttpError(400, 'bad_request', 'Only an open reconciliation can be completed.');
      const unmatched=await one<{count:string}>(tx,sql`SELECT count(*)::text AS count FROM fin04_bank_transactions WHERE bank_account_id=${rec.bank_account_id} AND transaction_date<=${rec.statement_date}::date AND matched=false`);
      if(asBigint(rec.difference_cents)!==0n) throw new HttpError(400, 'bad_request', 'The statement and book closing balances must agree before completion.');
      if(Number(unmatched?.count??0)>0) throw new HttpError(400, 'bad_request', 'Match all imported bank transactions up to the statement date first.');
      await tx.db.execute(sql`UPDATE fin04_reconciliations SET status='completed',completed_by=${actor.userId},completed_at=now() WHERE id=${id}`);
      await audit(tx,actor,'fin.bank_reconciliation.completed','fin04_reconciliation',id,{statementDate:String(rec.statement_date).slice(0,10)});
      return {id,status:'completed'};
    });
    await reply.send(result);
  }));
}
