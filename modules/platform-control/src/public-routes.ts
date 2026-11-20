import type { FastifyInstance } from 'fastify';
import { lookupPublicBranding, lookupTenantLogoKey } from '@omnivate/kernel';
import { contentTypeFor, readLogo } from './branding-files';
import { HttpError, route } from './http';

export function registerPublicBranding(app: FastifyInstance): void {
  app.get(
    '/branding/:slug',
    route(async (request, reply) => {
      const slug = (request.params as { slug?: string }).slug ?? '';
      if (!/^[a-z0-9-]{2,63}$/.test(slug)) {
        throw new HttpError(404, 'not_found', 'That company was not found.');
      }
      const branding = await lookupPublicBranding(slug);
      if (!branding) {
        throw new HttpError(404, 'not_found', 'That company was not found.');
      }
      await reply.send(branding);
    }),
  );

  app.get(
    '/branding/:slug/logo',
    route(async (request, reply) => {
      const slug = (request.params as { slug?: string }).slug ?? '';
      if (!/^[a-z0-9-]{2,63}$/.test(slug)) {
        throw new HttpError(404, 'not_found', 'That company was not found.');
      }
      const located = await lookupTenantLogoKey(slug);
      if (!located) {
        throw new HttpError(404, 'not_found', 'This company has no logo.');
      }
      const bytes = await readLogo(located.tenantId, located.logoStorageKey);
      if (!bytes) {
        throw new HttpError(404, 'not_found', 'This company has no logo.');
      }
      await reply
        .header('content-type', contentTypeFor(located.logoStorageKey))
        .header('cache-control', 'private, max-age=60')
        .send(bytes);
    }),
  );
}
