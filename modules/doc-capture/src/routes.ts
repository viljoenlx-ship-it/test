import '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { lookupOperatorSession, lookupSession, tenantId, withTenant } from '@omnivate/kernel';
import { platformAllows } from '@omnivate/shared';
import { copy } from './copy';
import { DocumentError } from './errors';
import { hashToken, readBody, readUuid, requestMeta, route } from './http';
import {
  captureAccess,
  captureDocument,
  captureOverview,
  createItem,
  createSupplier,
  fileFor,
  kickDocument,
  listDocuments,
  presentDocument,
  readUpdatedAt,
  receiveDocument,
  saveDocument,
  setCaptureEnabled,
  undoDocument,
  type Actor,
  type DocumentDraft,
} from './service';

const SESSION_COOKIE = 'omnivate_session';
const OPERATOR_COOKIE = 'omnivate_operator';

function cookiesOf(request: FastifyRequest): Record<string, string | undefined> {
  return (request as { cookies?: Record<string, string | undefined> }).cookies ?? {};
}

async function actorFrom(request: FastifyRequest): Promise<Actor & { tenantId: string }> {
  const raw = cookiesOf(request)[SESSION_COOKIE];
  if (!raw) {
    throw new DocumentError(copy.signIn, 401, 'unauthenticated');
  }
  const session = await lookupSession(hashToken(raw));
  if (
    !session ||
    session.expired ||
    session.revokedAt ||
    session.userStatus !== 'active' ||
    session.membershipStatus !== 'active'
  ) {
    throw new DocumentError(copy.signIn, 401, 'unauthenticated');
  }
  if (session.tenantStatus !== 'active') {
    throw new DocumentError(
      'This company is not active. Sign-in is closed.',
      403,
      'tenant_unavailable',
    );
  }
  const meta = requestMeta(request);
  return { userId: session.userId, tenantId: session.tenantId, ...meta };
}

async function operatorFrom(request: FastifyRequest, action: 'tenants.read' | 'tenants.write') {
  const raw = cookiesOf(request)[OPERATOR_COOKIE];
  if (!raw) {
    throw new DocumentError(copy.signIn, 401, 'unauthenticated');
  }
  const session = await lookupOperatorSession(hashToken(raw));
  if (!session || session.expired || session.revokedAt || session.status !== 'active') {
    throw new DocumentError(copy.signIn, 401, 'unauthenticated');
  }
  if (!platformAllows(session.roleKeys, action)) {
    throw new DocumentError('Your platform role cannot do that.', 403, 'forbidden');
  }
  return { id: session.operatorId, ...requestMeta(request) };
}

function draftFrom(body: Record<string, unknown>): DocumentDraft {
  const lines = Array.isArray(body.lines) ? body.lines : [];
  return {
    documentType: typeof body.documentType === 'string' ? body.documentType : '',
    supplierName: typeof body.supplierName === 'string' ? body.supplierName : '',
    supplierVat: typeof body.supplierVat === 'string' ? body.supplierVat : '',
    partyId: typeof body.partyId === 'string' ? body.partyId : null,
    documentNumber: typeof body.documentNumber === 'string' ? body.documentNumber : '',
    documentDate: typeof body.documentDate === 'string' ? body.documentDate : '',
    dueDate: typeof body.dueDate === 'string' ? body.dueDate : '',
    currency: typeof body.currency === 'string' ? body.currency : '',
    subtotal: typeof body.subtotal === 'string' ? body.subtotal : '',
    vat: typeof body.vat === 'string' ? body.vat : '',
    total: typeof body.total === 'string' ? body.total : '',
    branchId: typeof body.branchId === 'string' ? body.branchId : '',
    lines: lines.map((entry) => {
      const line = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      return {
        id: typeof line.id === 'string' ? line.id : '',
        description: typeof line.description === 'string' ? line.description : '',
        supplierCode: typeof line.supplierCode === 'string' ? line.supplierCode : '',
        quantity: typeof line.quantity === 'string' ? line.quantity : '',
        unit: typeof line.unit === 'string' ? line.unit : '',
        unitPrice: typeof line.unitPrice === 'string' ? line.unitPrice : '',
        vat: typeof line.vat === 'string' ? line.vat : '',
        lineTotal: typeof line.lineTotal === 'string' ? line.lineTotal : '',
        itemId: typeof line.itemId === 'string' ? line.itemId : null,
      };
    }),
  };
}

export function registerDocumentRoutes(app: FastifyInstance): void {
  app.get(
    '/documents/access',
    route(async (request, reply) => {
      const actor = await actorFrom(request);
      try {
        const access = await withTenant(tenantId(actor.tenantId), (tx) =>
          captureAccess(tx, actor.userId),
        );
        await reply.send(access);
      } catch (error) {
        if (error instanceof DocumentError && error.code === 'module_off') {
          await reply.send({ canCapture: false, canReview: false });
          return;
        }
        throw error;
      }
    }),
  );

  app.get(
    '/documents',
    route(async (request, reply) => {
      const actor = await actorFrom(request);
      const body = await withTenant(tenantId(actor.tenantId), (tx) => listDocuments(tx, actor));
      await reply.send(body);
    }),
  );

  app.post(
    '/documents',
    route(async (request, reply) => {
      const actor = await actorFrom(request);
      const part = await request.file();
      if (!part) {
        throw new DocumentError(copy.chooseFile);
      }
      const bytes = await part.toBuffer();
      if (part.file.truncated) {
        throw new DocumentError(copy.tooLarge);
      }
      const id = await withTenant(tenantId(actor.tenantId), (tx) =>
        captureDocument(tx, actor, { filename: part.filename || 'document', bytes }),
      );
      kickDocument(actor.tenantId, id);
      await reply.code(201).send({ id, status: 'queued', statusLabel: copy.queued });
    }),
  );

  app.get(
    '/documents/:id/file',
    route(async (request, reply) => {
      const actor = await actorFrom(request);
      const { id } = request.params as { id: string };
      const file = await withTenant(tenantId(actor.tenantId), (tx) =>
        fileFor(tx, actor, readUuid(id, 'document')),
      );
      await reply
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, no-store')
        .type(file.contentType)
        .send(file.bytes);
    }),
  );

  app.get(
    '/documents/:id',
    route(async (request, reply) => {
      const actor = await actorFrom(request);
      const { id } = request.params as { id: string };
      const documentId = readUuid(id, 'document');
      await withTenant(tenantId(actor.tenantId), (tx) => readUpdatedAt(tx, documentId));
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        presentDocument(tx, actor, documentId),
      );
      await reply.send(body);
    }),
  );

  app.patch(
    '/documents/:id',
    route(async (request, reply) => {
      const actor = await actorFrom(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        saveDocument(tx, actor, readUuid(id, 'document'), draftFrom(readBody(request))),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/documents/:id/supplier',
    route(async (request, reply) => {
      const actor = await actorFrom(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        createSupplier(tx, actor, readUuid(id, 'document')),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/documents/:id/lines/:lineId/item',
    route(async (request, reply) => {
      const actor = await actorFrom(request);
      const params = request.params as { id: string; lineId: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        createItem(tx, actor, readUuid(params.id, 'document'), readUuid(params.lineId, 'line')),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/documents/:id/receive',
    route(async (request, reply) => {
      const actor = await actorFrom(request);
      const { id } = request.params as { id: string };
      const confirm = readBody(request).confirmDuplicate === true;
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        receiveDocument(tx, actor, readUuid(id, 'document'), confirm),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/documents/:id/undo',
    route(async (request, reply) => {
      const actor = await actorFrom(request);
      const { id } = request.params as { id: string };
      const body = await withTenant(tenantId(actor.tenantId), (tx) =>
        undoDocument(tx, actor, readUuid(id, 'document')),
      );
      await reply.send(body);
    }),
  );

  app.get(
    '/control/tenants/:tenantId/document-capture',
    route(async (request, reply) => {
      await operatorFrom(request, 'tenants.read');
      const { tenantId: company } = request.params as { tenantId: string };
      const body = await withTenant(tenantId(readUuid(company, 'company')), (tx) =>
        captureOverview(tx),
      );
      await reply.send(body);
    }),
  );

  app.put(
    '/control/tenants/:tenantId/document-capture',
    route(async (request, reply) => {
      const operator = await operatorFrom(request, 'tenants.write');
      const { tenantId: company } = request.params as { tenantId: string };
      const payload = readBody(request);
      const enabled = payload.enabled;
      const reader = payload.reader;
      if (typeof enabled !== 'boolean') {
        throw new DocumentError('Choose whether document capture is on.');
      }
      if (reader !== 'standard' && reader !== 'premium') {
        throw new DocumentError('Choose Standard Reader or Premium Reader.');
      }
      const body = await withTenant(tenantId(readUuid(company, 'company')), (tx) =>
        setCaptureEnabled(tx, operator, enabled, reader),
      );
      await reply.send(body);
    }),
  );
}
