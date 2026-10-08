import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

describe('GET /api/health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ LOG_LEVEL: 'silent' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports the API is up', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ status: 'ok', service: 'safar-saathi-api' });
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });

  it('returns 404 for unknown API routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
  });
});

describe('loadConfig', () => {
  it('uses safe defaults when no env vars are set', () => {
    expect(loadConfig({})).toEqual({ API_PORT: 3001, API_HOST: '127.0.0.1', LOG_LEVEL: 'info' });
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ API_PORT: 'abc' })).toThrow();
  });
});
