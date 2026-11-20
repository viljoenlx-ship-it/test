import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { operatorSessionTtlSeconds } from './session';
import { registerOperatorAuth } from './auth-routes';
import { registerPublicBranding } from './public-routes';
import { registerPreviewRoutes } from './preview-routes';
import { registerProgressRoutes } from './progress-routes';
import { registerTenantRoutes } from './tenant-routes';

export type PlatformModuleOptions = {
  webOrigin?: string;
};

/** Registers the control panel on the shared Fastify app. It does not listen on its own port. */
export async function registerPlatformControl(
  app: FastifyInstance,
  options: PlatformModuleOptions = {},
): Promise<void> {
  operatorSessionTtlSeconds();
  await app.register(multipart, {
    // Logos are still rejected above 1 MB in branding-files. Spreadsheet
    // imports need room for at least 10,000 rows.
    limits: { fileSize: 20_000_000, files: 1 },
  });
  const webOrigin = options.webOrigin ?? process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  registerOperatorAuth(app);
  registerProgressRoutes(app);
  registerTenantRoutes(app, webOrigin);
  registerPreviewRoutes(app, webOrigin);
  registerPublicBranding(app);
}
