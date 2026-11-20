import { describe, expect, it } from 'vitest';
import { calculateVat, transitionVatPeriod, vatReturnTotals } from '../src/domain';
const standard={code:'STD',rateBasisPoints:1500,treatment:'standard' as const};
describe('FIN-06 VAT rules',()=>{it('calculates South African standard VAT in cents',()=>{expect(calculateVat(10000n,standard)).toBe(1500n);});it('summarises input and output VAT',()=>{expect(vatReturnTotals([{direction:'output',taxableCents:10000n,vatCents:1500n,code:standard}]).netVatCents).toBe(1500n);});it('requires sequential period preparation, filing and locking',()=>{expect(transitionVatPeriod('open','prepare')).toBe('prepared');expect(()=>transitionVatPeriod('open','file')).toThrow();});});
