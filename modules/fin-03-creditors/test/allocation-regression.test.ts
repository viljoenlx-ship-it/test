import { describe, expect, it } from 'vitest';
import { allocatePayment } from '../src/domain';
describe('FIN-03 allocation input integrity', () => {
 it('rejects duplicate bill balances', () => expect(() => allocatePayment(100n,[{billId:'b1',outstandingCents:50n},{billId:'b1',outstandingCents:50n}],[{billId:'b1',amountCents:20n}])).toThrow(/unique IDs/));
 it('rejects negative outstanding balances', () => expect(() => allocatePayment(100n,[{billId:'b1',outstandingCents:-1n}],[{billId:'b1',amountCents:1n}])).toThrow(/non-negative/));
});