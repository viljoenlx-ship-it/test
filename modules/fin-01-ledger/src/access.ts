import { hasPermission, type TenantTransaction } from '@omnivate/kernel';
import { LedgerError } from './errors';
import { ledgerIsOn } from './accounts';

export async function assertLedger(tx: TenantTransaction): Promise<void> {
  if (!(await ledgerIsOn(tx))) {
    throw new LedgerError('The general ledger is switched off.', 403);
  }
}

export async function canRead(tx: TenantTransaction, userId: string): Promise<boolean> {
  return hasPermission(tx, userId, { scope: 'fin.ledger', action: 'read', moduleId: 'FIN-01' });
}

export async function canEdit(tx: TenantTransaction, userId: string): Promise<boolean> {
  return hasPermission(tx, userId, { scope: 'fin.ledger', action: 'operate', moduleId: 'FIN-01' });
}

export async function canPost(tx: TenantTransaction, userId: string): Promise<boolean> {
  return hasPermission(tx, userId, { scope: 'fin.ledger', action: 'post', moduleId: 'FIN-01' });
}

export async function assertRead(tx: TenantTransaction, userId: string): Promise<void> {
  await assertLedger(tx);
  if (!(await canRead(tx, userId))) {
    throw new LedgerError('Your role cannot open the general ledger.', 403);
  }
}

export async function assertEdit(tx: TenantTransaction, userId: string): Promise<void> {
  await assertLedger(tx);
  if (!(await canEdit(tx, userId))) {
    throw new LedgerError('Your role cannot change the chart of accounts.', 403);
  }
}

export async function assertPost(tx: TenantTransaction, userId: string): Promise<void> {
  await assertLedger(tx);
  if (!(await canPost(tx, userId))) {
    throw new LedgerError('Your role cannot post a journal.', 403);
  }
}
