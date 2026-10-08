import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { APP_ORIGIN, makeApp, register } from './helpers.js';

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

/** Parses an SSE body into events. */
const events = (res: LightMyRequestResponse) =>
  res.body
    .split('\n\n')
    .filter(Boolean)
    .map((block) =>
      JSON.parse(
        block
          .split('\n')
          .find((l) => l.startsWith('data: '))!
          .slice(6),
      ),
    );

const chat = (payload: object, cookie?: string) =>
  app.inject({
    method: 'POST',
    url: '/api/chat',
    headers: { origin: APP_ORIGIN, ...(cookie ? { cookie } : {}) },
    payload,
  });

describe('POST /api/chat', () => {
  it('streams an offline answer as server-sent events when there is no API key', async () => {
    ({ app } = await makeApp());
    expect((await app.inject({ method: 'GET', url: '/api/chat/info' })).json()).toEqual({
      mode: 'offline',
      signedIn: false,
    });

    const res = await chat({ message: 'Is 12951 running late?' });
    expect(res.headers['content-type']).toContain('text/event-stream');
    const evs = events(res);
    expect(evs[0]).toEqual({ type: 'tool', name: 'get_live_status', status: 'start' });
    expect(
      evs
        .filter((e) => e.type === 'text')
        .map((e) => e.delta)
        .join(''),
    ).toContain('12951 Mumbai Rajdhani');
    expect(evs.at(-1)).toEqual({ type: 'done', sessionId: null, mode: 'offline' });
  });

  it('saves a signed-in conversation and restores it', async () => {
    ({ app } = await makeApp());
    const { cookie } = await register(app);
    const first = events(await chat({ message: 'hello' }, cookie));
    const sessionId = first.at(-1).sessionId;
    expect(sessionId).toBeTruthy();
    await chat({ message: 'what are quiet hours?', sessionId }, cookie);

    const history = (
      await app.inject({ method: 'GET', url: '/api/chat/history', headers: { cookie } })
    ).json();
    expect(history.sessionId).toBe(sessionId);
    expect(history.messages.map((m: { role: string }) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(history.messages[0].text).toBe('hello');
  });

  it("can't continue someone else's conversation", async () => {
    ({ app } = await makeApp());
    const a = await register(app);
    const b = await register(app);
    const aSession = events(await chat({ message: 'hello' }, a.cookie)).at(-1).sessionId;
    const bReply = events(await chat({ message: 'hello', sessionId: aSession }, b.cookie)).at(-1);
    expect(bReply.sessionId).not.toBe(aSession);
    const aHistory = (
      await app.inject({ method: 'GET', url: '/api/chat/history', headers: { cookie: a.cookie } })
    ).json();
    expect(aHistory.messages).toHaveLength(2);
  });

  it('rate-limits visitors per IP before streaming', async () => {
    ({ app } = await makeApp({ ASSISTANT_IP_HOURLY_LIMIT: '2' }));
    expect((await chat({ message: 'hi' })).statusCode).toBe(200);
    expect((await chat({ message: 'hi' })).statusCode).toBe(200);
    const limited = await chat({ message: 'hi' });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
  });

  it('validates the message', async () => {
    ({ app } = await makeApp());
    expect((await chat({ message: '   ' })).statusCode).toBe(400);
    expect((await chat({ message: 'x'.repeat(2001) })).statusCode).toBe(400);
  });
});

describe('proposals', () => {
  it('nothing happens until the owner confirms; then it runs once', async () => {
    ({ app } = await makeApp());
    const owner = await register(app);
    const other = await register(app);
    const evs = events(
      await chat({ message: 'Track 12301 from HWH to NDLS tomorrow' }, owner.cookie),
    );
    const proposal = evs.find((e) => e.type === 'proposal').proposal;

    const list = () =>
      app
        .inject({ method: 'GET', url: '/api/journeys', headers: { cookie: owner.cookie } })
        .then((r) => r.json().journeys);
    expect(await list()).toEqual([]);

    const confirm = (cookie: string) =>
      app.inject({
        method: 'POST',
        url: `/api/chat/proposals/${proposal.id}/confirm`,
        headers: { cookie, origin: APP_ORIGIN },
      });
    expect((await confirm(other.cookie)).statusCode).toBe(404);
    const ok = await confirm(owner.cookie);
    expect(ok.json()).toMatchObject({
      result: 'created',
      journey: { trainNumber: '12301', fromStationCode: 'HWH' },
    });
    expect(await list()).toHaveLength(1);
    expect((await confirm(owner.cookie)).statusCode).toBe(404);
  });

  it('can be cancelled', async () => {
    ({ app } = await makeApp());
    const { cookie } = await register(app);
    const proposal = events(
      await chat({ message: 'Track 12301 from HWH to NDLS tomorrow' }, cookie),
    ).find((e) => e.type === 'proposal').proposal;
    const cancel = await app.inject({
      method: 'POST',
      url: `/api/chat/proposals/${proposal.id}/cancel`,
      headers: { cookie, origin: APP_ORIGIN },
    });
    expect(cancel.statusCode).toBe(204);
    const confirm = await app.inject({
      method: 'POST',
      url: `/api/chat/proposals/${proposal.id}/confirm`,
      headers: { cookie, origin: APP_ORIGIN },
    });
    expect(confirm.statusCode).toBe(404);
  });
});
