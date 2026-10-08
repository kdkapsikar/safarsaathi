import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { healthRoutes } from './routes/health.js';

export async function buildApp(config: Pick<Config, 'LOG_LEVEL'>): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

  await app.register(healthRoutes, { prefix: '/api' });

  return app;
}
