import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { DevLogMailer, type Mailer } from './mailer';
import { registerAdminRoutes } from './admin-routes';
import { registerAuthRoutes } from './auth-routes';
import { sessionTtlSeconds } from './session';

export type IdentityModuleOptions = {
  mailer?: Mailer;
  webOrigin?: string;
};

/** Registers KRN-01 on the shared Fastify app. It does not listen on its own port. */
export async function registerKrn01(
  app: FastifyInstance,
  options: IdentityModuleOptions = {},
): Promise<void> {
  sessionTtlSeconds();
  await app.register(cookie);
  const mailer = options.mailer ?? new DevLogMailer();
  const webOrigin = options.webOrigin ?? process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  registerAuthRoutes(app);
  registerAdminRoutes(app, webOrigin, mailer);
}
