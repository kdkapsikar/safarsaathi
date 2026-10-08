import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { sessionPlugin } from './auth/sessions.js';
import { simulatorEnabled, type Config } from './config.js';
import { AlertEngine } from './alerts/engine.js';
import { AssistantService } from './assistant/service.js';
import './assistant/siteHelpFile.js';
import type { AssistantEngine } from './assistant/types.js';
import { DryRunEmailChannel, InAppChannel } from './alerts/channels.js';
import { createDataAccess, type DataAccess } from './data/index.js';
import { createEngineStore } from './data/engineStore.js';
import type { Db } from './db/index.js';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { healthRoutes } from './routes/health.js';
import { journeyRoutes } from './routes/journeys.js';
import { notificationRoutes } from './routes/notifications.js';
import { publicLinkRoutes } from './routes/publicLinks.js';
import { simulatorRoutes } from './routes/simulator.js';
import { trainRoutes } from './routes/trains.js';
import { originCheck } from './security/origin.js';
import { createTrainServices, type TrainServices } from './trains/index.js';
import { systemClock } from './trains/time.js';

declare module 'fastify' {
  interface FastifyInstance {
    data: DataAccess;
    trains: TrainServices;
    alerts: AlertEngine;
    assistant: AssistantService;
  }
}

export interface AppDeps {
  config: Config;
  db: Db;
  /** Override for tests; built from config otherwise. */
  trains?: TrainServices;
  /** Override for tests (e.g. Claude with a mocked client). */
  assistantEngine?: AssistantEngine;
}

export async function buildApp({
  config,
  db,
  trains: trainsOverride,
  assistantEngine,
}: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.LOG_LEVEL }, bodyLimit: 64 * 1024 });
  const data = createDataAccess(db);
  app.decorate('data', data);
  const trains = trainsOverride ?? createTrainServices(config);
  app.decorate('trains', trains);

  const engineStore = createEngineStore(db);
  const alerts = new AlertEngine({
    store: engineStore,
    provider: trains.provider,
    clock: trains.simulator?.clock ?? systemClock,
    inApp: new InAppChannel(engineStore),
    email: config.EMAIL_MODE === 'dry-run' ? new DryRunEmailChannel(app.log) : null,
    log: app.log,
    appUrl: config.PUBLIC_APP_URL,
  });
  app.decorate('alerts', alerts);

  const clock = trains.simulator?.clock ?? systemClock;
  const assistant = new AssistantService({
    config,
    data,
    provider: trains.provider,
    clock,
    engine: assistantEngine,
  });
  app.decorate('assistant', assistant);

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
  await app.register(notificationRoutes, { prefix: '/api/notifications' });
  await app.register(publicLinkRoutes, { prefix: '/api' });
  await app.register(chatRoutes, { prefix: '/api/chat', assistant, clock });
  await app.register(trainRoutes, { prefix: '/api/trains', trains });
  if (trains.simulator && simulatorEnabled(config)) {
    await app.register(simulatorRoutes, {
      prefix: '/api/simulator',
      simulator: trains.simulator,
      provider: trains.provider,
      alerts,
    });
  }

  return app;
}
