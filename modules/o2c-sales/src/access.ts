import { activeModuleSet, hasPermission, type TenantTransaction } from '@omnivate/kernel';
import type { ModuleId } from '@omnivate/shared';
import { SalesError } from './errors';

export type Actor = {
  userId: string;
  requestIp: string | null;
  userAgent: string | null;
};

async function on(tx: TenantTransaction, moduleId: ModuleId): Promise<boolean> {
  const active = await activeModuleSet(tx);
  return active.has(moduleId);
}

export async function requireQuotes(tx: TenantTransaction): Promise<void> {
  if (!(await on(tx, 'SAL-01'))) {
    throw new SalesError('Quotes are switched off for this company.', 403);
  }
}

export async function requireDebtors(tx: TenantTransaction): Promise<void> {
  if (!(await on(tx, 'FIN-02'))) {
    throw new SalesError('Invoicing is switched off for this company.', 403);
  }
}

export async function canReadQuotes(tx: TenantTransaction, userId: string): Promise<boolean> {
  return hasPermission(tx, userId, { scope: 'sal.pipeline', action: 'read', moduleId: 'SAL-01' });
}

export async function canWriteQuotes(tx: TenantTransaction, userId: string): Promise<boolean> {
  return hasPermission(tx, userId, {
    scope: 'sal.pipeline',
    action: 'operate',
    moduleId: 'SAL-01',
  });
}

export async function canReadInvoices(tx: TenantTransaction, userId: string): Promise<boolean> {
  return hasPermission(tx, userId, { scope: 'fin.ledger', action: 'read', moduleId: 'FIN-02' });
}

export async function canWriteInvoices(tx: TenantTransaction, userId: string): Promise<boolean> {
  const post = await hasPermission(tx, userId, {
    scope: 'fin.ledger',
    action: 'post',
    moduleId: 'FIN-02',
  });
  if (post) {
    return true;
  }
  return hasPermission(tx, userId, {
    scope: 'fin.ledger',
    action: 'operate',
    moduleId: 'FIN-02',
  });
}

export async function assertQuoteRead(tx: TenantTransaction, userId: string): Promise<void> {
  await requireQuotes(tx);
  if (!(await canReadQuotes(tx, userId))) {
    throw new SalesError('Your role cannot open quotes.', 403);
  }
}

export async function assertQuoteWrite(tx: TenantTransaction, userId: string): Promise<void> {
  await requireQuotes(tx);
  if (!(await canWriteQuotes(tx, userId))) {
    throw new SalesError('Your role cannot change quotes.', 403);
  }
}

export async function assertInvoiceRead(tx: TenantTransaction, userId: string): Promise<void> {
  await requireDebtors(tx);
  if (!(await canReadInvoices(tx, userId))) {
    throw new SalesError('Your role cannot open invoices.', 403);
  }
}

export async function assertInvoiceWrite(tx: TenantTransaction, userId: string): Promise<void> {
  await requireDebtors(tx);
  if (!(await canWriteInvoices(tx, userId))) {
    throw new SalesError('Your role cannot change invoices or receipts.', 403);
  }
}

export async function salesAccess(tx: TenantTransaction, userId: string) {
  const quotesOn = await on(tx, 'SAL-01');
  const invoicesOn = await on(tx, 'FIN-02');
  const readQuotes = quotesOn && (await canReadQuotes(tx, userId));
  const writeQuotes = quotesOn && (await canWriteQuotes(tx, userId));
  const readInvoices = invoicesOn && (await canReadInvoices(tx, userId));
  const writeInvoices = invoicesOn && (await canWriteInvoices(tx, userId));
  if (!readQuotes && !readInvoices) {
    throw new SalesError('Your role cannot open sales.', 403);
  }
  return {
    quotes: readQuotes,
    editQuotes: writeQuotes,
    invoices: readInvoices,
    issueInvoices: writeInvoices,
    customers: readQuotes || readInvoices,
    editCustomers: writeQuotes || writeInvoices,
  };
}
