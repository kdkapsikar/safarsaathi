import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { openDatabase, type Db } from '../src/db/index.js';

export const APP_ORIGIN = 'http://localhost:5173';

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({ LOG_LEVEL: 'silent', DATABASE_PATH: ':memory:', ...env });
}

export async function makeApp(
  env: Record<string, string> = {},
): Promise<{ app: FastifyInstance; db: Db }> {
  const config = testConfig(env);
  const db = openDatabase(config.DATABASE_PATH);
  const app = await buildApp({ config, db });
  app.addHook('onClose', async () => db.close());
  return { app, db };
}

/** "name=value" for the session cookie in a response, for sending back. */
export function sessionCookie(res: LightMyRequestResponse): string {
  const c = res.cookies.find((c) => c.name === 'ss_session');
  if (!c) throw new Error(`No session cookie in response (status ${res.statusCode})`);
  return `${c.name}=${c.value}`;
}

let counter = 0;
export function newUserInput(
  overrides: Partial<{ name: string; email: string; password: string }> = {},
) {
  counter += 1;
  return {
    name: `Test User ${counter}`,
    email: `user${counter}@example.com`,
    password: 'correct horse battery',
    ...overrides,
  };
}

export async function register(app: FastifyInstance, body = newUserInput()) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: { origin: APP_ORIGIN },
    payload: body,
  });
  return { res, body, cookie: res.statusCode === 201 ? sessionCookie(res) : '' };
}
