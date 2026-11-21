import { describe, expect, it } from 'vitest';
import { assertWithinFloatLimit } from '../src/domain';
describe('FIN-05 float limits', () => {
 it('rejects negative limits', () => expect(() => assertWithinFloatLimit(100n,-1n)).toThrow(/cannot be negative/));
 it('treats zero as uncapped and enforces positive limits', () => { expect(() => assertWithinFloatLimit(100000n,0n)).not.toThrow(); expect(() => assertWithinFloatLimit(101n,100n)).toThrow(/exceeds/); });
});