import type { FastifyInstance } from 'fastify';
import { registerImportRoutes } from './routes';

/** Registers KRN-06 on the shared Fastify app. It does not listen on its own port. */
export async function registerKrn06(app: FastifyInstance): Promise<void> {
  registerImportRoutes(app);
}
