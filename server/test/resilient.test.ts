import { describe, expect, it, vi } from 'vitest';
import { ResilientProvider } from '../src/trains/resilient.js';
import type { Clock } from '../src/trains/time.js';
import { ProviderError, type TrainDataProvider, type TrainStatus } from '../src/trains/types.js';

class FakeClock implements Clock {
  t = Date.parse('2026-10-09T10:00:00Z');
  now = () => new Date(this.t);
  tick(ms: number) {
    this.t += ms;
  }
}

const status = (n: number) => ({ trainNumber: '12951', delayMinutes: n }) as unknown as TrainStatus;

function fakeProvider(impl: () => Promise<TrainStatus | null>) {
  const getLiveStatus = vi.fn(impl);
  const provider: TrainDataProvider = {
    name: 'fake',
    capabilities: () => ({
      liveStatus: true,
      schedule: true,
      platforms: true,
      coachPosition: false,
      trainsBetween: false,
    }),
    getLiveStatus,
    getSchedule: async () => null,
  };
  return { provider, getLiveStatus };
}

const noSleep = async () => {};

describe('ResilientProvider', () => {
  it('many concurrent readers of the same train cost one upstream call', async () => {
    let resolve!: (s: TrainStatus) => void;
    const { provider, getLiveStatus } = fakeProvider(() => new Promise((r) => (resolve = r)));
    const p = new ResilientProvider(provider, {}, new FakeClock(), noSleep);

    const readers = Array.from({ length: 50 }, () => p.getLiveStatus('12951', '2026-10-09'));
    resolve(status(5));
    const results = await Promise.all(readers);

    expect(getLiveStatus).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r?.delayMinutes === 5)).toBe(true);
    expect(p.stats()).toMatchObject({ upstreamCalls: 1, coalesced: 49 });
  });

  it('serves from cache until the TTL expires, separately per train and date', async () => {
    const clock = new FakeClock();
    let n = 0;
    const { provider, getLiveStatus } = fakeProvider(async () => status(n++));
    const p = new ResilientProvider(provider, { statusTtlMs: 60_000 }, clock, noSleep);

    expect((await p.getLiveStatus('12951', '2026-10-09'))?.delayMinutes).toBe(0);
    clock.tick(59_000);
    expect((await p.getLiveStatus('12951', '2026-10-09'))?.delayMinutes).toBe(0);
    await p.getLiveStatus('12951', '2026-10-10');
    expect(getLiveStatus).toHaveBeenCalledTimes(2);

    clock.tick(2_000);
    expect((await p.getLiveStatus('12951', '2026-10-09'))?.delayMinutes).toBe(2);
    expect(p.stats().cacheHits).toBe(1);
  });

  it('invalidate() forces a fresh read', async () => {
    let n = 0;
    const { provider } = fakeProvider(async () => status(n++));
    const p = new ResilientProvider(provider, {}, new FakeClock(), noSleep);
    await p.getLiveStatus('12951', '2026-10-09');
    p.invalidate();
    expect((await p.getLiveStatus('12951', '2026-10-09'))?.delayMinutes).toBe(1);
  });

  it('retries transient failures, then succeeds', async () => {
    const { provider, getLiveStatus } = fakeProvider(async () => status(7));
    getLiveStatus
      .mockRejectedValueOnce(new ProviderError('UNAVAILABLE', 'blip'))
      .mockRejectedValueOnce(new Error('socket hang up'));
    const p = new ResilientProvider(provider, { retries: 2 }, new FakeClock(), noSleep);

    expect((await p.getLiveStatus('12951', '2026-10-09'))?.delayMinutes).toBe(7);
    expect(getLiveStatus).toHaveBeenCalledTimes(3);
  });

  it('does not retry bad responses', async () => {
    const { provider, getLiveStatus } = fakeProvider(async () => {
      throw new ProviderError('BAD_RESPONSE', 'garbage');
    });
    const p = new ResilientProvider(provider, { retries: 3 }, new FakeClock(), noSleep);
    await expect(p.getLiveStatus('12951', '2026-10-09')).rejects.toMatchObject({
      kind: 'BAD_RESPONSE',
    });
    expect(getLiveStatus).toHaveBeenCalledTimes(1);
  });

  it('times out a hung source', async () => {
    const { provider } = fakeProvider(() => new Promise(() => {}));
    const p = new ResilientProvider(
      provider,
      { timeoutMs: 20, retries: 0 },
      new FakeClock(),
      noSleep,
    );
    await expect(p.getLiveStatus('12951', '2026-10-09')).rejects.toMatchObject({ kind: 'TIMEOUT' });
  });

  it('opens the circuit after repeated failures, then recovers via a trial request', async () => {
    const clock = new FakeClock();
    let healthy = false;
    const { provider, getLiveStatus } = fakeProvider(async () => {
      if (!healthy) throw new ProviderError('UNAVAILABLE', 'down');
      return status(1);
    });
    const p = new ResilientProvider(
      provider,
      { retries: 0, breakerThreshold: 3, breakerCooldownMs: 30_000 },
      clock,
      noSleep,
    );

    for (let i = 0; i < 3; i++) await expect(p.getLiveStatus(`1000${i}`, 'd')).rejects.toThrow();
    expect(p.stats().breaker).toBe('OPEN');

    await expect(p.getLiveStatus('20000', 'd')).rejects.toMatchObject({ kind: 'CIRCUIT_OPEN' });
    expect(getLiveStatus).toHaveBeenCalledTimes(3);

    clock.tick(31_000);
    healthy = true;
    expect((await p.getLiveStatus('20000', 'd'))?.delayMinutes).toBe(1);
    expect(p.stats().breaker).toBe('CLOSED');
  });

  it('serves recent data (with its original fetchedAt) when the source fails', async () => {
    const clock = new FakeClock();
    let up = true;
    const { provider } = fakeProvider(async () => {
      if (!up) throw new ProviderError('UNAVAILABLE', 'down');
      return status(12);
    });
    const p = new ResilientProvider(
      provider,
      { statusTtlMs: 60_000, maxStaleMs: 10 * 60_000, retries: 0 },
      clock,
      noSleep,
    );

    await p.getLiveStatus('12951', 'd');
    up = false;
    clock.tick(5 * 60_000);
    expect((await p.getLiveStatus('12951', 'd'))?.delayMinutes).toBe(12);
    expect(p.stats().staleServed).toBe(1);

    clock.tick(10 * 60_000);
    await expect(p.getLiveStatus('12951', 'd')).rejects.toBeInstanceOf(ProviderError);
  });
});
