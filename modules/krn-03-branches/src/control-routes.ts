import type { FastifyInstance } from 'fastify';
import { platformAllows } from '@omnivate/shared';
import { tenantId, withTenant } from '@omnivate/kernel';
import { readBody, readUuid, requestMeta, requireOperator, route } from './http';
import {
  archiveBranch,
  archiveEntity,
  createBranch,
  createEntity,
  grantBranchAccess,
  loadBranchPage,
  revokeBranchAccess,
  setMultiBranch,
  updateBranch,
  type Actor,
} from './service';
import { readBranchInput, readEnabled, readEntityInput } from './validate';

function actorFor(operatorId: string, meta: ReturnType<typeof requestMeta>): Actor {
  return {
    actorId: null,
    operatorId,
    actorKind: 'operator',
    requestIp: meta.requestIp,
    userAgent: meta.userAgent,
  };
}

/**
 * Control-panel routes for one company.
 * The operator cookie is checked first. The change then runs inside withTenant.
 */
export function registerControlRoutes(app: FastifyInstance): void {
  app.get(
    '/control/tenants/:tenantId/branches',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.read');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const canWrite = platformAllows(operator.roleKeys, 'tenants.write');
      const body = await withTenant(tenantId(id), async (tx) => {
        const page = await loadBranchPage(tx, null);
        return {
          ...page,
          canEdit: canWrite,
          canStructure: canWrite,
        };
      });
      await reply.send(body);
    }),
  );

  app.post(
    '/control/tenants/:tenantId/branches',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const input = readBranchInput(readBody(request));
      const meta = requestMeta(request);
      const branch = await withTenant(tenantId(id), (tx) =>
        createBranch(tx, actorFor(operator.operatorId, meta), input),
      );
      await reply.code(201).send({ branch });
    }),
  );

  app.patch(
    '/control/tenants/:tenantId/branches/:branchId',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const params = request.params as { tenantId?: string; branchId?: string };
      const id = readUuid(params.tenantId, 'company');
      const branchId = readUuid(params.branchId, 'branch');
      const input = readBranchInput(readBody(request));
      const meta = requestMeta(request);
      const branch = await withTenant(tenantId(id), (tx) =>
        updateBranch(tx, actorFor(operator.operatorId, meta), branchId, input),
      );
      await reply.send({ branch });
    }),
  );

  app.post(
    '/control/tenants/:tenantId/branches/:branchId/archive',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const params = request.params as { tenantId?: string; branchId?: string };
      const id = readUuid(params.tenantId, 'company');
      const branchId = readUuid(params.branchId, 'branch');
      const meta = requestMeta(request);
      const branch = await withTenant(tenantId(id), (tx) =>
        archiveBranch(tx, actorFor(operator.operatorId, meta), branchId),
      );
      await reply.send({ branch });
    }),
  );

  app.post(
    '/control/tenants/:tenantId/legal-entities',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const input = readEntityInput(readBody(request));
      const meta = requestMeta(request);
      const entity = await withTenant(tenantId(id), (tx) =>
        createEntity(tx, actorFor(operator.operatorId, meta), input),
      );
      await reply.code(201).send({ entity });
    }),
  );

  app.post(
    '/control/tenants/:tenantId/legal-entities/:entityId/archive',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const params = request.params as { tenantId?: string; entityId?: string };
      const id = readUuid(params.tenantId, 'company');
      const entityId = readUuid(params.entityId, 'legal entity');
      const meta = requestMeta(request);
      await withTenant(tenantId(id), (tx) =>
        archiveEntity(tx, actorFor(operator.operatorId, meta), entityId),
      );
      await reply.send({ ok: true });
    }),
  );

  app.post(
    '/control/tenants/:tenantId/multi-branch',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const enabled = readEnabled(readBody(request));
      const meta = requestMeta(request);
      await withTenant(tenantId(id), (tx) =>
        setMultiBranch(tx, actorFor(operator.operatorId, meta), enabled),
      );
      await reply.send({ multiBranch: enabled });
    }),
  );

  app.post(
    '/control/tenants/:tenantId/branch-access',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const id = readUuid((request.params as { tenantId?: string }).tenantId, 'company');
      const body = readBody(request);
      const userId = readUuid(body.userId, 'person');
      const branchId = readUuid(body.branchId, 'branch');
      const meta = requestMeta(request);
      const accessId = await withTenant(tenantId(id), (tx) =>
        grantBranchAccess(tx, actorFor(operator.operatorId, meta), userId, branchId),
      );
      await reply.code(201).send({ id: accessId });
    }),
  );

  app.post(
    '/control/tenants/:tenantId/branch-access/:accessId/revoke',
    route(async (request, reply) => {
      const operator = await requireOperator(request, 'tenants.write');
      const params = request.params as { tenantId?: string; accessId?: string };
      const id = readUuid(params.tenantId, 'company');
      const accessId = readUuid(params.accessId, 'assignment');
      const meta = requestMeta(request);
      await withTenant(tenantId(id), (tx) =>
        revokeBranchAccess(tx, actorFor(operator.operatorId, meta), accessId),
      );
      await reply.send({ ok: true });
    }),
  );
}
