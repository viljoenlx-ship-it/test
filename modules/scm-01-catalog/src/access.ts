import { eq } from 'drizzle-orm';
import {
  loadGrants,
  PermissionDeniedError,
  roles,
  userRoles,
  type TenantTransaction,
} from '@omnivate/kernel';

export type StockAccess = {
  quantities: boolean;
  costs: boolean;
  valuation: boolean;
  operate: boolean;
  approve: boolean;
  editCatalog: boolean;
};

export async function stockAccess(tx: TenantTransaction, userId: string): Promise<StockAccess> {
  const grants = await loadGrants(tx, userId);
  const mine = grants.filter(
    (grant) => grant.scope === 'scm.catalog' && grant.modules.includes('SCM-01'),
  );
  if (mine.length === 0) {
    throw new PermissionDeniedError('Your role cannot open stock.');
  }

  const actions = new Set(mine.map((grant) => grant.action));
  const admin = actions.has('admin');
  const operate = admin || actions.has('operate');
  const post = admin || actions.has('post');
  const approve = admin || actions.has('approve');
  const elevated = operate || post || approve;

  const roleRows = await tx.db
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  const keys = new Set(roleRows.map((row) => row.key));
  const portalOnly = !elevated && keys.has('external_portal') && !keys.has('sales_cashier');

  return {
    quantities: !portalOnly,
    costs: elevated,
    valuation: elevated,
    operate,
    approve,
    editCatalog: admin || operate,
  };
}
