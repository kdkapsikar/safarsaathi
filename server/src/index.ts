import { existsSync } from 'node:fs';
import { schedule } from 'node-cron';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';

// Optional root .env (git-ignored). Everything has a default, so it may be absent.
const envFile = new URL('../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig();
const db = openDatabase(config.DATABASE_PATH);
const app = await buildApp({ config, db });
app.addHook('onClose', async () => db.close());
if (config.ENABLE_ALERT_ENGINE) {
  const task = schedule(
    config.ALERT_ENGINE_CRON,
    () => {
      app.alerts.runOnce().catch((err: unknown) => app.log.error({ err }, 'Alert run failed'));
    },
    { noOverlap: true, name: 'alert-engine' },
  );
  app.addHook('onClose', async () => {
    await task.stop();
  });
}

try {
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
