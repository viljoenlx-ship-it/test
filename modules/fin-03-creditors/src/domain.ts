/** FIN-03 supplier ledger rules. All monetary values are integer cents. */
export type BillStatus = 'draft' | 'posted' | 'void';
export type BillLine = { description: string; quantityMilli: bigint; unitCostCents: bigint; netCents: bigint; vatCents: bigint; purchaseOrderLineId?: string | null; goodsReceiptLineId?: string | null };
export type MatchResult = { matched: boolean; orderedMilli: bigint; receivedMilli: bigint; billedMilli: bigint; varianceMilli: bigint; reason?: string };
export function validateBillTotals(lines: readonly BillLine[], subtotalCents: bigint, vatCents: bigint, totalCents: bigint): void {
  if (!lines.length) throw new Error('A supplier bill needs at least one line.');
  if (lines.some(x => !x.description.trim() || x.quantityMilli <= 0n || x.unitCostCents < 0n || x.netCents < 0n || x.vatCents < 0n)) throw new Error('Supplier bill lines contain invalid quantities or amounts.');
  const net = lines.reduce((n,x)=>n+x.netCents,0n), vat = lines.reduce((n,x)=>n+x.vatCents,0n);
  if (net !== subtotalCents || vat !== vatCents || subtotalCents + vatCents !== totalCents || totalCents <= 0n) throw new Error('Supplier bill totals do not agree with its lines.');
}
export function threeWayMatch(orderedMilli: bigint, receivedMilli: bigint, billedMilli: bigint): MatchResult {
  if ([orderedMilli,receivedMilli,billedMilli].some(x=>x<0n)) throw new Error('Three-way match quantities cannot be negative.');
  const varianceMilli = billedMilli - receivedMilli;
  const matched = billedMilli <= receivedMilli && receivedMilli <= orderedMilli;
  return { matched, orderedMilli, receivedMilli, billedMilli, varianceMilli, ...(matched?{}:{reason: billedMilli>receivedMilli?'Billed quantity exceeds goods received.':receivedMilli>orderedMilli?'Goods received exceed the purchase order.':'Quantities do not reconcile.'}) };
}
export function allocatePayment(paymentCents: bigint, outstandingByBill: readonly { billId: string; outstandingCents: bigint }[], requested: readonly { billId: string; amountCents: bigint }[]) {
  if(paymentCents<=0n) throw new Error('Payment must be greater than zero.');
  const seen=new Set<string>(); let allocated=0n;
  const balances=new Map<string,bigint>();
  for (const bill of outstandingByBill) {
    if (!bill.billId.trim() || bill.outstandingCents < 0n || balances.has(bill.billId)) throw new Error('Supplier bill balances must have unique IDs and non-negative amounts.');
    balances.set(bill.billId, bill.outstandingCents);
  }
  for(const a of requested){ if(seen.has(a.billId)) throw new Error('A bill can only be allocated once per payment.'); seen.add(a.billId); if(a.amountCents<=0n || a.amountCents>(balances.get(a.billId)??-1n)) throw new Error('Allocation exceeds the bill outstanding balance.'); allocated+=a.amountCents; }
  if(allocated>paymentCents) throw new Error('Allocations exceed the payment amount.');
  return { allocatedCents: allocated, unallocatedCents: paymentCents-allocated };
}
export function billAgeing(dueDate: string, asAt: string) {
  const due=Date.parse(dueDate+'T00:00:00Z'), at=Date.parse(asAt+'T00:00:00Z');
  if(!Number.isFinite(due)||!Number.isFinite(at)) throw new Error('Dates must be ISO calendar dates.');
  const days=Math.max(0,Math.floor((at-due)/86400000));
  return days===0?'current':days<=30?'1-30':days<=60?'31-60':days<=90?'61-90':'90+';
}
