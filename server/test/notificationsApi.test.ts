import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../src/db/index.js';
import { APP_ORIGIN, makeApp, register } from './helpers.js';

let app: FastifyInstance;
let db: Db;
beforeEach(async () => {
  ({ app, db } = await makeApp());
});
afterEach(async () => {
  await app.close();
});

const addNotification = (userId: string, id: string) =>
  db
    .prepare(
      `INSERT INTO notifications (id, user_id, event_key, title, body, created_at) VALUES (?, ?, 'K', 'T', 'B', ?)`,
    )
    .run(id, userId, new Date().toISOString());

const userId = async (cookie: string) =>
  (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json().user
    .id as string;

describe('notifications API', () => {
  it('lists my notifications with an unread count and marks them read', async () => {
    const { cookie } = await register(app);
    const id = await userId(cookie);
    addNotification(id, '00000000-0000-4000-8000-000000000001');
    addNotification(id, '00000000-0000-4000-8000-000000000002');

    const list = (
      await app.inject({ method: 'GET', url: '/api/notifications', headers: { cookie } })
    ).json();
    expect(list.notifications).toHaveLength(2);
    expect(list.unreadCount).toBe(2);

    const read = await app.inject({
      method: 'POST',
      url: '/api/notifications/00000000-0000-4000-8000-000000000001/read',
      headers: { cookie, origin: APP_ORIGIN },
    });
    expect(read.statusCode).toBe(204);
    const all = await app.inject({
      method: 'POST',
      url: '/api/notifications/read-all',
      headers: { cookie, origin: APP_ORIGIN },
    });
    expect(all.json()).toEqual({ marked: 1 });
  });

  it("can't see or mark another user's notifications", async () => {
    const a = await register(app);
    const b = await register(app);
    addNotification(await userId(a.cookie), '00000000-0000-4000-8000-000000000003');

    const list = (
      await app.inject({ method: 'GET', url: '/api/notifications', headers: { cookie: b.cookie } })
    ).json();
    expect(list).toEqual({ notifications: [], unreadCount: 0 });
    const read = await app.inject({
      method: 'POST',
      url: '/api/notifications/00000000-0000-4000-8000-000000000003/read',
      headers: { cookie: b.cookie, origin: APP_ORIGIN },
    });
    expect(read.statusCode).toBe(404);
  });

  it('requires a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/notifications' })).statusCode).toBe(401);
  });
});

describe('simulator triggers the alert engine', () => {
  it('runs alerts after a change and on demand', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/simulator/run-alerts',
      headers: { origin: APP_ORIGIN },
    });
    expect(res.json().alertRun).toMatchObject({ journeysConsidered: 0, errors: [] });

    const changed = await app.inject({
      method: 'POST',
      url: '/api/simulator/clock',
      headers: { origin: APP_ORIGIN },
      payload: { action: 'advance', minutes: 15 },
    });
    const { alertRun, now } = changed.json();
    expect(Math.abs(Date.parse(alertRun.ranAt) - Date.parse(now))).toBeLessThan(1000);
  });
});
