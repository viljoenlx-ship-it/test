import '@fastify/multipart';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  lookupOperatorSession,
  lookupSession,
  PermissionDeniedError,
  tenantId,
  withTenant,
  type TenantTransaction,
} from '@omnivate/kernel';
import { hashToken } from '@omnivate/module-krn-01';
import { platformAllows } from '@omnivate/shared';
import { oneOf } from './db';
import {
  advance,
  createPreview,
  errorReport,
  exportCsv,
  exportWorkbook,
  listBatches,
  previewRows,
  readBatch,
  templateTable,
  templateWorkbook,
  undoImport,
  updateMapping,
  type Actor,
  type DuplicatePolicy,
  type RequestMeta,
  type VatTreatment,
} from './engine';
import { csvFor } from './files';
import { HttpError, readUuid, route } from './http';
import { importTargets, targetById } from './targets';
import type { ImportTarget } from './target';

const SESSION_COOKIE = 'omnivate_session';
const OPERATOR_COOKIE = 'omnivate_operator';

type Context = {
  tenant: ReturnType<typeof tenantId>;
  actor: Actor;
};

type Resolver = (request: FastifyRequest) => Promise<Context>;

function metaOf(request: FastifyRequest): RequestMeta {
  const agent = request.headers['user-agent'];
  return {
    requestIp: request.ip || null,
    userAgent: typeof agent === 'string' ? agent.slice(0, 300) : null,
  };
}

async function sessionContext(request: FastifyRequest): Promise<Context> {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) {
    throw new HttpError(401, 'unauthenticated', 'Sign in again.');
  }
  const session = await lookupSession(hashToken(raw));
  if (
    !session ||
    session.expired ||
    session.revokedAt ||
    session.userStatus !== 'active' ||
    session.membershipStatus !== 'active'
  ) {
    throw new HttpError(401, 'unauthenticated', 'Sign in again.');
  }
  if (session.tenantStatus !== 'active') {
    throw new HttpError(
      403,
      'tenant_unavailable',
      'This company is not active. Sign-in is closed.',
    );
  }
  return {
    tenant: tenantId(session.tenantId),
    actor: { kind: 'user', userId: session.userId, operatorId: null },
  };
}

async function operatorContext(request: FastifyRequest): Promise<Context> {
  const params = request.params as { tenantId?: string };
  const company = readUuid(params.tenantId, 'company');
  const raw = request.cookies[OPERATOR_COOKIE];
  if (!raw) {
    throw new HttpError(401, 'unauthenticated', 'Sign in again.');
  }
  const session = await lookupOperatorSession(hashToken(raw));
  if (!session || session.expired || session.revokedAt || session.status !== 'active') {
    throw new HttpError(401, 'unauthenticated', 'Sign in again.');
  }
  if (!platformAllows(session.roleKeys, 'tenants.write')) {
    throw new HttpError(403, 'forbidden', 'Your platform role cannot import data.');
  }
  return {
    tenant: tenantId(company),
    actor: { kind: 'operator', userId: null, operatorId: session.operatorId },
  };
}

async function allowedTargets(tx: TenantTransaction, actor: Actor): Promise<ImportTarget[]> {
  if (actor.kind === 'operator') {
    return [...importTargets];
  }
  const allowed: ImportTarget[] = [];
  for (const target of importTargets) {
    if (actor.userId && (await target.allowUser(tx, actor.userId))) {
      allowed.push(target);
    }
  }
  return allowed;
}

async function requireTarget(
  tx: TenantTransaction,
  actor: Actor,
  id: string,
): Promise<ImportTarget> {
  const target = targetById(id);
  if (!target) {
    throw new HttpError(404, 'not_found', 'That import was not found.');
  }
  if (actor.kind === 'operator') {
    return target;
  }
  if (!actor.userId || !(await target.allowUser(tx, actor.userId))) {
    throw new PermissionDeniedError(target.denial);
  }
  return target;
}

function readPolicy(value: unknown): DuplicatePolicy {
  return value === 'update' ? 'update' : 'skip';
}

function readVat(value: unknown): VatTreatment {
  return value === 'inclusive' ? 'inclusive' : 'exclusive';
}

function readBody(request: FastifyRequest): Record<string, unknown> {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw new HttpError(400, 'bad_request', 'Expected a JSON object.');
  }
  return request.body as Record<string, unknown>;
}

function presentTarget(target: ImportTarget) {
  return {
    id: target.id,
    label: target.label,
    summary: target.summary,
    needsVatChoice: target.needsVatChoice,
    fields: target.fields.map((field) => ({
      key: field.key,
      label: field.label,
      required: field.required,
      hint: field.hint,
    })),
  };
}

async function loadTargetId(tx: TenantTransaction, batchId: string): Promise<string> {
  const row = await oneOf<{ targetId: string }>(
    tx,
    sql`SELECT target_id AS "targetId" FROM krn06_import_batches WHERE id = ${batchId}::uuid`,
  );
  if (!row) {
    throw new HttpError(404, 'not_found', 'That import was not found.');
  }
  return row.targetId;
}

function mount(app: FastifyInstance, prefix: string, resolve: Resolver): void {
  app.get(
    `${prefix}/imports/targets`,
    route(async (request, reply) => {
      const ctx = await resolve(request);
      const targets = await withTenant(ctx.tenant, (tx) => allowedTargets(tx, ctx.actor));
      await reply.send({ targets: targets.map(presentTarget) });
    }),
  );

  app.get(
    `${prefix}/imports`,
    route(async (request, reply) => {
      const ctx = await resolve(request);
      const batches = await withTenant(ctx.tenant, (tx) => listBatches(tx));
      await reply.send({ batches });
    }),
  );

  app.get(
    `${prefix}/imports/templates/:targetId/:format`,
    route(async (request, reply) => {
      const ctx = await resolve(request);
      const params = request.params as { targetId: string; format: string };
      const target = await withTenant(ctx.tenant, (tx) =>
        requireTarget(tx, ctx.actor, params.targetId),
      );
      if (params.format === 'csv') {
        await reply
          .header('content-disposition', `attachment; filename="${target.id}-template.csv"`)
          .type('text/csv; charset=utf-8')
          .send(csvFor(templateTable(target)));
        return;
      }
      if (params.format === 'xlsx') {
        const body = await templateWorkbook(target);
        await reply
          .header('content-disposition', `attachment; filename="${target.id}-template.xlsx"`)
          .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .send(body);
        return;
      }
      throw new HttpError(404, 'not_found', 'Choose a CSV or Excel template.');
    }),
  );

  app.post(
    `${prefix}/imports`,
    route(async (request, reply) => {
      const ctx = await resolve(request);
      const fields: Record<string, string> = {};
      let fileName = '';
      let bytes: Buffer | null = null;
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'file') {
          fileName = part.filename;
          bytes = await part.toBuffer();
        } else {
          fields[part.fieldname] = String(part.value ?? '');
        }
      }
      if (!bytes) {
        throw new HttpError(400, 'bad_request', 'Choose a file to upload.');
      }
      const batch = await withTenant(ctx.tenant, async (tx) => {
        const target = await requireTarget(tx, ctx.actor, fields.targetId ?? '');
        const exists = await oneOf<{ id: string }>(tx, sql`SELECT id FROM tenants`);
        if (!exists) {
          throw new HttpError(404, 'not_found', 'That company was not found.');
        }
        return createPreview(tx, {
          actor: ctx.actor,
          target,
          fileName,
          bytes,
          duplicatePolicy: readPolicy(fields.duplicatePolicy),
          vatTreatment: readVat(fields.vatTreatment),
        });
      });
      const rows = await withTenant(ctx.tenant, (tx) => previewRows(tx, batch.id));
      await reply.send({ batch, rows });
    }),
  );

  app.get(
    `${prefix}/imports/:batchId`,
    route(async (request, reply) => {
      const ctx = await resolve(request);
      const params = request.params as { batchId: string };
      const batchId = readUuid(params.batchId, 'import');
      const batch = await withTenant(ctx.tenant, async (tx) => {
        const target = await requireTarget(tx, ctx.actor, await loadTargetId(tx, batchId));
        return readBatch(tx, target, batchId);
      });
      await reply.send({ batch });
    }),
  );

  app.get(
    `${prefix}/imports/:batchId/rows`,
    route(async (request, reply) => {
      const ctx = await resolve(request);
      const params = request.params as { batchId: string };
      const batchId = readUuid(params.batchId, 'import');
      const rows = await withTenant(ctx.tenant, async (tx) => {
        await requireTarget(tx, ctx.actor, await loadTargetId(tx, batchId));
        return previewRows(tx, batchId);
      });
      await reply.send({ rows });
    }),
  );

  app.put(
    `${prefix}/imports/:batchId/mapping`,
    route(async (request, reply) => {
      const ctx = await resolve(request);
      const params = request.params as { batchId: string };
      const batchId = readUuid(params.batchId, 'import');
      const body = readBody(request);
      const columns = body.columns;
      if (!columns || typeof columns !== 'object' || Array.isArray(columns)) {
        throw new HttpError(400, 'bad_request', 'Choose a column for each field.');
      }
      const columnMap: Record<string, string | null> = {};
      for (const [header, field] of Object.entries(columns as Record<string, unknown>)) {
        columnMap[header] = typeof field === 'string' && field !== '' ? field : null;
      }
      const payload = await withTenant(ctx.tenant, async (tx) => {
        const target = await requireTarget(tx, ctx.actor, await loadTargetId(tx, batchId));
        const batch = await updateMapping(tx, {
          target,
          batchId,
          columnMap,
          duplicatePolicy: readPolicy(body.duplicatePolicy),
          vatTreatment: readVat(body.vatTreatment),
        });
        return { batch, rows: await previewRows(tx, batchId) };
      });
      await reply.send(payload);
    }),
  );

  app.post(
    `${prefix}/imports/:batchId/advance`,
    route(async (request, reply) => {
      const ctx = await resolve(request);
      const params = request.params as { batchId: string };
      const batchId = readUuid(params.batchId, 'import');
      const batch = await withTenant(ctx.tenant, async (tx) => {
        const target = await requireTarget(tx, ctx.actor, await loadTargetId(tx, batchId));
        return advance(tx, { target, batchId, actor: ctx.actor, meta: metaOf(request) });
      });
      await reply.send({ batch });
    }),
  );

  app.post(
    `${prefix}/imports/:batchId/undo`,
    route(async (request, reply) => {
      const ctx = await resolve(request);
      const params = request.params as { batchId: string };
      const batchId = readUuid(params.batchId, 'import');
      const batch = await withTenant(ctx.tenant, async (tx) => {
        const target = await requireTarget(tx, ctx.actor, await loadTargetId(tx, batchId));
        return undoImport(tx, { target, batchId, actor: ctx.actor, meta: metaOf(request) });
      });
      await reply.send({ batch });
    }),
  );

  app.get(
    `${prefix}/imports/:batchId/errors`,
    route(async (request, reply) => {
      const ctx = await resolve(request);
      const params = request.params as { batchId: string };
      const batchId = readUuid(params.batchId, 'import');
      const body = await withTenant(ctx.tenant, async (tx) => {
        await requireTarget(tx, ctx.actor, await loadTargetId(tx, batchId));
        return errorReport(tx, batchId);
      });
      await reply
        .header('content-disposition', 'attachment; filename="import-errors.csv"')
        .type('text/csv; charset=utf-8')
        .send(body);
    }),
  );

  app.get(
    `${prefix}/exports/:targetId/:format`,
    route(async (request, reply) => {
      const ctx = await resolve(request);
      const params = request.params as { targetId: string; format: string };
      const body = await withTenant(ctx.tenant, async (tx) => {
        const target = await requireTarget(tx, ctx.actor, params.targetId);
        if (params.format === 'csv') {
          return { kind: 'csv' as const, name: target.id, csv: await exportCsv(target, tx) };
        }
        if (params.format === 'xlsx') {
          return { kind: 'xlsx' as const, name: target.id, file: await exportWorkbook(target, tx) };
        }
        throw new HttpError(404, 'not_found', 'Choose a CSV or Excel file.');
      });
      if (body.kind === 'csv') {
        await reply
          .header('content-disposition', `attachment; filename="${body.name}.csv"`)
          .type('text/csv; charset=utf-8')
          .send(body.csv);
        return;
      }
      await reply
        .header('content-disposition', `attachment; filename="${body.name}.xlsx"`)
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(body.file);
    }),
  );
}

/**
 * Company routes use the signed-in session. Operator routes use the control-panel
 * cookie and withTenant for the company in the URL. That is the same door as
 * every other company change: platform_session_by_hash, then one tenant.
 */
export function registerImportRoutes(app: FastifyInstance): void {
  mount(app, '/krn', sessionContext);
  mount(app, '/control/tenants/:tenantId', operatorContext);
}
