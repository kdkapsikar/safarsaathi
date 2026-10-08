import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { makeApp } from './helpers.js';

describe('GET /api/health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await makeApp());
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
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });
});

describe('loadConfig', () => {
  it('uses safe defaults when no env vars are set', () => {
    expect(loadConfig({})).toMatchObject({
      API_PORT: 3001,
      API_HOST: '127.0.0.1',
      LOG_LEVEL: 'info',
      DATABASE_PATH: 'data/safar-saathi.db',
      COOKIE_SECURE: false,
      APP_ORIGINS: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    });
  });

  it('parses booleans and lists', () => {
    const c = loadConfig({
      COOKIE_SECURE: 'true',
      APP_ORIGINS: 'https://a.example, https://b.example',
    });
    expect(c.COOKIE_SECURE).toBe(true);
    expect(c.APP_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ API_PORT: 'abc' })).toThrow();
  });
});
