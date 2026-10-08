import { z } from 'zod';
import {
  ProviderError,
  type ProviderCapabilities,
  type TrainDataProvider,
  type TrainSchedule,
  type TrainStatus,
} from '../types.js';

/**
 * Stub for a real data source. It doesn't speak any vendor's API directly:
 * it expects a small adapter service (or a vendor that matches docs/data-source.md)
 * that returns Safar Saathi's normalized JSON:
 *
 *   GET {base}/trains/{trainNumber}/status?startDate=YYYY-MM-DD  -> TrainStatus | 404
 *   GET {base}/trains/{trainNumber}/schedule                     -> TrainSchedule | 404
 *
 * Responses are validated; anything malformed is a BAD_RESPONSE, never passed on.
 */
export interface HttpProviderOptions {
  baseUrl: string;
  apiKey?: string;
  apiKeyHeader: string;
  capabilities: (keyof ProviderCapabilities)[];
  fetch?: typeof fetch;
}

const iso = z.iso.datetime({ offset: true });
const stationStatus = z.object({
  code: z.string(),
  name: z.string(),
  scheduledArrival: iso.nullable(),
  scheduledDeparture: iso.nullable(),
  expectedArrival: iso.nullable(),
  expectedDeparture: iso.nullable(),
  delayMinutes: z.number().int(),
  platform: z.string().nullable(),
  state: z.enum(['UPCOMING', 'ARRIVED', 'DEPARTED', 'SKIPPED']),
});
export const trainStatusSchema = z.object({
  trainNumber: z.string(),
  trainName: z.string(),
  startDate: z.iso.date(),
  state: z.enum(['NOT_STARTED', 'RUNNING', 'ARRIVED', 'CANCELLED']),
  currentStation: z.object({ code: z.string(), name: z.string() }).nullable(),
  delayMinutes: z.number().int(),
  cancelled: z.boolean(),
  diverted: z.boolean(),
  note: z.string().nullable(),
  stations: z.array(stationStatus),
  fetchedAt: iso,
  source: z.string(),
});
export const trainScheduleSchema = z.object({
  trainNumber: z.string(),
  trainName: z.string(),
  stops: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      arrival: z.string().nullable(),
      departure: z.string().nullable(),
      day: z.number().int().positive(),
      distanceKm: z.number(),
    }),
  ),
});

export class HttpProvider implements TrainDataProvider {
  readonly name = 'http';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: HttpProviderOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  capabilities(): ProviderCapabilities {
    const has = (c: keyof ProviderCapabilities) => this.opts.capabilities.includes(c);
    return {
      liveStatus: has('liveStatus'),
      schedule: has('schedule'),
      platforms: has('platforms'),
      coachPosition: has('coachPosition'),
      trainsBetween: false,
    };
  }

  async getLiveStatus(trainNumber: string, startDate: string): Promise<TrainStatus | null> {
    const path = `/trains/${encodeURIComponent(trainNumber)}/status?startDate=${encodeURIComponent(startDate)}`;
    return this.get(path, trainStatusSchema) as Promise<TrainStatus | null>;
  }

  async getSchedule(trainNumber: string): Promise<TrainSchedule | null> {
    return this.get(`/trains/${encodeURIComponent(trainNumber)}/schedule`, trainScheduleSchema);
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    let res: Response;
    try {
      res = await this.fetchImpl(new URL(path.replace(/^\//, ''), withSlash(this.opts.baseUrl)), {
        headers: this.opts.apiKey ? { [this.opts.apiKeyHeader]: this.opts.apiKey } : {},
      });
    } catch (err) {
      throw new ProviderError(
        'UNAVAILABLE',
        `Train data request failed: ${(err as Error).message}`,
      );
    }
    if (res.status === 404) return null;
    if (res.status >= 500 || res.status === 429) {
      throw new ProviderError('UNAVAILABLE', `Train data source returned HTTP ${res.status}.`);
    }
    if (!res.ok)
      throw new ProviderError('BAD_RESPONSE', `Train data source returned HTTP ${res.status}.`);

    const parsed = schema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) {
      throw new ProviderError(
        'BAD_RESPONSE',
        'Train data source sent data in an unexpected format.',
      );
    }
    return parsed.data;
  }
}

const withSlash = (url: string) => (url.endsWith('/') ? url : `${url}/`);
