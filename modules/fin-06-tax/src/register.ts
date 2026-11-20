import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { calculateVat, type TaxTreatment } from './domain';
import { audit, HttpError, inModule, integerBigint, isoDate, readBody, readText, requireActor, route, one, many, asBigint } from '@omnivate/finance-api';

const MODULE='FIN-06', SCOPE='fin.tax';
export async function registerFin06(app: FastifyInstance): Promise<void> {
  app.get('/finance/tax/codes',route(async(request,reply)=>{
    const actor=await requireActor(request);
    const codes=await inModule(actor,MODULE,SCOPE,'read',tx=>many(tx,sql`SELECT id,code,label,rate_basis_points,treatment,input_account_id,output_account_id,active FROM fin06_tax_codes ORDER BY code`));
    await reply.send({codes});
  }));
  app.post('/finance/tax/codes',route(async(request,reply)=>{
    const actor=await requireActor(request),body=readBody(request),rate=Number(body.rateBasisPoints),treatment=readText(body.treatment) as TaxTreatment;
    if(!readText(body.code).trim()||!readText(body.label).trim()||!Number.isInteger(rate)||rate<0||rate>10000||!['standard','zero','exempt','out_of_scope','capital_goods'].includes(treatment)) throw new HttpError(400, 'bad_request', 'Tax code details or VAT rate are invalid.');
    const row=await inModule(actor,MODULE,SCOPE,'post',async tx=>{
      if(readText(body.inputAccountId) && !await one(tx,sql`SELECT id FROM fin01_accounts WHERE id=${readText(body.inputAccountId)} AND active=true AND category='asset'`)) throw new HttpError(400, 'bad_request', 'The input VAT control account must be an active asset account in this company.');
      if(readText(body.outputAccountId) && !await one(tx,sql`SELECT id FROM fin01_accounts WHERE id=${readText(body.outputAccountId)} AND active=true AND category='liability'`)) throw new HttpError(400, 'bad_request', 'The output VAT control account must be an active liability account in this company.');
      const created=await one(tx,sql`INSERT INTO fin06_tax_codes (tenant_id,code,label,rate_basis_points,treatment,input_account_id,output_account_id)
      VALUES (${tx.tenantId},${readText(body.code).trim()},${readText(body.label).trim()},${rate},${treatment},${readText(body.inputAccountId)||null},${readText(body.outputAccountId)||null}) RETURNING id,code`); if(created) await audit(tx,actor,'fin.tax_code.created','fin06_tax_code',String((created as any).id),{code:readText(body.code),rateBasisPoints:rate,treatment}); return created; });
    await reply.code(201).send(row);
  }));
  app.get('/finance/tax/periods',route(async(request,reply)=>{
    const actor=await requireActor(request);
    const periods=await inModule(actor,MODULE,SCOPE,'read',tx=>many(tx,sql`SELECT id,period_code,starts_on::text,ends_on::text,status,filing_reference,output_vat_cents::text,input_vat_cents::text,net_vat_cents::text FROM fin06_vat_periods ORDER BY starts_on DESC`));
    await reply.send({periods});
  }));
  app.post('/finance/tax/periods',route(async(request,reply)=>{
    const actor=await requireActor(request),body=readBody(request),start=isoDate(body.startsOn,'Period start'),end=isoDate(body.endsOn,'Period end');
    if(end<start) throw new HttpError(400, 'bad_request', 'VAT period end cannot be before its start.');
    const code=`${start.replaceAll('-','')}_${end.replaceAll('-','')}`;
    const row=await inModule(actor,MODULE,SCOPE,'post',async tx=>{ const created=await one(tx,sql`INSERT INTO fin06_vat_periods (tenant_id,period_code,starts_on,ends_on)
      VALUES (${tx.tenantId},${code},${start}::date,${end}::date) RETURNING id,period_code,status`); if(created) await audit(tx,actor,'fin.vat_period.created','fin06_vat_period',String((created as any).id),{periodCode:code}); return created; });
    await reply.code(201).send(row);
  }));
  app.post('/finance/tax/periods/:id/transactions',route(async(request,reply)=>{
    const actor=await requireActor(request),{id}=request.params as {id:string},body=readBody(request),taxable=integerBigint(body.taxableCents,'Taxable amount'),vat=integerBigint(body.vatCents,'VAT amount');
    const date=isoDate(body.transactionDate,'Transaction date'),direction=readText(body.direction),source=readText(body.sourceModule);
    if(taxable<0n||vat<0n||!['input','output'].includes(direction)||!['FIN-02','FIN-03','FIN-05','MANUAL'].includes(source)) throw new HttpError(400, 'bad_request', 'VAT transaction details are invalid.');
    const row=await inModule(actor,MODULE,SCOPE,'post',async tx=>{
      const period=await one<any>(tx,sql`SELECT * FROM fin06_vat_periods WHERE id=${id} FOR UPDATE`); if(!period||period.status!=='open') throw new HttpError(400, 'bad_request', 'VAT transactions can only be added to an open period.');
      if(date< String(period.starts_on).slice(0,10)||date>String(period.ends_on).slice(0,10)) throw new HttpError(400, 'bad_request', 'Transaction date falls outside this VAT period.');
      const code=await one<any>(tx,sql`SELECT * FROM fin06_tax_codes WHERE id=${readText(body.taxCodeId)} AND active=true`); if(!code) throw new HttpError(400, 'bad_request', 'Active tax code not found.');
      const expected=calculateVat(taxable,{code:code.code,rateBasisPoints:Number(code.rate_basis_points),treatment:code.treatment});
      if(expected!==vat) throw new HttpError(400, 'bad_request', 'VAT amount does not agree with the selected tax code.');
      const created=await one(tx,sql`INSERT INTO fin06_vat_transactions (tenant_id,period_id,source_module,source_id,source_line_id,transaction_date,tax_code_id,direction,taxable_cents,vat_cents)
        VALUES (${tx.tenantId},${id},${source},${readText(body.sourceId)},${readText(body.sourceLineId)||null},${date}::date,${code.id},${direction},${taxable},${vat}) RETURNING id`);
      if(created) await audit(tx,actor,'fin.vat_transaction.created','fin06_vat_transaction',String((created as any).id),{periodId:id,direction,taxableCents:taxable.toString(),vatCents:vat.toString()});
      return created;
    });
    await reply.code(201).send(row);
  }));
  app.post('/finance/tax/periods/:id/prepare',route(async(request,reply)=>{
    const actor=await requireActor(request),{id}=request.params as {id:string};
    const result=await inModule(actor,MODULE,SCOPE,'post',async tx=>{
      const period=await one<any>(tx,sql`SELECT * FROM fin06_vat_periods WHERE id=${id} FOR UPDATE`); if(!period||period.status!=='open') throw new HttpError(400, 'bad_request', 'Only an open VAT period can be prepared.');
      const totals=await one<any>(tx,sql`SELECT COALESCE(SUM(vat_cents) FILTER (WHERE direction='output'),0) AS output,
        COALESCE(SUM(vat_cents) FILTER (WHERE direction='input'),0) AS input FROM fin06_vat_transactions WHERE period_id=${id}`);
      const output=asBigint(totals?.output),input=asBigint(totals?.input),net=output-input;
      await tx.db.execute(sql`UPDATE fin06_vat_periods SET status='prepared',prepared_by=${actor.userId},prepared_at=now(),output_vat_cents=${output},input_vat_cents=${input},net_vat_cents=${net} WHERE id=${id}`);
      await audit(tx,actor,'fin.vat_period.prepared','fin06_vat_period',id,{outputVatCents:output.toString(),inputVatCents:input.toString(),netVatCents:net.toString()});
      return {id,status:'prepared',outputVatCents:output.toString(),inputVatCents:input.toString(),netVatCents:net.toString()};
    });
    await reply.send(result);
  }));
  app.post('/finance/tax/periods/:id/file',route(async(request,reply)=>{
    const actor=await requireActor(request),{id}=request.params as {id:string},body=readBody(request),reference=readText(body.filingReference).trim();
    if(!reference) throw new HttpError(400, 'bad_request', 'Enter the SARS filing reference before filing this period.');
    const result=await inModule(actor,MODULE,SCOPE,'post',async tx=>{
      const period=await one<any>(tx,sql`SELECT status FROM fin06_vat_periods WHERE id=${id} FOR UPDATE`); if(!period||period.status!=='prepared') throw new HttpError(400, 'bad_request', 'Only a prepared VAT period can be filed.');
      await tx.db.execute(sql`UPDATE fin06_vat_periods SET status='filed',filed_by=${actor.userId},filed_at=now(),filing_reference=${reference} WHERE id=${id}`);
      await audit(tx,actor,'fin.vat_period.filed','fin06_vat_period',id,{filingReference:reference});
      return {id,status:'filed',filingReference:reference};
    });
    await reply.send(result);
  }));
  app.post('/finance/tax/periods/:id/lock',route(async(request,reply)=>{
    const actor=await requireActor(request),{id}=request.params as {id:string};
    const result=await inModule(actor,MODULE,SCOPE,'post',async tx=>{
      const period=await one<any>(tx,sql`SELECT status FROM fin06_vat_periods WHERE id=${id} FOR UPDATE`);
      if(!period||period.status!=='filed') throw new HttpError(400, 'bad_request', 'Only a filed VAT period can be locked.');
      await tx.db.execute(sql`UPDATE fin06_vat_periods SET status='locked' WHERE id=${id}`);
      await audit(tx,actor,'fin.vat_period.locked','fin06_vat_period',id,{});
      return {id,status:'locked'};
    });
    await reply.send(result);
  }));
}
