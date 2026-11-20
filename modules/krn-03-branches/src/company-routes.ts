import type { FastifyInstance } from 'fastify';
import { loadBranchContext, tenantId, withTenant } from '@omnivate/kernel';
import { readBody, readUuid, requestMeta, requireSession, route } from './http';
import {
  archiveBranch,
  archiveEntity,
  assertCanEdit,
  assertCanRead,
  assertCanStructure,
  chooseBranch,
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

function actorFor(userId: string, meta: ReturnType<typeof requestMeta>): Actor {
  return {
    actorId: userId,
    operatorId: null,
    actorKind: 'user',
    requestIp: meta.requestIp,
    userAgent: meta.userAgent,
  };
}

/** Company-app routes. The tenant comes from the session, never from a header. */
export function registerCompanyRoutes(app: FastifyInstance): void {
  app.get(
    '/krn/branches/context',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const body = await withTenant(tenantId(session.tenantId), (tx) =>
        loadBranchContext(tx, session.userId),
      );
      await reply.send(body);
    }),
  );

  app.put(
    '/krn/branches/current',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const branchId = readUuid(readBody(request).branchId, 'branch');
      const meta = requestMeta(request);
      const branch = await withTenant(tenantId(session.tenantId), (tx) =>
        chooseBranch(tx, actorFor(session.userId, meta), session.userId, branchId),
      );
      await reply.send({ current: branch });
    }),
  );

  app.get(
    '/krn/branches',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const body = await withTenant(tenantId(session.tenantId), async (tx) => {
        await assertCanRead(tx, session.userId);
        return loadBranchPage(tx, session.userId);
      });
      await reply.send(body);
    }),
  );

  app.post(
    '/krn/branches',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const input = readBranchInput(readBody(request));
      const meta = requestMeta(request);
      const branch = await withTenant(tenantId(session.tenantId), async (tx) => {
        await assertCanEdit(tx, session.userId);
        return createBranch(tx, actorFor(session.userId, meta), input);
      });
      await reply.code(201).send({ branch });
    }),
  );

  app.patch(
    '/krn/branches/:branchId',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const branchId = readUuid((request.params as { branchId?: string }).branchId, 'branch');
      const input = readBranchInput(readBody(request));
      const meta = requestMeta(request);
      const branch = await withTenant(tenantId(session.tenantId), async (tx) => {
        await assertCanEdit(tx, session.userId);
        return updateBranch(tx, actorFor(session.userId, meta), branchId, input);
      });
      await reply.send({ branch });
    }),
  );

  app.post(
    '/krn/branches/:branchId/archive',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const branchId = readUuid((request.params as { branchId?: string }).branchId, 'branch');
      const meta = requestMeta(request);
      const branch = await withTenant(tenantId(session.tenantId), async (tx) => {
        await assertCanStructure(tx, session.userId);
        return archiveBranch(tx, actorFor(session.userId, meta), branchId);
      });
      await reply.send({ branch });
    }),
  );

  app.post(
    '/krn/legal-entities',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const input = readEntityInput(readBody(request));
      const meta = requestMeta(request);
      const entity = await withTenant(tenantId(session.tenantId), async (tx) => {
        await assertCanStructure(tx, session.userId);
        return createEntity(tx, actorFor(session.userId, meta), input);
      });
      await reply.code(201).send({ entity });
    }),
  );

  app.post(
    '/krn/legal-entities/:entityId/archive',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const entityId = readUuid((request.params as { entityId?: string }).entityId, 'legal entity');
      const meta = requestMeta(request);
      await withTenant(tenantId(session.tenantId), async (tx) => {
        await assertCanStructure(tx, session.userId);
        await archiveEntity(tx, actorFor(session.userId, meta), entityId);
      });
      await reply.send({ ok: true });
    }),
  );

  app.post(
    '/krn/multi-branch',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const enabled = readEnabled(readBody(request));
      const meta = requestMeta(request);
      await withTenant(tenantId(session.tenantId), async (tx) => {
        await assertCanStructure(tx, session.userId);
        await setMultiBranch(tx, actorFor(session.userId, meta), enabled);
      });
      await reply.send({ multiBranch: enabled });
    }),
  );

  app.post(
    '/krn/branch-access',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const body = readBody(request);
      const userId = readUuid(body.userId, 'person');
      const branchId = readUuid(body.branchId, 'branch');
      const meta = requestMeta(request);
      const id = await withTenant(tenantId(session.tenantId), async (tx) => {
        await assertCanEdit(tx, session.userId);
        return grantBranchAccess(tx, actorFor(session.userId, meta), userId, branchId);
      });
      await reply.code(201).send({ id });
    }),
  );

  app.post(
    '/krn/branch-access/:accessId/revoke',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const accessId = readUuid((request.params as { accessId?: string }).accessId, 'assignment');
      const meta = requestMeta(request);
      await withTenant(tenantId(session.tenantId), async (tx) => {
        await assertCanEdit(tx, session.userId);
        await revokeBranchAccess(tx, actorFor(session.userId, meta), accessId);
      });
      await reply.send({ ok: true });
    }),
  );
}
