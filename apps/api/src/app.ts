import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { registerAna03 } from '@omnivate/module-ana-03';
import { registerKrn01, type Mailer } from '@omnivate/module-krn-01';
import { registerKrn02 } from '@omnivate/module-krn-02';
import { registerKrn03 } from '@omnivate/module-krn-03';
import { registerKrn04 } from '@omnivate/module-krn-04';
import { registerKrn06 } from '@omnivate/module-krn-06';
import { registerPlatformControl } from '@omnivate/module-platform-control';
import { registerDocumentCapture } from '@omnivate/module-doc-capture';
import { registerFin01 } from '@omnivate/module-fin-01';
import { registerFin03 } from '@omnivate/module-fin-03';
import { registerFin04 } from '@omnivate/module-fin-04';
import { registerFin05 } from '@omnivate/module-fin-05';
import { registerFin06 } from '@omnivate/module-fin-06';
import { registerO2c } from '@omnivate/module-o2c';
import { registerScm01 } from '@omnivate/module-scm-01';
import { southAfricaPreset, type HealthResponse } from '@omnivate/shared';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export type AppDependencies = {
  checkDatabase: () => Promise<boolean>;
  logger?: FastifyServerOptions['logger'];
  corsOrigin?: string;
  mailer?: Mailer;
  /**
   * Built Vite app. When this is set, the same process serves those files and
   * mounts the API under /api so the session cookie stays on one origin.
   * Local `pnpm dev` leaves it unset and Vite proxies /api to the unprefixed routes.
   */
  staticRoot?: string;
  /** Built control panel. Served at /control when the preview process sets this. */
  controlRoot?: string;
  trustProxy?: boolean;
};

async function registerApi(
  app: FastifyInstance,
  deps: AppDependencies,
  origin: string,
): Promise<void> {
  await registerKrn01(app, { mailer: deps.mailer, webOrigin: origin });
  await registerKrn02(app);
  await registerKrn03(app);
  await registerPlatformControl(app, { webOrigin: origin });
  await registerKrn04(app);
  await registerScm01(app);
  await registerFin01(app);
  await registerFin03(app);
  await registerFin04(app);
  await registerFin05(app);
  await registerFin06(app);
  await registerO2c(app);
  await registerDocumentCapture(app);
  await registerAna03(app);
  await registerKrn06(app);

  app.get('/health', async (_request, reply) => {
    const databaseUp = await deps.checkDatabase();
    const body: HealthResponse = {
      status: databaseUp ? 'ok' : 'degraded',
      service: 'omnivate-api',
      database: databaseUp ? 'up' : 'down',
      currency: southAfricaPreset.currency,
      timeZone: southAfricaPreset.timeZone,
      vatStandardRateBasisPoints: southAfricaPreset.vatStandardRateBasisPoints,
    };
    return reply.code(databaseUp ? 200 : 503).send(body);
  });
}

export async function buildApp(deps: AppDependencies) {
  const app = Fastify({
    logger: deps.logger ?? false,
    trustProxy: deps.trustProxy ?? false,
  });

  const origin = deps.corsOrigin ?? 'http://localhost:5173';
  const origins = deps.staticRoot
    ? [origin]
    : [origin, 'http://localhost:5174', 'http://127.0.0.1:5174'];
  await app.register(cors, {
    origin: origins,
    credentials: true,
  });

  if (!deps.staticRoot) {
    await registerApi(app, deps, origin);
    return app;
  }

  const root = resolve(deps.staticRoot);
  if (!existsSync(root)) {
    throw new Error(`Web build not found at ${root}. Run pnpm build.`);
  }

  await app.register(
    async (api) => {
      await registerApi(api, deps, origin);
    },
    { prefix: '/api' },
  );

  // Register a route per file that exists now. A missing path falls through to
  // the handler below, which is how /login and the other screens stay on index.html.
  await app.register(fastifyStatic, { root, wildcard: false });

  const controlRoot = deps.controlRoot ? resolve(deps.controlRoot) : undefined;
  if (controlRoot) {
    if (!existsSync(controlRoot)) {
      throw new Error(`Control panel build not found at ${controlRoot}. Run pnpm build.`);
    }
    await app.register(fastifyStatic, {
      root: controlRoot,
      prefix: '/control/',
      decorateReply: false,
      wildcard: false,
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const pathOnly = (request.raw.url ?? '').split('?')[0] ?? '';
    const controlPage = pathOnly === '/control' || pathOnly.startsWith('/control/');
    if (controlPage) {
      const asset = pathOnly.startsWith('/control/assets/');
      if (controlRoot && !asset && (request.method === 'GET' || request.method === 'HEAD')) {
        return reply.sendFile('index.html', controlRoot);
      }
      return reply.code(404).type('application/json').send({ message: 'Not found' });
    }
    const appPage =
      (request.method === 'GET' || request.method === 'HEAD') &&
      !pathOnly.startsWith('/api') &&
      !pathOnly.startsWith('/assets/');
    if (!appPage) {
      return reply.code(404).type('application/json').send({ message: 'Not found' });
    }
    return reply.sendFile('index.html');
  });

  return app;
}
