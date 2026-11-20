import type { FastifyInstance } from 'fastify';
import { registerDocumentRoutes } from './routes';

/** Registers document capture on the shared Fastify app. It does not listen on its own port. */
export async function registerDocumentCapture(app: FastifyInstance): Promise<void> {
  registerDocumentRoutes(app);
}
