import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3001),
  API_HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** SQLite file path, relative to the repo root unless absolute. `:memory:` for tests. */
  DATABASE_PATH: z.string().default('data/safar-saathi.db'),

  /** Origins allowed to make state-changing requests (comma-separated). */
  APP_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://127.0.0.1:5173')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** Set to true when served over HTTPS. */
  COOKIE_SECURE: booleanString.default(false),

  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  NODE_ENV: z.string().default('development'),

  /** Train data source: the built-in simulator, or an HTTP source (see docs/data-source.md). */
  TRAIN_PROVIDER: z.enum(['mock', 'http']).default('mock'),
  TRAIN_API_BASE_URL: z.url().optional(),
  TRAIN_API_KEY: z.string().optional(),
  TRAIN_API_KEY_HEADER: z.string().default('x-api-key'),
  /** What the HTTP source can supply (comma-separated ProviderCapabilities keys). */
  TRAIN_API_CAPABILITIES: z
    .string()
    .default('liveStatus,schedule')
    .transform((s) =>
      s
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(['liveStatus', 'schedule', 'platforms', 'coachPosition']))),
  TRAIN_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  TRAIN_TIMEOUT_MS: z.coerce.number().int().positive().default(4000),
  TRAIN_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  TRAIN_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(5),
  TRAIN_BREAKER_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(30),
  /** Dev-only simulator controls. Defaults to on with the mock provider outside production. */
  ENABLE_SIMULATOR: booleanString.optional(),

  /** Alert engine: runs on this cron schedule inside the API process. */
  ENABLE_ALERT_ENGINE: booleanString.default(true),
  ALERT_ENGINE_CRON: z.string().default('* * * * *'),
  /** Email delivery. Only 'dry-run' (log what would be sent) exists so far; 'off' disables email. */
  EMAIL_MODE: z.enum(['dry-run', 'off']).default('dry-run'),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = envSchema.parse(env);
  if (config.TRAIN_PROVIDER === 'http' && !config.TRAIN_API_BASE_URL) {
    throw new Error('TRAIN_API_BASE_URL is required when TRAIN_PROVIDER=http');
  }
  return config;
}

export function simulatorEnabled(config: Config): boolean {
  return (
    config.TRAIN_PROVIDER === 'mock' &&
    (config.ENABLE_SIMULATOR ?? config.NODE_ENV !== 'production')
  );
}
