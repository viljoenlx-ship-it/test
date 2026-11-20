import type { FastifyInstance } from 'fastify';
import { tenantId, withTenant } from '@omnivate/kernel';
import { HttpError, readBody, requestMeta, route } from './http';
import { requireSession } from './session';
import {
  addPartyNote,
  archiveParty,
  createParty,
  getParty,
  listParties,
  restoreParty,
  updateParty,
} from './store';

function partyId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new HttpError(404, 'not_found', 'That contact was not found.');
  }
  return value;
}

export function registerPartyRoutes(app: FastifyInstance): void {
  app.get(
    '/krn/parties',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const query = request.query as { q?: unknown; role?: unknown; status?: unknown };
      const body = await withTenant(tenantId(session.tenantId), (tx) =>
        listParties(tx, session.userId, {
          q: typeof query.q === 'string' ? query.q : '',
          role: typeof query.role === 'string' ? query.role : '',
          status: typeof query.status === 'string' ? query.status : 'active',
        }),
      );
      await reply.send(body);
    }),
  );

  app.get(
    '/krn/parties/:partyId',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const id = partyId((request.params as { partyId?: string }).partyId);
      const body = await withTenant(tenantId(session.tenantId), (tx) =>
        getParty(tx, session.userId, id),
      );
      await reply.send(body);
    }),
  );

  app.post(
    '/krn/parties',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const meta = requestMeta(request);
      const party = await withTenant(tenantId(session.tenantId), (tx) =>
        createParty(
          tx,
          { userId: session.userId, requestIp: meta.requestIp, userAgent: meta.userAgent },
          readBody(request),
        ),
      );
      await reply.code(201).send({ party });
    }),
  );

  app.put(
    '/krn/parties/:partyId',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const id = partyId((request.params as { partyId?: string }).partyId);
      const meta = requestMeta(request);
      const party = await withTenant(tenantId(session.tenantId), (tx) =>
        updateParty(
          tx,
          { userId: session.userId, requestIp: meta.requestIp, userAgent: meta.userAgent },
          id,
          readBody(request),
        ),
      );
      await reply.send({ party });
    }),
  );

  app.post(
    '/krn/parties/:partyId/notes',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const id = partyId((request.params as { partyId?: string }).partyId);
      const body = readBody(request);
      const note = typeof body.note === 'string' ? body.note : '';
      const meta = requestMeta(request);
      const party = await withTenant(tenantId(session.tenantId), (tx) =>
        addPartyNote(
          tx,
          { userId: session.userId, requestIp: meta.requestIp, userAgent: meta.userAgent },
          id,
          note,
        ),
      );
      await reply.code(201).send({ party });
    }),
  );

  app.post(
    '/krn/parties/:partyId/archive',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const id = partyId((request.params as { partyId?: string }).partyId);
      const meta = requestMeta(request);
      const party = await withTenant(tenantId(session.tenantId), (tx) =>
        archiveParty(
          tx,
          {
            userId: session.userId,
            requestIp: meta.requestIp,
            userAgent: meta.userAgent,
          },
          id,
        ),
      );
      await reply.send({ party });
    }),
  );

  app.post(
    '/krn/parties/:partyId/restore',
    route(async (request, reply) => {
      const session = await requireSession(request);
      const id = partyId((request.params as { partyId?: string }).partyId);
      const meta = requestMeta(request);
      const party = await withTenant(tenantId(session.tenantId), (tx) =>
        restoreParty(
          tx,
          {
            userId: session.userId,
            requestIp: meta.requestIp,
            userAgent: meta.userAgent,
          },
          id,
        ),
      );
      await reply.send({ party });
    }),
  );
}
