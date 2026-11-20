import type { FastifyInstance } from 'fastify';
import { registerPartyRoutes } from './routes';

/** Registers KRN-02 on the shared Fastify app. It does not listen on its own port. */
export async function registerKrn02(app: FastifyInstance): Promise<void> {
  registerPartyRoutes(app);
}
