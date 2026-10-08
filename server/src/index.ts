import { existsSync } from 'node:fs';
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
