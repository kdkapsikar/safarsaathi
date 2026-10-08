import { existsSync } from 'node:fs';
import { loadConfig } from './config.js';
import { createDataAccess } from './data/index.js';
import { openDatabase } from './db/index.js';
import { DEMO_ACCOUNT, seedDemo } from './db/seed.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data with NODE_ENV=production.');
  process.exit(1);
}

const envFile = new URL('../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig();
const db = openDatabase(config.DATABASE_PATH);
const count = await seedDemo(createDataAccess(db));
db.close();

console.log(
  `Demo account ready: ${DEMO_ACCOUNT.email} with ${count} sample journeys.\n` +
    'Password: see DEMO_ACCOUNT in server/src/db/seed.ts.',
);
