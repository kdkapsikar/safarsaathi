import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/index.js';
import { createTrainServices, type TrainServices } from '../src/trains/index.js';
import { APP_ORIGIN, testConfig } from './helpers.js';

let app: FastifyInstance;
let trains: TrainServices;

async function start(env: Record<string, string> = {}) {
  const config = testConfig({ TRAIN_RETRIES: '0', ...env });
  trains = createTrainServices(config);
  app = await buildApp({ config, db: openDatabase(':memory:'), trains });
  return app;
}
afterEach(async () => {
  await app?.close();
});

const sim = (url: string, payload: object) =>
  app.inject({
    method: 'POST',
    url: `/api/simulator/${url}`,
    headers: { origin: APP_ORIGIN },
    payload,
  });

describe('train data API', () => {
  it('returns live status from the provider, publicly', async () => {
    await start();
    const res = await app.inject({
      method: 'GET',
      url: '/api/trains/12951/status?date=2026-10-09',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toMatchObject({
      trainNumber: '12951',
      trainName: 'Mumbai Rajdhani',
      startDate: '2026-10-09',
      source: 'simulator',
    });
    expect(res.json().status.fetchedAt).toBeTruthy();
  });

  it('404s for a train the source does not know', async () => {
    await start();
    const res = await app.inject({ method: 'GET', url: '/api/trains/99999/status' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('TRAIN_NOT_FOUND');
  });

  it('400s on malformed input', async () => {
    await start();
    expect((await app.inject({ method: 'GET', url: '/api/trains/12/status' })).statusCode).toBe(
      400,
    );
    expect(
      (await app.inject({ method: 'GET', url: '/api/trains/12951/status?date=tomorrow' }))
        .statusCode,
    ).toBe(400);
  });

  it('returns 503, not a guess, when the source is down', async () => {
    await start();
    await sim('health', { health: 'DOWN' });
    const res = await app.inject({ method: 'GET', url: '/api/trains/12951/status' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('TRAIN_DATA_UNAVAILABLE');
  });

  it('serves schedules and capabilities', async () => {
    await start();
    const sched = await app.inject({ method: 'GET', url: '/api/trains/12301/schedule' });
    expect(sched.json().schedule.stops[0].code).toBe('HWH');
    const caps = await app.inject({ method: 'GET', url: '/api/trains/capabilities' });
    expect(caps.json()).toMatchObject({ source: 'simulator', capabilities: { platforms: true } });
  });
});

describe('simulator API', () => {
  it('lists trains and scenarios', async () => {
    await start();
    const res = await app.inject({ method: 'GET', url: '/api/simulator' });
    expect(res.json().trains.map((t: { trainNumber: string }) => t.trainNumber)).toContain('12951');
    expect(res.json().scenarios).toHaveLength(5);
  });

  it('changes a scenario and the next status reflects it immediately (cache dropped)', async () => {
    await start();
    await sim('clock', {
      action: 'beforeDeparture',
      trainNumber: '12951',
      startDate: '2026-10-09',
      minutes: 60,
    });
    const before = await app.inject({
      method: 'GET',
      url: '/api/trains/12951/status?date=2026-10-09',
    });
    expect(before.json().status.cancelled).toBe(false);

    await sim('scenario', { trainNumber: '12951', scenario: 'CANCELLED' });
    const after = await app.inject({
      method: 'GET',
      url: '/api/trains/12951/status?date=2026-10-09',
    });
    expect(after.json().status.state).toBe('CANCELLED');
  });

  it('moves simulated time forward', async () => {
    await start();
    await sim('clock', {
      action: 'beforeDeparture',
      trainNumber: '12951',
      startDate: '2026-10-09',
      minutes: 30,
    });
    const s1 = (
      await app.inject({ method: 'GET', url: '/api/trains/12951/status?date=2026-10-09' })
    ).json();
    expect(s1.status.state).toBe('NOT_STARTED');

    const snap = (await sim('clock', { action: 'advance', minutes: 240 })).json();
    expect(snap.offsetMinutes).not.toBe(0);
    const s2 = (
      await app.inject({ method: 'GET', url: '/api/trains/12951/status?date=2026-10-09' })
    ).json();
    expect(s2.status.state).toBe('RUNNING');

    await sim('clock', { action: 'reset' });
    expect((await app.inject({ method: 'GET', url: '/api/simulator' })).json().offsetMinutes).toBe(
      0,
    );
  });

  it('rejects unknown trains and scenarios', async () => {
    await start();
    expect((await sim('scenario', { trainNumber: '99999', scenario: 'ON_TIME' })).statusCode).toBe(
      404,
    );
    expect((await sim('scenario', { trainNumber: '12951', scenario: 'EXPLODED' })).statusCode).toBe(
      400,
    );
  });

  it('is not available in production, or with an HTTP source', async () => {
    await start({ NODE_ENV: 'production' });
    expect((await app.inject({ method: 'GET', url: '/api/simulator' })).statusCode).toBe(404);
    await app.close();

    await start({ TRAIN_PROVIDER: 'http', TRAIN_API_BASE_URL: 'https://adapter.example' });
    expect((await app.inject({ method: 'GET', url: '/api/simulator' })).statusCode).toBe(404);
  });
});
