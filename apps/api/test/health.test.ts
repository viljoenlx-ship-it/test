import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

describe('GET /health', () => {
  it('reports ok when the database answers', async () => {
    const app = await buildApp({ checkDatabase: async () => true });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'omnivate-api',
      database: 'up',
      currency: 'ZAR',
      timeZone: 'Africa/Johannesburg',
      vatStandardRateBasisPoints: 1500,
    });
    await app.close();
  });

  it('reports degraded when the database does not answer', async () => {
    const app = await buildApp({ checkDatabase: async () => false });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'degraded',
      database: 'down',
      currency: 'ZAR',
    });
    await app.close();
  });
});
