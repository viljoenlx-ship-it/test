import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { readLogo } from '@omnivate/module-platform-control';
import { tenantId, withTenant } from '@omnivate/kernel';
import { ACCESS_ROLES, parseReportDefinition, type ReportVisibility } from '@omnivate/shared';
import { renderCsv, renderPdf, renderXlsx, type ReportBrand } from './export-file';
import {
  HttpError,
  readBody,
  requireActor,
  requireOperator,
  route,
  type ActorMeta,
  type OperatorMeta,
} from './http';
import { catalogFor, runReport } from './run';
import {
  archiveReport,
  auditExport,
  duplicateReport,
  getReport,
  listReports,
  saveReport,
  type ActorStamp,
} from './store';

const PAGE = 50;
const PAGE_MAX = 200;
const EXPORT_MAX = 5000;

function rowsOf(result: { rows: unknown }): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}

async function roleKeys(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  userId: string,
): Promise<string[]> {
  const result = await tx.db.execute(sql`
    SELECT role.key AS key
    FROM user_roles AS ur
    JOIN roles AS role ON role.id = ur.role_id
    WHERE ur.user_id = ${userId}
  `);
  return rowsOf(result).map((row) => String(row.key));
}

function readDefinition(body: Record<string, unknown>) {
  try {
    return parseReportDefinition(body.definition);
  } catch (error) {
    throw new HttpError(
      400,
      'bad_request',
      error instanceof Error ? error.message : 'Check the report.',
    );
  }
}

function readName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readOffset(value: unknown): number {
  const offset = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.max(0, Math.min(offset, 10000));
}

function readVisibility(value: unknown): ReportVisibility {
  if (value === 'roles' || value === 'private') {
    return value;
  }
  return 'private';
}

function readRoles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

async function brandOf(tx: Parameters<Parameters<typeof withTenant>[1]>[0]): Promise<ReportBrand> {
  const result = await tx.db.execute(sql`
    SELECT company_name, display_name, vat_number, address_city, brand_primary, logo_storage_key
    FROM tenants
  `);
  const row = rowsOf(result)[0];
  const key = row?.logo_storage_key ? String(row.logo_storage_key) : '';
  const logo = key ? await readLogo(tx.tenantId, key) : null;
  return {
    companyName: String(row?.company_name || row?.display_name || 'Company'),
    city: row?.address_city ? String(row.address_city) : null,
    vatNumber: row?.vat_number ? String(row.vat_number) : null,
    primary: String(row?.brand_primary ?? '#314056'),
    logo,
  };
}

function stamp(actor: ActorMeta | (OperatorMeta & { userId: string | null })): ActorStamp {
  return {
    userId: 'userId' in actor ? actor.userId : null,
    operatorId: 'operatorId' in actor ? actor.operatorId : null,
    requestIp: actor.requestIp,
    userAgent: actor.userAgent,
  };
}

export function registerReportRoutes(app: FastifyInstance): void {
  app.get(
    '/reports/catalog',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        catalogFor(tx, actor.userId, false),
      );
      await reply.send({
        ...body,
        roles: ACCESS_ROLES.filter((role) => role.key !== 'external_portal').map((role) => ({
          key: role.key,
          name: role.name,
        })),
      });
    }),
  );

  app.get(
    '/reports',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const reports = await withTenant(tenantId(actor.tenantId), async (tx) => {
        const roles = await roleKeys(tx, actor.userId);
        return listReports(tx, actor.userId, roles, false);
      });
      await reply.send({
        readyMade: reports.filter((report) => report.visibility === 'ready_made'),
        mine: reports.filter((report) => report.visibility !== 'ready_made'),
      });
    }),
  );

  app.get(
    '/reports/:id',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const report = await withTenant(tenantId(actor.tenantId), async (tx) => {
        const roles = await roleKeys(tx, actor.userId);
        return getReport(tx, id, actor.userId, roles, false);
      });
      await reply.send({ report });
    }),
  );

  app.post(
    '/reports/preview',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = readBody(request);
      const definition = readDefinition(body);
      const requested = typeof body.limit === 'number' ? body.limit : PAGE;
      const limit = Math.max(1, Math.min(PAGE_MAX, Math.floor(requested)));
      const table = await withTenant(tenantId(actor.tenantId), (tx) =>
        runReport(tx, actor.userId, definition, { limit, offset: readOffset(body.offset) }),
      );
      await reply.send(table);
    }),
  );

  app.post(
    '/reports',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = readBody(request);
      const saved = await withTenant(tenantId(actor.tenantId), (tx) =>
        saveReport(tx, stamp(actor), {
          name: readName(body.name),
          definition: readDefinition(body),
          visibility: readVisibility(body.visibility),
          sharedRoles: readRoles(body.sharedRoles),
          operator: false,
        }),
      );
      await reply.code(201).send({ report: saved });
    }),
  );

  app.patch(
    '/reports/:id',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const body = readBody(request);
      const saved = await withTenant(tenantId(actor.tenantId), (tx) =>
        saveReport(tx, stamp(actor), {
          id,
          name: readName(body.name),
          definition: readDefinition(body),
          visibility: readVisibility(body.visibility),
          sharedRoles: readRoles(body.sharedRoles),
          operator: false,
        }),
      );
      await reply.send({ report: saved });
    }),
  );

  app.post(
    '/reports/:id/duplicate',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      const saved = await withTenant(tenantId(actor.tenantId), async (tx) => {
        const roles = await roleKeys(tx, actor.userId);
        return duplicateReport(tx, stamp(actor), id, roles);
      });
      await reply.code(201).send({ report: saved });
    }),
  );

  app.post(
    '/reports/:id/archive',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const { id } = request.params as { id: string };
      await withTenant(tenantId(actor.tenantId), async (tx) => {
        const roles = await roleKeys(tx, actor.userId);
        await archiveReport(tx, stamp(actor), id, roles, false);
      });
      await reply.send({ archived: true });
    }),
  );

  app.post(
    '/reports/export',
    route(async (request, reply) => {
      const actor = await requireActor(request);
      const body = readBody(request);
      const format =
        body.format === 'xlsx' || body.format === 'pdf' || body.format === 'csv'
          ? body.format
          : null;
      if (!format) {
        throw new HttpError(400, 'bad_request', 'Choose CSV, Excel, or PDF.');
      }
      const definition = readDefinition(body);
      const name = readName(body.name) || 'Report';
      const reportId = typeof body.reportId === 'string' ? body.reportId : null;
      const file = await withTenant(tenantId(actor.tenantId), async (tx) => {
        const table = await runReport(tx, actor.userId, definition, {
          limit: EXPORT_MAX,
          offset: 0,
          timeout: 'export',
        });
        const rendered =
          format === 'csv'
            ? renderCsv(name, table)
            : format === 'xlsx'
              ? renderXlsx(name, table)
              : await renderPdf(name, table, await brandOf(tx));
        await auditExport(tx, stamp(actor), {
          id: reportId,
          name,
          format,
          rows: table.rows.length,
        });
        return rendered;
      });
      await reply
        .header('content-type', file.contentType)
        .header('content-disposition', `attachment; filename="${file.filename}"`)
        .send(file.body);
    }),
  );

  app.get(
    '/control/tenants/:tenantId/reports',
    route(async (request, reply) => {
      const operator = await requireOperator(request);
      const { tenantId: company } = request.params as { tenantId: string };
      const reports = await withTenant(tenantId(company), (tx) =>
        listReports(tx, operator.operatorId, [], true),
      );
      await reply.send({ reports });
    }),
  );

  app.get(
    '/control/tenants/:tenantId/report-sources',
    route(async (request, reply) => {
      const operator = await requireOperator(request);
      const { tenantId: company } = request.params as { tenantId: string };
      const catalog = await withTenant(tenantId(company), (tx) =>
        catalogFor(tx, operator.operatorId, true),
      );
      await reply.send(catalog);
    }),
  );

  app.post(
    '/control/tenants/:tenantId/reports',
    route(async (request, reply) => {
      const operator = await requireOperator(request);
      const { tenantId: company } = request.params as { tenantId: string };
      const body = readBody(request);
      const saved = await withTenant(tenantId(company), (tx) =>
        saveReport(
          tx,
          {
            userId: null,
            operatorId: operator.operatorId,
            requestIp: operator.requestIp,
            userAgent: operator.userAgent,
          },
          {
            name: readName(body.name),
            definition: readDefinition(body),
            visibility: 'ready_made',
            sharedRoles: [],
            operator: true,
          },
        ),
      );
      await reply.code(201).send({ report: saved });
    }),
  );

  app.post(
    '/control/tenants/:tenantId/reports/:id/archive',
    route(async (request, reply) => {
      const operator = await requireOperator(request);
      const { tenantId: company, id } = request.params as { tenantId: string; id: string };
      await withTenant(tenantId(company), (tx) =>
        archiveReport(
          tx,
          {
            userId: null,
            operatorId: operator.operatorId,
            requestIp: operator.requestIp,
            userAgent: operator.userAgent,
          },
          id,
          [],
          true,
        ),
      );
      await reply.send({ archived: true });
    }),
  );
}
