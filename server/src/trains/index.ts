import type { Config } from '../config.js';
import { HttpProvider } from './http/HttpProvider.js';
import { MockProvider } from './mock/MockProvider.js';
import { ResilientProvider } from './resilient.js';

export interface TrainServices {
  /** What everything else in the app uses. */
  provider: ResilientProvider;
  /** Present only when the simulator is the data source. */
  simulator: MockProvider | null;
}

export function createTrainServices(config: Config): TrainServices {
  const resilience = {
    statusTtlMs: config.TRAIN_CACHE_TTL_SECONDS * 1000,
    timeoutMs: config.TRAIN_TIMEOUT_MS,
    retries: config.TRAIN_RETRIES,
    breakerThreshold: config.TRAIN_BREAKER_THRESHOLD,
    breakerCooldownMs: config.TRAIN_BREAKER_COOLDOWN_SECONDS * 1000,
  };

  if (config.TRAIN_PROVIDER === 'http') {
    const http = new HttpProvider({
      baseUrl: config.TRAIN_API_BASE_URL!,
      apiKey: config.TRAIN_API_KEY,
      apiKeyHeader: config.TRAIN_API_KEY_HEADER,
      capabilities: config.TRAIN_API_CAPABILITIES,
    });
    return { provider: new ResilientProvider(http, resilience), simulator: null };
  }

  const simulator = new MockProvider();
  return { provider: new ResilientProvider(simulator, resilience), simulator };
}

export * from './types.js';
export { ResilientProvider } from './resilient.js';
export { MockProvider, SimClock } from './mock/MockProvider.js';
