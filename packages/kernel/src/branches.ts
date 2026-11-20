import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '@omnivate/db';
import { BranchAccessError } from './errors';
import { hasPermission } from './permissions';

/**
 * The branch a later module should stamp on a row.
 * FIN-01, SCM-01, SAL-03, and ANA-03 call requireBranchAccess before they write.
 */
export type BranchScope = {
  id: string;
  legalEntityId: string;
  code: string;
  name: string;
  isHeadOffice: boolean;
};

export type BranchContext = {
  /** False means the company works from Head Office only. Do not show a picker. */
  multiBranch: boolean;
  current: BranchScope | null;
  /** Branches this person may choose. Empty when multi-branch is off. */
  branches: BranchScope[];
};

type BranchRow = {
  id: string;
  legalEntityId: string;
  code: string;
  name: string;
  isHeadOffice: boolean;
};

const branchColumns = sql`
  id,
  legal_entity_id AS "legalEntityId",
  code,
  name,
  is_head_office AS "isHeadOffice"
`;

async function queryBranches(tx: TenantTransaction, statement: ReturnType<typeof sql>) {
  const result = await tx.db.execute<BranchRow>(statement);
  return result.rows.map((row) => ({
    id: row.id,
    legalEntityId: row.legalEntityId,
    code: row.code,
    name: row.name,
    isHeadOffice: row.isHeadOffice,
  }));
}

async function multiBranchEnabled(tx: TenantTransaction): Promise<boolean> {
  const result = await tx.db.execute<{ multiBranch: boolean }>(sql`
    SELECT multi_branch_enabled AS "multiBranch"
    FROM krn03_settings
    LIMIT 1
  `);
  return result.rows[0]?.multiBranch === true;
}

async function activeMember(tx: TenantTransaction, userId: string): Promise<boolean> {
  const result = await tx.db.execute<{ ok: boolean }>(sql`
    SELECT true AS ok
    FROM memberships
    WHERE user_id = ${userId} AND status = 'active'
    LIMIT 1
  `);
  return result.rows[0]?.ok === true;
}

async function headOffice(tx: TenantTransaction): Promise<BranchScope | null> {
  const rows = await queryBranches(
    tx,
    sql`
      SELECT ${branchColumns}
      FROM krn03_branches
      WHERE is_head_office AND archived_at IS NULL AND active
      LIMIT 1
    `,
  );
  return rows[0] ?? null;
}

async function branchById(tx: TenantTransaction, branchId: string): Promise<BranchScope | null> {
  const rows = await queryBranches(
    tx,
    sql`
      SELECT ${branchColumns}
      FROM krn03_branches
      WHERE id = ${branchId} AND archived_at IS NULL AND active
      LIMIT 1
    `,
  );
  return rows[0] ?? null;
}

async function isKernelAdmin(tx: TenantTransaction, userId: string): Promise<boolean> {
  return hasPermission(tx, userId, { scope: 'krn', action: 'admin', moduleId: 'KRN-03' });
}

async function assigned(tx: TenantTransaction, userId: string, branchId: string): Promise<boolean> {
  const result = await tx.db.execute<{ ok: boolean }>(sql`
    SELECT true AS ok
    FROM krn03_branch_access
    WHERE user_id = ${userId}
      AND branch_id = ${branchId}
      AND revoked_at IS NULL
    LIMIT 1
  `);
  return result.rows[0]?.ok === true;
}

async function accessibleBranches(tx: TenantTransaction, userId: string): Promise<BranchScope[]> {
  if (await isKernelAdmin(tx, userId)) {
    return queryBranches(
      tx,
      sql`
        SELECT ${branchColumns}
        FROM krn03_branches
        WHERE archived_at IS NULL AND active
        ORDER BY is_head_office DESC, name
      `,
    );
  }
  return queryBranches(
    tx,
    sql`
      SELECT
        b.id,
        b.legal_entity_id AS "legalEntityId",
        b.code,
        b.name,
        b.is_head_office AS "isHeadOffice"
      FROM krn03_branches AS b
      INNER JOIN krn03_branch_access AS a
        ON a.branch_id = b.id AND a.revoked_at IS NULL AND a.user_id = ${userId}
      WHERE b.archived_at IS NULL AND b.active
      ORDER BY b.is_head_office DESC, b.name
    `,
  );
}

async function storedBranchId(tx: TenantTransaction, userId: string): Promise<string | null> {
  const result = await tx.db.execute<{ branchId: string }>(sql`
    SELECT branch_id AS "branchId"
    FROM krn03_current_branch
    WHERE user_id = ${userId}
    LIMIT 1
  `);
  return result.rows[0]?.branchId ?? null;
}

async function rememberBranch(
  tx: TenantTransaction,
  userId: string,
  branchId: string,
): Promise<void> {
  await tx.db.execute(sql`
    INSERT INTO krn03_current_branch (tenant_id, user_id, branch_id)
    VALUES (${tx.tenantId}, ${userId}, ${branchId})
    ON CONFLICT (tenant_id, user_id)
    DO UPDATE SET branch_id = EXCLUDED.branch_id, updated_at = now()
  `);
}

/**
 * Decides which branch a person may use.
 * Call this inside withTenant before writing a branch-scoped row.
 *
 * A company that has not turned on more than one branch always resolves to Head Office.
 * Pass no branch id to use the person's current branch.
 * Owners (kernel admin) may use every active branch. Everyone else needs an assignment.
 */
export async function requireBranchAccess(
  tx: TenantTransaction,
  userId: string,
  branchId?: string | null,
): Promise<BranchScope> {
  if (!(await activeMember(tx, userId))) {
    throw new BranchAccessError('You are not an active member of this company.');
  }

  const multi = await multiBranchEnabled(tx);
  const head = await headOffice(tx);
  if (!head) {
    throw new BranchAccessError('This company has no Head Office.');
  }

  if (!multi) {
    if (branchId && branchId !== head.id) {
      throw new BranchAccessError('This company uses one branch. Work stays at Head Office.');
    }
    return head;
  }

  const requested = branchId ?? (await storedBranchId(tx, userId));
  if (!requested) {
    throw new BranchAccessError('Choose a branch.');
  }

  const branch = await branchById(tx, requested);
  if (!branch) {
    throw new BranchAccessError('That branch is not available.');
  }

  if (await isKernelAdmin(tx, userId)) {
    return branch;
  }
  if (!(await assigned(tx, userId, branch.id))) {
    throw new BranchAccessError('You are not assigned to that branch.');
  }
  return branch;
}

/**
 * What the company app header needs.
 * When multiBranch is false the branch list is empty so a picker is not shown.
 * A stale current branch is moved to the first branch the person can still use.
 */
export async function loadBranchContext(
  tx: TenantTransaction,
  userId: string,
): Promise<BranchContext> {
  if (!(await activeMember(tx, userId))) {
    return { multiBranch: false, current: null, branches: [] };
  }

  const multi = await multiBranchEnabled(tx);
  const head = await headOffice(tx);
  if (!multi) {
    return { multiBranch: false, current: head, branches: [] };
  }

  const branches = await accessibleBranches(tx, userId);
  const stored = await storedBranchId(tx, userId);
  const current = branches.find((branch) => branch.id === stored) ?? branches[0] ?? null;
  if (current && current.id !== stored) {
    await rememberBranch(tx, userId, current.id);
  }
  return { multiBranch: true, current, branches };
}

/** Remembers an explicit choice. The caller checks requireBranchAccess first and writes the audit. */
export async function rememberCurrentBranch(
  tx: TenantTransaction,
  userId: string,
  branchId: string,
): Promise<void> {
  await rememberBranch(tx, userId, branchId);
}
