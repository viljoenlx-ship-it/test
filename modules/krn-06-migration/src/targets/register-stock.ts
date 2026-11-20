import { createStockTarget } from './stock-items';

/**
 * Stock import is stored by SCM-01.
 * Opening quantities are receipts on the immutable ledger, at weighted-average cost.
 * This file is the only stock registration.
 */
export const stockTarget = createStockTarget();
