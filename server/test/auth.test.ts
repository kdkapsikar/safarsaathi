import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { APP_ORIGIN, makeApp, newUserInput, register, sessionCookie } from './helpers.js';
import type { Db } from '../src/db/index.js';

let app: FastifyInstance;
let db: Db;

beforeEach(async () => {
  ({ app, db } = await makeApp());
});
afterEach(async () => {
  await app.close();
});

const post = (url: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload, headers: { origin: APP_ORIGIN, ...headers } });
const me = (cookie?: string) =>
  app.inject({ method: 'GET', url: '/api/auth/me', headers: cookie ? { cookie } : {} });

describe('register', () => {
  it('creates the user, starts a session and never returns the password hash', async () => {
    const { res, body } = await register(app);

    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ name: body.name, email: body.email });
    expect(res.body).not.toContain('argon2');
    expect(res.body).not.toContain(body.password);

    const stored = db
      .prepare('SELECT password_hash FROM users WHERE email = ?')
      .get(body.email) as {
      password_hash: string;
    };
    expect(stored.password_hash).toMatch(/^\$argon2id\$/);
  });

  it('sets an HTTP-only, SameSite=Lax session cookie', async () => {
    const { res } = await register(app);
    const cookie = res.cookies.find((c) => c.name === 'ss_session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(cookie?.value.length).toBeGreaterThanOrEqual(40);
  });

  it('stores only a hash of the session token', async () => {
    const { res } = await register(app);
    const token = res.cookies.find((c) => c.name === 'ss_session')!.value;
    const ids = db.prepare('SELECT id FROM sessions').all() as { id: string }[];
    expect(ids).toHaveLength(1);
    expect(ids[0]!.id).not.toBe(token);
  });

  it('normalises email and rejects duplicates case-insensitively', async () => {
    await register(app, newUserInput({ email: 'Asha@Example.com' }));
    const { res } = await register(app, newUserInput({ email: '  asha@example.COM ' }));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_TAKEN');
  });

  it.each([
    [{ name: '', email: 'a@example.com', password: 'longenough' }, 'name'],
    [{ name: 'A', email: 'not-an-email', password: 'longenough' }, 'email'],
    [{ name: 'A', email: 'a@example.com', password: 'short' }, 'password'],
  ])('rejects invalid input %#', async (payload, field) => {
    const res = await post('/api/auth/register', payload);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields).toHaveProperty(field);
  });

  it('rejects non-JSON bodies (blocks HTML form posts)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { origin: APP_ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'name=A&email=a%40example.com&password=longenough',
    });
    expect(res.statusCode).toBe(415);
  });
});

describe('login, me and logout', () => {
  it('signs in with the right password and the session persists across requests', async () => {
    const { body } = await register(app);
    const res = await post('/api/auth/login', { email: body.email, password: body.password });
    expect(res.statusCode).toBe(200);
    const cookie = sessionCookie(res);

    for (let i = 0; i < 3; i++) {
      const r = await me(cookie);
      expect(r.statusCode).toBe(200);
      expect(r.json().user.email).toBe(body.email);
    }
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const { body } = await register(app);
    const wrong = await post('/api/auth/login', { email: body.email, password: 'nope-nope' });
    const unknown = await post('/api/auth/login', {
      email: 'nobody@example.com',
      password: 'nope-nope',
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('signs in with a plain username, case-insensitively', async () => {
    const { body } = await register(app);
    db.prepare('UPDATE users SET email = ? WHERE email = ?').run('demo', body.email);
    const res = await post('/api/auth/login', { email: ' Demo ', password: body.password });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('demo');
  });

  it('me is 401 without a session or with a bogus cookie', async () => {
    expect((await me()).statusCode).toBe(401);
    expect((await me('ss_session=forged')).statusCode).toBe(401);
  });

  it('logout ends the session server-side, not just the cookie', async () => {
    const { cookie } = await register(app);
    const res = await post('/api/auth/logout', undefined, { cookie });
    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((c) => c.name === 'ss_session')?.value).toBe('');

    // Replaying the old cookie no longer works.
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('expired sessions are rejected', async () => {
    const { cookie } = await register(app);
    db.prepare('UPDATE sessions SET expires_at = ?').run('2000-01-01T00:00:00.000Z');
    expect((await me(cookie)).statusCode).toBe(401);
  });
});

describe('rate limiting', () => {
  it('limits login attempts per IP', async () => {
    const limited = await makeApp({ AUTH_RATE_LIMIT_MAX: '3' });
    try {
      const attempt = () =>
        limited.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { origin: APP_ORIGIN },
          payload: { email: 'x@example.com', password: 'whatever' },
        });
      for (let i = 0; i < 3; i++) expect((await attempt()).statusCode).toBe(401);
      const blocked = await attempt();
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.app.close();
    }
  });
});

describe('CSRF origin check', () => {
  it('blocks state-changing requests from a foreign Origin', async () => {
    const { cookie } = await register(app);
    const res = await post('/api/auth/logout', undefined, {
      cookie,
      origin: 'https://evil.example',
    });
    expect(res.statusCode).toBe(403);
    expect((await me(cookie)).statusCode).toBe(200);
  });

  it('blocks requests the browser marks as cross-site', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'sec-fetch-site': 'cross-site' },
      payload: { email: 'a@example.com', password: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows same-origin requests and safe methods', async () => {
    const { cookie } = await register(app);
    const get = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie, origin: 'https://evil.example' },
    });
    expect(get.statusCode).toBe(200);
  });
});
