import { systemClock, type Clock } from './time.js';
import {
  ProviderError,
  type ProviderCapabilities,
  type TrainDataProvider,
  type TrainSchedule,
  type TrainStatus,
  type TrainSummary,
} from './types.js';

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Stops calling a failing source for `cooldownMs` after `threshold` consecutive
 * failures, then lets a single trial request through (HALF_OPEN).
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private trialInFlight = false;
  state: BreakerState = 'CLOSED';

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
    private readonly clock: Clock = systemClock,
  ) {}

  /** Whether a request may go upstream now. */
  tryAcquire(): boolean {
    if (this.state === 'OPEN') {
      if (this.clock.now().getTime() - this.openedAt < this.cooldownMs) return false;
      this.state = 'HALF_OPEN';
    }
    if (this.state === 'HALF_OPEN') {
      if (this.trialInFlight) return false;
      this.trialInFlight = true;
    }
    return true;
  }

  onSuccess(): void {
    this.failures = 0;
    this.trialInFlight = false;
    this.state = 'CLOSED';
  }

  onFailure(): void {
    this.trialInFlight = false;
    this.failures += 1;
    if (this.state === 'HALF_OPEN' || this.failures >= this.threshold) {
      this.state = 'OPEN';
      this.openedAt = this.clock.now().getTime();
    }
  }
}

export interface ResilienceOptions {
  statusTtlMs: number;
  scheduleTtlMs: number;
  /** Serve cached data up to this old if the source fails. */
  maxStaleMs: number;
  timeoutMs: number;
  retries: number;
  retryBaseMs: number;
  breakerThreshold: number;
  breakerCooldownMs: number;
}

export const DEFAULT_RESILIENCE: ResilienceOptions = {
  statusTtlMs: 60_000,
  scheduleTtlMs: 6 * 60 * 60_000,
  maxStaleMs: 10 * 60_000,
  timeoutMs: 4_000,
  retries: 2,
  retryBaseMs: 250,
  breakerThreshold: 5,
  breakerCooldownMs: 30_000,
};

export interface ProviderStats {
  upstreamCalls: number;
  cacheHits: number;
  /** Requests that joined an identical request already in flight. */
  coalesced: number;
  staleServed: number;
  failures: number;
  breaker: BreakerState;
}

interface Entry {
  value: unknown;
  storedAt: number;
  expiresAt: number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Wraps any TrainDataProvider so that many users watching the same train cost
 * one upstream call, slow or failing sources can't hang requests, and an outage
 * degrades to slightly old data (with its original fetchedAt) instead of errors.
 */
export class ResilientProvider implements TrainDataProvider {
  readonly breaker: CircuitBreaker;
  private readonly opts: ResilienceOptions;
  private readonly cache = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly counters = {
    upstreamCalls: 0,
    cacheHits: 0,
    coalesced: 0,
    staleServed: 0,
    failures: 0,
  };

  constructor(
    readonly inner: TrainDataProvider,
    opts: Partial<ResilienceOptions> = {},
    private readonly clock: Clock = systemClock,
    private readonly sleep: (ms: number) => Promise<void> = realSleep,
  ) {
    this.opts = { ...DEFAULT_RESILIENCE, ...opts };
    this.breaker = new CircuitBreaker(
      this.opts.breakerThreshold,
      this.opts.breakerCooldownMs,
      clock,
    );
  }

  get name(): string {
    return this.inner.name;
  }

  capabilities(): ProviderCapabilities {
    return this.inner.capabilities();
  }

  getLiveStatus(trainNumber: string, startDate: string): Promise<TrainStatus | null> {
    return this.cached(`status:${trainNumber}:${startDate}`, this.opts.statusTtlMs, () =>
      this.inner.getLiveStatus(trainNumber, startDate),
    );
  }

  getSchedule(trainNumber: string): Promise<TrainSchedule | null> {
    return this.cached(`schedule:${trainNumber}`, this.opts.scheduleTtlMs, () =>
      this.inner.getSchedule(trainNumber),
    );
  }

  trainsBetween(fromCode: string, toCode: string, date: string): Promise<TrainSummary[]> {
    const inner = this.inner;
    if (!inner.trainsBetween || !inner.capabilities().trainsBetween) {
      return Promise.reject(new ProviderError('UNAVAILABLE', 'Train search is not supported.'));
    }
    return this.cached(`between:${fromCode}:${toCode}:${date}`, this.opts.scheduleTtlMs, () =>
      inner.trainsBetween!(fromCode, toCode, date),
    );
  }

  /** Drops cached data (all of it, or keys starting with `prefix`). */
  invalidate(prefix = ''): void {
    for (const key of this.cache.keys()) if (key.startsWith(prefix)) this.cache.delete(key);
  }

  stats(): ProviderStats {
    return { ...this.counters, breaker: this.breaker.state };
  }

  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const now = this.clock.now().getTime();
    const entry = this.cache.get(key);
    if (entry && entry.expiresAt > now) {
      this.counters.cacheHits += 1;
      return entry.value as T;
    }

    const pending = this.inflight.get(key);
    if (pending) {
      this.counters.coalesced += 1;
      return pending as Promise<T>;
    }

    const request = this.callUpstream(load)
      .then((value) => {
        const at = this.clock.now().getTime();
        this.cache.set(key, { value, storedAt: at, expiresAt: at + ttlMs });
        return value;
      })
      .catch((err: unknown) => {
        const stale = this.cache.get(key);
        if (stale && this.clock.now().getTime() - stale.storedAt <= this.opts.maxStaleMs) {
          this.counters.staleServed += 1;
          return stale.value as T;
        }
        throw err;
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, request);
    return request;
  }

  private async callUpstream<T>(load: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      if (!this.breaker.tryAcquire()) {
        throw new ProviderError('CIRCUIT_OPEN', 'Train data source is temporarily unavailable.');
      }
      this.counters.upstreamCalls += 1;
      try {
        const value = await this.withTimeout(load());
        this.breaker.onSuccess();
        return value;
      } catch (raw) {
        this.counters.failures += 1;
        this.breaker.onFailure();
        const err =
          raw instanceof ProviderError
            ? raw
            : new ProviderError('UNAVAILABLE', raw instanceof Error ? raw.message : String(raw));
        if (!err.retryable || attempt >= this.opts.retries) throw err;
        const backoff = this.opts.retryBaseMs * 2 ** attempt;
        await this.sleep(backoff / 2 + Math.random() * (backoff / 2));
      }
    }
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new ProviderError('TIMEOUT', 'Train data source timed out.')),
        this.opts.timeoutMs,
      );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }
}
