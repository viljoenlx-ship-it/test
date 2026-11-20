import {
  assertApiDatabase,
  checkDatabase,
  closePools,
  MFA_OFF_WARNING,
  mfaEnforcement,
} from '@omnivate/kernel';
import { buildApp } from './app';

assertApiDatabase();

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3000);
const host = process.env.API_HOST ?? (process.env.RENDER === 'true' ? '0.0.0.0' : '127.0.0.1');
const webOrigin =
  process.env.WEB_ORIGIN ??
  process.env.RENDER_EXTERNAL_URL?.replace(/\/$/, '') ??
  'http://localhost:5173';

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error('Set PORT or API_PORT to a TCP port.');
}

const onRender = process.env.RENDER === 'true' || Boolean(process.env.RENDER_EXTERNAL_URL);

const app = await buildApp({
  checkDatabase,
  corsOrigin: webOrigin,
  staticRoot: process.env.STATIC_ROOT,
  controlRoot: process.env.CONTROL_ROOT,
  trustProxy: onRender,
  logger:
    process.env.NODE_ENV === 'production'
      ? true
      : {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        },
});

const shutdown = async (): Promise<void> => {
  await app.close();
  await closePools();
};

process.on('SIGINT', () => {
  void shutdown().then(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void shutdown().then(() => process.exit(0));
});

try {
  if (mfaEnforcement() === 'off') {
    app.log.warn(MFA_OFF_WARNING);
  }
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  await closePools();
  process.exit(1);
}
