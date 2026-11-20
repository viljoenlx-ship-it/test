import type { ReportField, ReportSource } from './types';

export type Grant = {
  scope: string;
  action: string;
  modules: string[];
};

const COST_ACTIONS = new Set(['admin', 'operate', 'post', 'approve']);

export function canUseReports(grants: readonly Grant[], active: ReadonlySet<string>): boolean {
  if (!active.has('ANA-03')) {
    return false;
  }
  return grants.some(
    (grant) =>
      grant.scope === 'ana' &&
      grant.modules.includes('ANA-03') &&
      (grant.action === 'admin' || grant.action === 'read' || grant.action === 'operate'),
  );
}

export function canReadSource(
  grants: readonly Grant[],
  active: ReadonlySet<string>,
  source: ReportSource,
): boolean {
  if (!active.has(source.moduleId)) {
    return false;
  }
  return grants.some(
    (grant) =>
      grant.scope === source.read.scope &&
      grant.modules.includes(source.read.moduleId) &&
      (grant.action === 'admin' || grant.action === 'read'),
  );
}

/** Cashier stock access is read-only, so cost and stock value stay off the report. */
export function canSeeCost(grants: readonly Grant[]): boolean {
  return grants.some(
    (grant) =>
      grant.scope === 'scm.catalog' &&
      grant.modules.includes('SCM-01') &&
      COST_ACTIONS.has(grant.action),
  );
}

export function visibleField(
  field: ReportField,
  grants: readonly Grant[],
  operator: boolean,
): boolean {
  if (operator) {
    return true;
  }
  if (field.sensitive === 'cost') {
    return canSeeCost(grants);
  }
  return true;
}
