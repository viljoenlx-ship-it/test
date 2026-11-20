import type { FastifyInstance } from 'fastify';
import { requireOperator } from './auth-routes';
import { route } from './http';
import { progressBoard } from './progress';

export function registerProgressRoutes(app: FastifyInstance): void {
  app.get(
    '/control/progress',
    route(async (request, reply) => {
      await requireOperator(request, 'tenants.read');
      const board = await progressBoard();
      await reply.header('cache-control', 'no-store').send(board);
    }),
  );
}
