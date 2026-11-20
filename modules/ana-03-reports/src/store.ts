import { sql, type SQL } from 'drizzle-orm';
import { appendAuditEvent, type TenantTransaction } from '@omnivate/kernel';
import {
  isRoleKey,
  parseReportDefinition,
  READY_MADE_REPORTS,
  summariseReport,
  type ReportDefinition,
  type ReportVisibility,
} from '@omnivate/shared';
import { loadRunnableSource } from './run';
import { ReportError } from './types';

export type ActorStamp = {
  userId: string | null;
  operatorId: string | null;
  requestIp: string | null;
  userAgent: string | null;
};

export type SavedReport = {
  id: string;
  name: string;
  visibility: ReportVisibility;
  sourceKey: string;
  summary: string;
  readyKey: string | null;
  sharedRoles: string[];
  definition: ReportDefinition;
  updatedAt: string;
};

function rowsOf(result: { rows: unknown }): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}

function textArray(values: readonly string[]): SQL {
  if (values.length === 0) {
    return sql`ARRAY[]::text[]`;
  }
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

function asDefinition(value: unknown): ReportDefinition {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return parseReportDefinition(parsed);
}

function asRoles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

async function summaryOf(
  tx: TenantTransaction,
  userId: string,
  definition: ReportDefinition,
  operator: boolean,
): Promise<string> {
  try {
    const { source } = await loadRunnableSource(tx, userId, definition.source, operator);
    const label = (key: string) => source.fields.find((field) => field.key === key)?.label ?? key;
    return summariseReport({
      sourceLabel: source.label,
      filters: definition.filters.map((filter) => ({
        label: label(filter.field),
        op: filter.op,
        value: filter.value,
        valueTo: filter.valueTo,
      })),
      groupBy: definition.groupBy.map(label),
      totals: definition.totals.map((total) => ({ label: label(total.field), fn: total.fn })),
    });
  } catch {
    return definition.source;
  }
}

function mapRow(row: Record<string, unknown>, summary: string): SavedReport {
  const visibility = String(row.visibility) as ReportVisibility;
  return {
    id: String(row.id),
    name: String(row.name),
    visibility,
    sourceKey: String(row.source_key),
    summary,
    readyKey: row.ready_key ? String(row.ready_key) : null,
    sharedRoles: asRoles(row.shared_roles),
    definition: asDefinition(row.definition),
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? ''),
  };
}

export async function ensureReadyMade(tx: TenantTransaction): Promise<void> {
  for (const ready of READY_MADE_REPORTS) {
    await tx.db.execute(sql`
      INSERT INTO ana03_reports (
        tenant_id, name, source_key, definition, visibility, shared_roles, ready_key, created_by_kind
      )
      SELECT
        ${tx.tenantId},
        ${ready.name},
        ${ready.definition.source},
        ${JSON.stringify(ready.definition)}::jsonb,
        'ready_made',
        ARRAY[]::text[],
        ${ready.readyKey},
        'system'
      WHERE NOT EXISTS (
        SELECT 1 FROM ana03_reports
        WHERE ready_key = ${ready.readyKey} AND archived_at IS NULL
      )
    `);
  }
}

function visibleClause(userId: string, roleKeys: readonly string[]): SQL {
  const shared =
    roleKeys.length === 0
      ? sql`FALSE`
      : sql`(visibility = 'roles' AND shared_roles && ${textArray(roleKeys)})`;
  return sql`(
    archived_at IS NULL AND (
      visibility = 'ready_made'
      OR owner_user_id = ${userId}
      OR ${shared}
    )
  )`;
}

export async function listReports(
  tx: TenantTransaction,
  userId: string,
  roleKeys: readonly string[],
  operator: boolean,
): Promise<SavedReport[]> {
  await ensureReadyMade(tx);
  const where = operator
    ? sql`archived_at IS NULL AND visibility = 'ready_made'`
    : visibleClause(userId, roleKeys);
  const result = await tx.db.execute(sql`
    SELECT id, name, visibility, source_key, definition, shared_roles, ready_key, updated_at
    FROM ana03_reports
    WHERE ${where}
    ORDER BY CASE WHEN visibility = 'ready_made' THEN 0 ELSE 1 END, name
  `);
  const reports: SavedReport[] = [];
  for (const row of rowsOf(result)) {
    const definition = asDefinition(row.definition);
    reports.push(mapRow(row, await summaryOf(tx, userId, definition, operator)));
  }
  return reports;
}

async function loadOne(
  tx: TenantTransaction,
  id: string,
  userId: string,
  roleKeys: readonly string[],
  operator: boolean,
): Promise<Record<string, unknown>> {
  const where = operator
    ? sql`id = ${id} AND archived_at IS NULL`
    : sql`id = ${id} AND ${visibleClause(userId, roleKeys)}`;
  const result = await tx.db.execute(sql`
    SELECT id, name, visibility, source_key, definition, shared_roles, ready_key, owner_user_id, updated_at
    FROM ana03_reports
    WHERE ${where}
  `);
  const row = rowsOf(result)[0];
  if (!row) {
    throw new ReportError('That report is not available.', 404);
  }
  return row;
}

export async function getReport(
  tx: TenantTransaction,
  id: string,
  userId: string,
  roleKeys: readonly string[],
  operator: boolean,
): Promise<SavedReport> {
  const row = await loadOne(tx, id, userId, roleKeys, operator);
  const definition = asDefinition(row.definition);
  return mapRow(row, await summaryOf(tx, userId, definition, operator));
}

function cleanRoles(roles: readonly string[]): string[] {
  const next: string[] = [];
  for (const role of roles) {
    if (!isRoleKey(role)) {
      throw new ReportError('Choose a role this company uses.');
    }
    if (!next.includes(role)) {
      next.push(role);
    }
  }
  return next;
}

export async function saveReport(
  tx: TenantTransaction,
  actor: ActorStamp,
  input: {
    id?: string;
    name: string;
    definition: ReportDefinition;
    visibility: ReportVisibility;
    sharedRoles: string[];
    operator: boolean;
  },
): Promise<SavedReport> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 120) {
    throw new ReportError('Enter a report name.');
  }
  const visibility = input.operator ? 'ready_made' : input.visibility;
  if (visibility === 'ready_made' && !input.operator) {
    throw new ReportError('Ready-made reports are set up in the control panel.');
  }
  const sharedRoles = visibility === 'roles' ? cleanRoles(input.sharedRoles) : [];
  if (visibility === 'roles' && sharedRoles.length === 0) {
    throw new ReportError('Choose who can use this report.');
  }
  if (visibility === 'private' && !actor.userId) {
    throw new ReportError('A private report needs a person.');
  }
  const userId = actor.userId ?? '';
  let before: Record<string, unknown> | null = null;
  let id = input.id ?? '';
  if (input.id) {
    const existing = await loadOne(tx, input.id, userId, [], input.operator);
    if (!input.operator && String(existing.owner_user_id ?? '') !== actor.userId) {
      throw new ReportError('You can change your own reports.', 403);
    }
    if (!input.operator && existing.visibility === 'ready_made') {
      throw new ReportError('Ready-made reports are changed in the control panel.', 403);
    }
    before = { name: existing.name, visibility: existing.visibility };
    await tx.db.execute(sql`
      UPDATE ana03_reports
      SET name = ${name},
          source_key = ${input.definition.source},
          definition = ${JSON.stringify(input.definition)}::jsonb,
          visibility = ${visibility},
          shared_roles = ${textArray(sharedRoles)},
          updated_at = now()
      WHERE id = ${input.id}
    `);
  } else {
    const inserted = await tx.db.execute(sql`
      INSERT INTO ana03_reports (
        tenant_id, name, source_key, definition, visibility, owner_user_id, shared_roles, created_by_kind, operator_id
      ) VALUES (
        ${tx.tenantId},
        ${name},
        ${input.definition.source},
        ${JSON.stringify(input.definition)}::jsonb,
        ${visibility},
        ${input.operator ? null : actor.userId},
        ${textArray(sharedRoles)},
        ${input.operator ? 'operator' : 'user'},
        ${actor.operatorId}
      )
      RETURNING id
    `);
    id = String(rowsOf(inserted)[0]?.id ?? '');
  }
  await appendAuditEvent(tx, {
    action: 'report.saved',
    entityType: 'report',
    entityId: id,
    actorId: actor.userId,
    operatorId: actor.operatorId,
    actorKind: actor.operatorId ? 'operator' : 'user',
    beforeData: before,
    afterData: { name, source: input.definition.source, visibility },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
  return getReport(tx, id, userId, sharedRoles, input.operator);
}

export async function duplicateReport(
  tx: TenantTransaction,
  actor: ActorStamp,
  id: string,
  roleKeys: readonly string[],
): Promise<SavedReport> {
  if (!actor.userId) {
    throw new ReportError('Sign in again.', 401);
  }
  const current = await getReport(tx, id, actor.userId, roleKeys, false);
  const name = `Copy of ${current.name}`.slice(0, 120);
  return saveReport(tx, actor, {
    name,
    definition: current.definition,
    visibility: 'private',
    sharedRoles: [],
    operator: false,
  });
}

export async function archiveReport(
  tx: TenantTransaction,
  actor: ActorStamp,
  id: string,
  roleKeys: readonly string[],
  operator: boolean,
): Promise<void> {
  const userId = actor.userId ?? '';
  const existing = await loadOne(tx, id, userId, roleKeys, operator);
  if (!operator && String(existing.visibility) === 'ready_made') {
    throw new ReportError('Ready-made reports are changed in the control panel.', 403);
  }
  if (!operator && String(existing.owner_user_id ?? '') !== actor.userId) {
    throw new ReportError('You can change your own reports.', 403);
  }
  await tx.db.execute(sql`
    UPDATE ana03_reports SET archived_at = now(), updated_at = now() WHERE id = ${id}
  `);
  await appendAuditEvent(tx, {
    action: 'report.archived',
    entityType: 'report',
    entityId: id,
    actorId: actor.userId,
    operatorId: actor.operatorId,
    actorKind: actor.operatorId ? 'operator' : 'user',
    beforeData: { name: existing.name, archived: false },
    afterData: { name: existing.name, archived: true },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
}

export async function auditExport(
  tx: TenantTransaction,
  actor: ActorStamp,
  input: { id: string | null; name: string; format: string; rows: number },
): Promise<void> {
  await appendAuditEvent(tx, {
    action: 'report.exported',
    entityType: 'report',
    entityId: input.id ?? tx.tenantId,
    actorId: actor.userId,
    operatorId: actor.operatorId,
    actorKind: actor.operatorId ? 'operator' : 'user',
    beforeData: null,
    afterData: { name: input.name, format: input.format, rows: input.rows },
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  });
}
