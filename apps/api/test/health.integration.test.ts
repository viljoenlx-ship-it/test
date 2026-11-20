import { checkDatabase, closePools } from '@omnivate/kernel';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

describe('GET /health against PostgreSQL', () => {
  afterAll(async () => {
    await closePools();
  });

  it('returns ok when the app role can reach the database', async () => {
    const app = await buildApp({ checkDatabase });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'omnivate-api',
      database: 'up',
      timeZone: 'Africa/Johannesburg',
    });
    await app.close();
  });
});
