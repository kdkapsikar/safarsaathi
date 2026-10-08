import { describe, expect, it, vi } from 'vitest';
import { HttpProvider } from '../src/trains/http/HttpProvider.js';
import { MockProvider } from '../src/trains/mock/MockProvider.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function make(fetchImpl: typeof fetch) {
  return new HttpProvider({
    baseUrl: 'https://adapter.example/api',
    apiKey: 'test-key',
    apiKeyHeader: 'x-api-key',
    capabilities: ['liveStatus', 'schedule', 'platforms'],
    fetch: fetchImpl,
  });
}

describe('HttpProvider', () => {
  it('calls the documented path with the API key and accepts normalized data', async () => {
    const real = await new MockProvider().getLiveStatus('12951', '2026-10-09');
    const fetchMock = vi.fn(async () => json(real));
    const status = await make(fetchMock as unknown as typeof fetch).getLiveStatus(
      '12951',
      '2026-10-09',
    );

    expect(status).toEqual(real);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(
      'https://adapter.example/api/trains/12951/status?startDate=2026-10-09',
    );
    expect(init.headers).toEqual({ 'x-api-key': 'test-key' });
  });

  it('returns null for an unknown train', async () => {
    const p = make((async () => json({}, 404)) as unknown as typeof fetch);
    expect(await p.getLiveStatus('99999', '2026-10-09')).toBeNull();
  });

  it('rejects malformed data instead of passing it on', async () => {
    const p = make((async () =>
      json({ trainNumber: '12951', delay: 'lots' })) as unknown as typeof fetch);
    await expect(p.getLiveStatus('12951', '2026-10-09')).rejects.toMatchObject({
      kind: 'BAD_RESPONSE',
    });
  });

  it('treats 5xx, 429 and network errors as retryable', async () => {
    for (const f of [
      async () => json({}, 503),
      async () => json({}, 429),
      async () => {
        throw new TypeError('fetch failed');
      },
    ]) {
      await expect(make(f as unknown as typeof fetch).getSchedule('12951')).rejects.toMatchObject({
        kind: 'UNAVAILABLE',
        retryable: true,
      });
    }
  });

  it('reports only the configured capabilities', () => {
    expect(make(fetch).capabilities()).toEqual({
      liveStatus: true,
      schedule: true,
      platforms: true,
      coachPosition: false,
      trainsBetween: false,
    });
  });
});
