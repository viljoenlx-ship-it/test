import type { FastifyInstance } from 'fastify';
import { registerReportRoutes } from './routes';
import './sources';

/** Registers ANA-03 on the shared Fastify app. It does not listen on its own port. */
export async function registerAna03(app: FastifyInstance): Promise<void> {
  registerReportRoutes(app);
}
