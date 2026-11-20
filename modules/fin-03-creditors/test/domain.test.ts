import { describe, expect, it } from 'vitest';
import { allocatePayment, billAgeing, threeWayMatch, validateBillTotals } from '../src/domain';
describe('FIN-03 creditor rules',()=>{
 it('validates line and header totals',()=>{expect(()=>validateBillTotals([{description:'Parts',quantityMilli:1000n,unitCostCents:1000n,netCents:1000n,vatCents:150n}],1000n,150n,1150n)).not.toThrow();});
 it('blocks bills exceeding received quantity',()=>{expect(threeWayMatch(10000n,8000n,9000n).matched).toBe(false);});
 it('prevents over-allocation and reports unallocated cash',()=>{expect(allocatePayment(1000n,[{billId:'b1',outstandingCents:800n}],[{billId:'b1',amountCents:700n}]).unallocatedCents).toBe(300n);});
 it('ages supplier balances by due date',()=>{expect(billAgeing('2026-01-01','2026-01-31')).toBe('1-30');});
});
