import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { istDate, journeyDateProblem, MAX_DAYS_AHEAD } from '../src/schemas/index.js';
import { APP_ORIGIN, makeApp, register } from './helpers.js';

let app: FastifyInstance;

beforeEach(async () => {
  ({ app } = await makeApp());
});
afterEach(async () => {
  await app.close();
});

const validJourney = () => ({
  trainNumber: '12951',
  fromStationCode: 'mmct',
  fromStationName: 'Mumbai Central',
  toStationCode: 'NDLS',
  journeyDate: istDate(),
  alertTypes: ['DEPARTURE', 'DELAY'],
});

const create = (cookie: string, payload: object) =>
  app.inject({
    method: 'POST',
    url: '/api/journeys',
    headers: { cookie, origin: APP_ORIGIN },
    payload,
  });
const list = (cookie: string) =>
  app.inject({ method: 'GET', url: '/api/journeys', headers: { cookie } });
const remove = (cookie: string, id: string) =>
  app.inject({
    method: 'DELETE',
    url: `/api/journeys/${id}`,
    headers: { cookie, origin: APP_ORIGIN },
  });

describe('journeys API', () => {
  it('requires a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/journeys' })).statusCode).toBe(401);
    const res = await app.inject({
      method: 'POST',
      url: '/api/journeys',
      headers: { origin: APP_ORIGIN },
      payload: validJourney(),
    });
    expect(res.statusCode).toBe(401);
  });

  it('creates a journey, normalising codes and dropping blank names', async () => {
    const { cookie } = await register(app);
    const res = await create(cookie, { ...validJourney(), toStationName: '   ' });

    expect(res.statusCode).toBe(201);
    expect(res.json().journey).toMatchObject({
      trainNumber: '12951',
      fromStationCode: 'MMCT',
      fromStationName: 'Mumbai Central',
      toStationCode: 'NDLS',
      toStationName: null,
      status: 'ACTIVE',
      alertTypes: ['DEPARTURE', 'DELAY'],
    });
  });

  it('lists only my journeys, newest first', async () => {
    const a = await register(app);
    const b = await register(app);
    const first = (await create(a.cookie, validJourney())).json().journey;
    const second = (await create(a.cookie, { ...validJourney(), trainNumber: '12301' })).json()
      .journey;
    await create(b.cookie, { ...validJourney(), trainNumber: '22222' });

    const ids = (await list(a.cookie)).json().journeys.map((j: { id: string }) => j.id);
    expect(ids).toEqual([second.id, first.id]);
  });

  it.each([
    [{ trainNumber: '129' }, 'trainNumber'],
    [{ fromStationCode: 'MUMBAI1' }, 'fromStationCode'],
    [{ toStationCode: 'MMCT' }, 'toStationCode'],
    [{ journeyDate: '09-10-2026' }, 'journeyDate'],
    [{ alertTypes: [] }, 'alertTypes'],
    [{ alertTypes: ['SOMETHING'] }, 'alertTypes.0'],
  ])('rejects invalid field %#', async (override, field) => {
    const { cookie } = await register(app);
    const res = await create(cookie, { ...validJourney(), ...override });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields).toHaveProperty(field);
  });

  it('rejects dates outside the allowed window', async () => {
    const { cookie } = await register(app);
    for (const journeyDate of [istDate(new Date(), -2), istDate(new Date(), MAX_DAYS_AHEAD + 1)]) {
      const res = await create(cookie, { ...validJourney(), journeyDate });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.fields).toHaveProperty('journeyDate');
    }
  });

  it('ignores any user id smuggled into the body', async () => {
    const a = await register(app);
    const b = await register(app);
    const bobId = (
      await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: b.cookie } })
    ).json().user.id;

    await create(a.cookie, { ...validJourney(), userId: bobId, user_id: bobId });
    expect((await list(b.cookie)).json().journeys).toEqual([]);
    expect((await list(a.cookie)).json().journeys).toHaveLength(1);
  });

  it("deletes my journey, but another user's delete is a 404 and changes nothing", async () => {
    const a = await register(app);
    const b = await register(app);
    const j = (await create(a.cookie, validJourney())).json().journey;

    expect((await remove(b.cookie, j.id)).statusCode).toBe(404);
    expect((await list(a.cookie)).json().journeys).toHaveLength(1);

    expect((await remove(a.cookie, j.id)).statusCode).toBe(204);
    expect((await list(a.cookie)).json().journeys).toEqual([]);
    expect((await remove(a.cookie, j.id)).statusCode).toBe(404);
  });

  it('404s on a malformed id', async () => {
    const { cookie } = await register(app);
    expect((await remove(cookie, 'not-a-uuid')).statusCode).toBe(404);
  });
});

describe('journeyDateProblem', () => {
  // 2026-10-08 20:00 UTC is already 2026-10-09 01:30 in India.
  const now = new Date('2026-10-08T20:00:00Z');

  it('uses the IST calendar date', () => {
    expect(istDate(now)).toBe('2026-10-09');
  });

  it('allows yesterday through MAX_DAYS_AHEAD', () => {
    expect(journeyDateProblem('2026-10-08', now)).toBeNull();
    expect(journeyDateProblem('2026-10-09', now)).toBeNull();
    expect(journeyDateProblem(istDate(now, MAX_DAYS_AHEAD), now)).toBeNull();
  });

  it('rejects older dates and dates too far ahead', () => {
    expect(journeyDateProblem('2026-10-07', now)).toMatch(/past/);
    expect(journeyDateProblem(istDate(now, MAX_DAYS_AHEAD + 1), now)).toMatch(/within/);
  });
});
