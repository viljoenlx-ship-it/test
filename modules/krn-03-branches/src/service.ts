import { sql } from 'drizzle-orm';
import {
  appendAuditEvent,
  hasPermission,
  rememberCurrentBranch,
  requireBranchAccess,
  requirePermission,
  type BranchScope,
  type TenantTransaction,
} from '@omnivate/kernel';
import { BranchRuleError } from './http';
import type { BranchInput, EntityInput } from './validate';

export type Actor = {
  actorId: string | null;
  operatorId: string | null;
  actorKind: 'user' | 'operator';
  requestIp: string | null;
  userAgent: string | null;
};

type BranchRecord = BranchScope & {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  active: boolean;
  archivedAt: string | null;
  legalEntityName: string;
};

type EntityRecord = {
  id: string;
  name: string;
  registrationNumber: string | null;
  vatNumber: string | null;
  isPrimary: boolean;
  archivedAt: string | null;
};

type AssignmentRecord = {
  id: string;
  userId: string;
  branchId: string;
  displayName: string;
  email: string;
  branchName: string;
};

type PersonRecord = {
  id: string;
  displayName: string;
  email: string;
};

function stamp(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function snapshot(row: BranchRecord): Record<string, unknown> {
  return {
    name: row.name,
    code: row.code,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntityName,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    province: row.province,
    postalCode: row.postalCode,
    country: row.country,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    active: row.active,
    isHeadOffice: row.isHeadOffice,
    archivedAt: row.archivedAt,
  };
}

const branchSelect = sql`
  b.id,
  b.legal_entity_id AS "legalEntityId",
  e.name AS "legalEntityName",
  b.code,
  b.name,
  b.address_line1 AS "addressLine1",
  b.address_line2 AS "addressLine2",
  b.city,
  b.province,
  b.postal_code AS "postalCode",
  b.country,
  b.contact_name AS "contactName",
  b.contact_email AS "contactEmail",
  b.contact_phone AS "contactPhone",
  b.active,
  b.is_head_office AS "isHeadOffice",
  b.archived_at AS "archivedAt"
`;

function mapBranch(row: BranchRecord & { archivedAt: Date | string | null }): BranchRecord {
  return { ...row, country: row.country.trim(), archivedAt: stamp(row.archivedAt) };
}

async function audit(
  tx: TenantTransaction,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string,
  beforeData: Record<string, unknown> | null,
  afterData: Record<string, unknown> | null,
): Promise<void> {
  await appendAuditEvent(tx, {
    action,
    entityType,
    entityId,
    actorId: actor.actorId,
    operatorId: actor.operatorId,
    actorKind: actor.actorKind,
    beforeData,
    afterData,
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
}

async function multiEnabled(tx: TenantTransaction): Promise<boolean> {
  const result = await tx.db.execute<{ enabled: boolean }>(sql`
    SELECT multi_branch_enabled AS enabled FROM krn03_settings LIMIT 1
  `);
  return result.rows[0]?.enabled === true;
}

async function branches(tx: TenantTransaction): Promise<BranchRecord[]> {
  const result = await tx.db.execute<BranchRecord & { archivedAt: Date | string | null }>(sql`
    SELECT ${branchSelect}
    FROM krn03_branches AS b
    INNER JOIN krn03_legal_entities AS e ON e.id = b.legal_entity_id
    ORDER BY b.archived_at IS NOT NULL, b.is_head_office DESC, b.name
  `);
  return result.rows.map(mapBranch);
}

async function branchById(tx: TenantTransaction, id: string): Promise<BranchRecord | null> {
  const result = await tx.db.execute<BranchRecord & { archivedAt: Date | string | null }>(sql`
    SELECT ${branchSelect}
    FROM krn03_branches AS b
    INNER JOIN krn03_legal_entities AS e ON e.id = b.legal_entity_id
    WHERE b.id = ${id}
    LIMIT 1
  `);
  const row = result.rows[0];
  return row ? mapBranch(row) : null;
}

async function primaryEntityId(tx: TenantTransaction): Promise<string> {
  const result = await tx.db.execute<{ id: string }>(sql`
    SELECT id FROM krn03_legal_entities
    WHERE is_primary AND archived_at IS NULL
    LIMIT 1
  `);
  const id = result.rows[0]?.id;
  if (!id) {
    throw new BranchRuleError('This company has no legal entity yet.');
  }
  return id;
}

async function liveEntity(tx: TenantTransaction, id: string): Promise<EntityRecord | null> {
  const result = await tx.db.execute<EntityRecord & { archivedAt: Date | string | null }>(sql`
    SELECT id, name,
           registration_number AS "registrationNumber",
           vat_number AS "vatNumber",
           is_primary AS "isPrimary",
           archived_at AS "archivedAt"
    FROM krn03_legal_entities
    WHERE id = ${id}
    LIMIT 1
  `);
  const row = result.rows[0];
  if (!row || row.archivedAt) {
    return null;
  }
  return { ...row, archivedAt: null };
}

export type ImportBranch = {
  id: string;
  name: string;
  code: string;
  isHeadOffice: boolean;
};

/** Live branches for KRN-06. Head Office is the default when a file leaves Branch blank. */
export async function listImportBranches(tx: TenantTransaction): Promise<ImportBranch[]> {
  const result = await tx.db.execute<{
    id: string;
    name: string;
    code: string;
    isHeadOffice: boolean;
  }>(sql`
    SELECT id, name, code, is_head_office AS "isHeadOffice"
    FROM krn03_branches
    WHERE archived_at IS NULL AND active
    ORDER BY is_head_office DESC, name
  `);
  return result.rows;
}

export async function loadBranchPage(tx: TenantTransaction, userId: string | null) {
  const all = await branches(tx);
  const entitiesResult = await tx.db.execute<EntityRecord & { archivedAt: Date | string | null }>(
    sql`
      SELECT id, name,
             registration_number AS "registrationNumber",
             vat_number AS "vatNumber",
             is_primary AS "isPrimary",
             archived_at AS "archivedAt"
      FROM krn03_legal_entities
      ORDER BY is_primary DESC, name
    `,
  );
  const assignments = await tx.db.execute<AssignmentRecord>(sql`
    SELECT a.id,
           a.user_id AS "userId",
           a.branch_id AS "branchId",
           u.display_name AS "displayName",
           u.email,
           b.name AS "branchName"
    FROM krn03_branch_access AS a
    INNER JOIN users AS u ON u.id = a.user_id
    INNER JOIN krn03_branches AS b ON b.id = a.branch_id
    WHERE a.revoked_at IS NULL AND b.archived_at IS NULL
    ORDER BY u.display_name, b.name
  `);
  const people = await tx.db.execute<PersonRecord>(sql`
    SELECT u.id, u.display_name AS "displayName", u.email
    FROM memberships AS m
    INNER JOIN users AS u ON u.id = m.user_id
    WHERE m.status = 'active'
    ORDER BY u.display_name
  `);
  const canEdit = userId
    ? await hasPermission(tx, userId, { scope: 'krn', action: 'operate', moduleId: 'KRN-03' })
    : true;
  const canStructure = userId
    ? await hasPermission(tx, userId, { scope: 'krn', action: 'admin', moduleId: 'KRN-03' })
    : true;
  return {
    multiBranch: await multiEnabled(tx),
    canEdit,
    canStructure,
    branches: all.filter((row) => !row.archivedAt),
    archived: all.filter((row) => row.archivedAt),
    entities: entitiesResult.rows.map((row) => ({ ...row, archivedAt: stamp(row.archivedAt) })),
    assignments: assignments.rows,
    people: people.rows,
  };
}

export async function setMultiBranch(
  tx: TenantTransaction,
  actor: Actor,
  enabled: boolean,
): Promise<void> {
  const before = await multiEnabled(tx);
  if (before === enabled) {
    return;
  }
  await tx.db.execute(sql`
    UPDATE krn03_settings
    SET multi_branch_enabled = ${enabled}, updated_at = now()
  `);
  let assignedToHeadOffice: string[] = [];
  if (enabled) {
    const head = await tx.db.execute<{ id: string }>(sql`
      SELECT id FROM krn03_branches
      WHERE is_head_office AND archived_at IS NULL
      LIMIT 1
    `);
    const headId = head.rows[0]?.id;
    if (!headId) {
      throw new BranchRuleError('This company has no Head Office.');
    }
    const inserted = await tx.db.execute<{ userId: string }>(sql`
      INSERT INTO krn03_branch_access (tenant_id, user_id, branch_id)
      SELECT ${tx.tenantId}, m.user_id, ${headId}
      FROM memberships AS m
      WHERE m.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM krn03_branch_access AS existing
          WHERE existing.user_id = m.user_id
            AND existing.branch_id = ${headId}
            AND existing.revoked_at IS NULL
        )
      RETURNING user_id AS "userId"
    `);
    assignedToHeadOffice = inserted.rows.map((row) => row.userId);
  }
  await audit(
    tx,
    actor,
    enabled ? 'krn03.multi_branch.enabled' : 'krn03.multi_branch.disabled',
    'tenant',
    tx.tenantId,
    { multiBranch: before },
    {
      multiBranch: enabled,
      assignedToHeadOffice,
    },
  );
}

export async function createBranch(
  tx: TenantTransaction,
  actor: Actor,
  input: BranchInput,
): Promise<BranchRecord> {
  if (!(await multiEnabled(tx))) {
    throw new BranchRuleError('Turn on more than one branch before you add another.');
  }
  const legalEntityId = input.legalEntityId ?? (await primaryEntityId(tx));
  if (!(await liveEntity(tx, legalEntityId))) {
    throw new BranchRuleError('Choose a legal entity that is still in use.');
  }
  const inserted = await tx.db.execute<{ id: string }>(sql`
    INSERT INTO krn03_branches (
      tenant_id, legal_entity_id, name, code,
      address_line1, address_line2, city, province, postal_code, country,
      contact_name, contact_email, contact_phone, active, is_head_office
    ) VALUES (
      ${tx.tenantId}, ${legalEntityId}, ${input.name}, ${input.code},
      ${input.addressLine1}, ${input.addressLine2}, ${input.city}, ${input.province},
      ${input.postalCode}, ${input.country},
      ${input.contactName}, ${input.contactEmail}, ${input.contactPhone},
      ${input.active}, false
    )
    RETURNING id
  `);
  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new BranchRuleError('The branch was not saved.');
  }
  const row = await branchById(tx, id);
  if (!row) {
    throw new BranchRuleError('The branch was not saved.');
  }
  await audit(tx, actor, 'krn03.branch.created', 'branch', id, null, snapshot(row));
  return row;
}

export async function updateBranch(
  tx: TenantTransaction,
  actor: Actor,
  branchId: string,
  input: BranchInput,
): Promise<BranchRecord> {
  const before = await branchById(tx, branchId);
  if (!before || before.archivedAt) {
    throw new BranchRuleError('That branch was not found.');
  }
  if (before.isHeadOffice && !input.active) {
    throw new BranchRuleError('Head Office stays active. It is the home branch.');
  }
  const legalEntityId = input.legalEntityId ?? before.legalEntityId;
  if (!(await liveEntity(tx, legalEntityId))) {
    throw new BranchRuleError('Choose a legal entity that is still in use.');
  }
  await tx.db.execute(sql`
    UPDATE krn03_branches
    SET legal_entity_id = ${legalEntityId},
        name = ${input.name},
        code = ${input.code},
        address_line1 = ${input.addressLine1},
        address_line2 = ${input.addressLine2},
        city = ${input.city},
        province = ${input.province},
        postal_code = ${input.postalCode},
        country = ${input.country},
        contact_name = ${input.contactName},
        contact_email = ${input.contactEmail},
        contact_phone = ${input.contactPhone},
        active = ${input.active},
        updated_at = now()
    WHERE id = ${branchId}
  `);
  const after = await branchById(tx, branchId);
  if (!after) {
    throw new BranchRuleError('The branch was not saved.');
  }
  await audit(
    tx,
    actor,
    'krn03.branch.updated',
    'branch',
    branchId,
    snapshot(before),
    snapshot(after),
  );
  return after;
}

export async function archiveBranch(
  tx: TenantTransaction,
  actor: Actor,
  branchId: string,
): Promise<BranchRecord> {
  const before = await branchById(tx, branchId);
  if (!before || before.archivedAt) {
    throw new BranchRuleError('That branch was not found.');
  }
  if (before.isHeadOffice) {
    throw new BranchRuleError('Head Office cannot be archived. It is the home branch.');
  }
  await tx.db.execute(sql`
    UPDATE krn03_branches
    SET archived_at = now(), active = false, updated_at = now()
    WHERE id = ${branchId}
  `);
  const closed = await tx.db.execute<{ id: string }>(sql`
    UPDATE krn03_branch_access
    SET revoked_at = now()
    WHERE branch_id = ${branchId} AND revoked_at IS NULL
    RETURNING id
  `);
  const head = await tx.db.execute<{ id: string }>(sql`
    SELECT id FROM krn03_branches
    WHERE is_head_office AND archived_at IS NULL
    LIMIT 1
  `);
  const headId = head.rows[0]?.id;
  if (headId) {
    await tx.db.execute(sql`
      UPDATE krn03_current_branch
      SET branch_id = ${headId}, updated_at = now()
      WHERE branch_id = ${branchId}
    `);
  }
  const after = await branchById(tx, branchId);
  if (!after) {
    throw new BranchRuleError('The branch was not archived.');
  }
  await audit(tx, actor, 'krn03.branch.archived', 'branch', branchId, snapshot(before), {
    ...snapshot(after),
    assignmentsClosed: closed.rows.length,
  });
  return after;
}

export async function createEntity(
  tx: TenantTransaction,
  actor: Actor,
  input: EntityInput,
): Promise<EntityRecord> {
  const inserted = await tx.db.execute<{ id: string }>(sql`
    INSERT INTO krn03_legal_entities (tenant_id, name, registration_number, vat_number, is_primary)
    VALUES (${tx.tenantId}, ${input.name}, ${input.registrationNumber}, ${input.vatNumber}, false)
    RETURNING id
  `);
  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new BranchRuleError('The legal entity was not saved.');
  }
  const row = await liveEntity(tx, id);
  if (!row) {
    throw new BranchRuleError('The legal entity was not saved.');
  }
  await audit(tx, actor, 'krn03.entity.created', 'legal_entity', id, null, { ...row });
  return row;
}

export async function archiveEntity(
  tx: TenantTransaction,
  actor: Actor,
  entityId: string,
): Promise<void> {
  const before = await liveEntity(tx, entityId);
  if (!before) {
    throw new BranchRuleError('That legal entity was not found.');
  }
  if (before.isPrimary) {
    throw new BranchRuleError('The main legal entity stays with the company.');
  }
  const used = await tx.db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM krn03_branches
    WHERE legal_entity_id = ${entityId} AND archived_at IS NULL
  `);
  if ((used.rows[0]?.n ?? 0) > 0) {
    throw new BranchRuleError('Archive or move the branches on this legal entity first.');
  }
  await tx.db.execute(sql`
    UPDATE krn03_legal_entities
    SET archived_at = now(), updated_at = now()
    WHERE id = ${entityId}
  `);
  await audit(
    tx,
    actor,
    'krn03.entity.archived',
    'legal_entity',
    entityId,
    { ...before },
    {
      ...before,
      archivedAt: new Date().toISOString(),
    },
  );
}

export async function grantBranchAccess(
  tx: TenantTransaction,
  actor: Actor,
  userId: string,
  branchId: string,
): Promise<string> {
  const branch = await branchById(tx, branchId);
  if (!branch || branch.archivedAt || !branch.active) {
    throw new BranchRuleError('Choose an active branch.');
  }
  const member = await tx.db.execute<{ ok: boolean }>(sql`
    SELECT true AS ok FROM memberships
    WHERE user_id = ${userId} AND status = 'active'
    LIMIT 1
  `);
  if (!member.rows[0]?.ok) {
    throw new BranchRuleError('That person is not active at this company.');
  }
  const existing = await tx.db.execute<{ id: string }>(sql`
    SELECT id FROM krn03_branch_access
    WHERE user_id = ${userId} AND branch_id = ${branchId} AND revoked_at IS NULL
    LIMIT 1
  `);
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }
  const inserted = await tx.db.execute<{ id: string }>(sql`
    INSERT INTO krn03_branch_access (tenant_id, user_id, branch_id)
    VALUES (${tx.tenantId}, ${userId}, ${branchId})
    RETURNING id
  `);
  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new BranchRuleError('The assignment was not saved.');
  }
  await audit(tx, actor, 'krn03.branch_access.granted', 'branch_access', id, null, {
    userId,
    branchId,
    branchName: branch.name,
  });
  return id;
}

export async function revokeBranchAccess(
  tx: TenantTransaction,
  actor: Actor,
  accessId: string,
): Promise<void> {
  const before = await tx.db.execute<{
    id: string;
    userId: string;
    branchId: string;
    branchName: string;
  }>(sql`
    SELECT a.id, a.user_id AS "userId", a.branch_id AS "branchId", b.name AS "branchName"
    FROM krn03_branch_access AS a
    INNER JOIN krn03_branches AS b ON b.id = a.branch_id
    WHERE a.id = ${accessId} AND a.revoked_at IS NULL
    LIMIT 1
  `);
  const row = before.rows[0];
  if (!row) {
    throw new BranchRuleError('That branch assignment was not found.');
  }
  await tx.db.execute(sql`
    UPDATE krn03_branch_access SET revoked_at = now() WHERE id = ${accessId}
  `);
  await audit(
    tx,
    actor,
    'krn03.branch_access.revoked',
    'branch_access',
    accessId,
    { ...row },
    {
      ...row,
      revoked: true,
    },
  );
}

export async function chooseBranch(
  tx: TenantTransaction,
  actor: Actor,
  userId: string,
  branchId: string,
): Promise<BranchScope> {
  const before = await tx.db.execute<{ branchId: string | null }>(sql`
    SELECT branch_id AS "branchId" FROM krn03_current_branch WHERE user_id = ${userId} LIMIT 1
  `);
  const branch = await requireBranchAccess(tx, userId, branchId);
  if (before.rows[0]?.branchId === branch.id) {
    return branch;
  }
  await rememberCurrentBranch(tx, userId, branch.id);
  await audit(
    tx,
    actor,
    'krn03.current_branch.set',
    'branch',
    branch.id,
    { branchId: before.rows[0]?.branchId ?? null },
    { branchId: branch.id, name: branch.name, code: branch.code },
  );
  return branch;
}

export async function assertCanRead(tx: TenantTransaction, userId: string): Promise<void> {
  await requirePermission(tx, userId, { scope: 'krn', action: 'read', moduleId: 'KRN-03' });
}

export async function assertCanEdit(tx: TenantTransaction, userId: string): Promise<void> {
  await requirePermission(tx, userId, { scope: 'krn', action: 'operate', moduleId: 'KRN-03' });
}

export async function assertCanStructure(tx: TenantTransaction, userId: string): Promise<void> {
  await requirePermission(tx, userId, { scope: 'krn', action: 'admin', moduleId: 'KRN-03' });
}
