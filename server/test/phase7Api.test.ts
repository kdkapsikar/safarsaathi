import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/index.js';
import { istDate } from '../src/schemas/dates.js';
import { APP_ORIGIN, makeApp, register } from './helpers.js';

let app: FastifyInstance;
let db: Db;
beforeEach(async () => {
  ({ app, db } = await makeApp());
});
afterEach(async () => {
  await app.close();
});

const req = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  cookie?: string,
  payload?: object,
) =>
  app.inject({
    method,
    url,
    payload,
    headers: { origin: APP_ORIGIN, ...(cookie ? { cookie } : {}) },
  });

const settings = {
  minDelayMinutes: 30,
  quietHoursStart: '22:00',
  quietHoursEnd: '06:30',
  travelTimeMinutes: 40,
  leaveBufferMinutes: 15,
  connectsToJourneyId: null,
  connectionBufferMinutes: 30,
};

async function journey(cookie: string, trainNumber = '12951') {
  const res = await req('POST', '/api/journeys', cookie, {
    trainNumber,
    fromStationCode: 'MMCT',
    toStationCode: 'NDLS',
    journeyDate: istDate(),
    alertTypes: ['DELAY', 'DEPARTURE'],
  });
  return res.json().journey as {
    id: string;
    settings: typeof settings;
    inviteToken: string | null;
  };
}

describe('journey settings', () => {
  it('saves smart rules and returns them with the journey', async () => {
    const { cookie } = await register(app);
    const j = await journey(cookie);
    expect(j.settings).toMatchObject({
      travelTimeMinutes: null,
      leaveBufferMinutes: 15,
      minDelayMinutes: null,
    });

    const res = await req('PUT', `/api/journeys/${j.id}/settings`, cookie, settings);
    expect(res.statusCode).toBe(200);
    expect(res.json().journey.settings).toEqual(settings);
    const listed = (await req('GET', '/api/journeys', cookie)).json().journeys[0];
    expect(listed.settings).toEqual(settings);
  });

  it.each([
    [{ quietHoursStart: '22:00', quietHoursEnd: null }, 'quietHoursEnd'],
    [{ quietHoursStart: '22:00', quietHoursEnd: '22:00' }, 'quietHoursEnd'],
    [{ travelTimeMinutes: 900 }, 'travelTimeMinutes'],
    [{ connectsToJourneyId: 'nope' }, 'connectsToJourneyId'],
  ])('rejects invalid settings %#', async (override, field) => {
    const { cookie } = await register(app);
    const j = await journey(cookie);
    const res = await req('PUT', `/api/journeys/${j.id}/settings`, cookie, {
      ...settings,
      ...override,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields).toHaveProperty(field);
  });

  it("can only link to the user's own other journeys", async () => {
    const a = await register(app);
    const b = await register(app);
    const mine = await journey(a.cookie);
    const mine2 = await journey(a.cookie, '12002');
    const theirs = await journey(b.cookie);

    const bad = (target: string) =>
      req('PUT', `/api/journeys/${mine.id}/settings`, a.cookie, {
        ...settings,
        connectsToJourneyId: target,
      });
    expect((await bad(theirs.id)).statusCode).toBe(400);
    expect((await bad(mine.id)).statusCode).toBe(400);
    expect((await bad(mine2.id)).statusCode).toBe(200);
  });

  it("can't change another user's journey", async () => {
    const a = await register(app);
    const b = await register(app);
    const j = await journey(a.cookie);
    expect(
      (await req('PUT', `/api/journeys/${j.id}/settings`, b.cookie, settings)).statusCode,
    ).toBe(404);
  });
});

describe('recipients', () => {
  it('adds, lists and removes recipients; duplicates are rejected', async () => {
    const { cookie } = await register(app);
    const j = await journey(cookie);
    const add = (email: string) =>
      req('POST', `/api/journeys/${j.id}/recipients`, cookie, { name: 'Driver Raju', email });

    const created = await add('raju@example.com');
    expect(created.statusCode).toBe(201);
    expect(created.json().recipient).toMatchObject({
      name: 'Driver Raju',
      email: 'raju@example.com',
      optedOut: false,
    });
    expect(created.body).not.toContain('optOutToken');
    expect((await add('RAJU@example.com')).statusCode).toBe(409);

    const list = (await req('GET', `/api/journeys/${j.id}/recipients`, cookie)).json().recipients;
    expect(list).toHaveLength(1);
    expect(
      (await req('DELETE', `/api/journeys/${j.id}/recipients/${list[0].id}`, cookie)).statusCode,
    ).toBe(204);
  });

  it("other users can't see or change them", async () => {
    const a = await register(app);
    const b = await register(app);
    const j = await journey(a.cookie);
    const r = (
      await req('POST', `/api/journeys/${j.id}/recipients`, a.cookie, {
        name: 'R',
        email: 'r@example.com',
      })
    ).json().recipient;
    expect((await req('GET', `/api/journeys/${j.id}/recipients`, b.cookie)).statusCode).toBe(404);
    expect(
      (
        await req('POST', `/api/journeys/${j.id}/recipients`, b.cookie, {
          name: 'X',
          email: 'x@example.com',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await req('DELETE', `/api/journeys/${j.id}/recipients/${r.id}`, b.cookie)).statusCode,
    ).toBe(404);
  });
});

describe('invite links (no sign-in)', () => {
  it('lets someone add themselves, shows only minimal journey info, and can be switched off', async () => {
    const { cookie } = await register(app);
    const j = await journey(cookie);
    const { inviteToken } = (await req('POST', `/api/journeys/${j.id}/invite`, cookie)).json();
    expect(inviteToken).toMatch(/^[\w-]{20,}$/);

    const info = (await req('GET', `/api/invites/${inviteToken}`)).json().invite;
    expect(info).toEqual({
      trainNumber: '12951',
      fromStationCode: 'MMCT',
      toStationCode: 'NDLS',
      journeyDate: istDate(),
      ownerFirstName: 'Test',
    });

    expect(
      (
        await req('POST', `/api/invites/${inviteToken}`, undefined, {
          name: 'Amma',
          email: 'amma@example.com',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await req('POST', `/api/invites/${inviteToken}`, undefined, {
          name: 'Amma',
          email: 'amma@example.com',
        })
      ).statusCode,
    ).toBe(409);
    const list = (await req('GET', `/api/journeys/${j.id}/recipients`, cookie)).json().recipients;
    expect(list.map((r: { email: string }) => r.email)).toEqual(['amma@example.com']);

    expect((await req('DELETE', `/api/journeys/${j.id}/invite`, cookie)).statusCode).toBe(204);
    expect((await req('GET', `/api/invites/${inviteToken}`)).statusCode).toBe(404);
    expect(
      (
        await req('POST', `/api/invites/${inviteToken}`, undefined, {
          name: 'X',
          email: 'x@example.com',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('rejects made-up tokens', async () => {
    expect((await req('GET', '/api/invites/aaaaaaaaaaaaaaaaaaaaaaaa')).statusCode).toBe(404);
    expect((await req('GET', '/api/invites/short')).statusCode).toBe(404);
  });
});

describe('opt-out links (no sign-in)', () => {
  it('shows what the alerts are for and stops them, idempotently', async () => {
    const { cookie } = await register(app);
    const j = await journey(cookie);
    await req('POST', `/api/journeys/${j.id}/recipients`, cookie, {
      name: 'Raju',
      email: 'raju@example.com',
    });
    // The token only ever travels in the recipient's emails.
    const { opt_out_token: token } = db.prepare('SELECT opt_out_token FROM recipients').get() as {
      opt_out_token: string;
    };

    const info = (await req('GET', `/api/opt-out/${token}`)).json().optOut;
    expect(info).toEqual({
      recipientName: 'Raju',
      trainNumber: '12951',
      fromStationCode: 'MMCT',
      toStationCode: 'NDLS',
      journeyDate: istDate(),
      optedOut: false,
    });
    expect((await req('POST', `/api/opt-out/${token}`)).json()).toEqual({ optedOut: true });
    expect((await req('POST', `/api/opt-out/${token}`)).statusCode).toBe(200);
    expect((await req('GET', `/api/opt-out/${token}`)).json().optOut.optedOut).toBe(true);

    const owner = (await req('GET', `/api/journeys/${j.id}/recipients`, cookie)).json().recipients;
    expect(owner[0].optedOut).toBe(true);
  });

  it('rejects unknown tokens', async () => {
    expect((await req('POST', '/api/opt-out/aaaaaaaaaaaaaaaaaaaaaaaa')).statusCode).toBe(404);
  });
});
