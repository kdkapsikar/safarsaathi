import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { sessionPlugin } from './auth/sessions.js';
import type { Config } from './config.js';
import { createDataAccess, type DataAccess } from './data/index.js';
import type { Db } from './db/index.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { journeyRoutes } from './routes/journeys.js';
import { originCheck } from './security/origin.js';

declare module 'fastify' {
  interface FastifyInstance {
    data: DataAccess;
  }
}

export interface AppDeps {
  config: Config;
  db: Db;
}

export async function buildApp({ config, db }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.LOG_LEVEL }, bodyLimit: 64 * 1024 });
  const data = createDataAccess(db);
  app.decorate('data', data);

  app.setErrorHandler((err: FastifyError, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) request.log.error(err);
    const code =
      status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'INTERNAL' : (err.code ?? 'BAD_REQUEST');
    const message =
      status === 429
        ? 'Too many attempts. Please wait a minute and try again.'
        : status >= 500
          ? 'Something went wrong.'
          : err.message;
    return reply.code(status).send({ error: { code, message } });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } }),
  );

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(originCheck, { allowedOrigins: config.APP_ORIGINS });
  await app.register(sessionPlugin, { data, config });

  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api/auth', data, config });
  await app.register(journeyRoutes, { prefix: '/api/journeys' });

  return app;
}
