import '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { registerWorkflowRoutes } from './routes';

/** Registers KRN-04 on the shared Fastify app. It does not listen on its own port. */
export async function registerKrn04(app: FastifyInstance): Promise<void> {
  registerWorkflowRoutes(app);
}
