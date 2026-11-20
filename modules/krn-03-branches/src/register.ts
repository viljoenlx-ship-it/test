import type { FastifyInstance } from 'fastify';
import { registerCompanyRoutes } from './company-routes';
import { registerControlRoutes } from './control-routes';

/** Registers KRN-03 on the shared Fastify app. It does not listen on its own port. */
export async function registerKrn03(app: FastifyInstance): Promise<void> {
  registerCompanyRoutes(app);
  registerControlRoutes(app);
}
