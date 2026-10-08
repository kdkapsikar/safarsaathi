/**
 * Normalized train data. Every provider (mock, HTTP vendor adapter, future
 * vendors) returns these shapes, so routes, the alert engine and the assistant
 * never see vendor-specific formats. Times are ISO-8601 UTC strings.
 */

export interface ProviderCapabilities {
  liveStatus: boolean;
  schedule: boolean;
  /** Platform numbers per station. */
  platforms: boolean;
  /** Coach position / composition on the platform. */
  coachPosition: boolean;
  /** Search trains between two stations. */
  trainsBetween: boolean;
}

export interface ScheduledStop {
  code: string;
  name: string;
  /** "HH:MM" IST, null at the origin. */
  arrival: string | null;
  /** "HH:MM" IST, null at the destination. */
  departure: string | null;
  /** 1 = the day the train starts. */
  day: number;
  distanceKm: number;
}

export interface TrainSchedule {
  trainNumber: string;
  trainName: string;
  stops: ScheduledStop[];
}

export type StopState = 'UPCOMING' | 'ARRIVED' | 'DEPARTED' | 'SKIPPED';

export interface StationStatus {
  code: string;
  name: string;
  scheduledArrival: string | null;
  scheduledDeparture: string | null;
  /** Actual time if it has happened, otherwise the current estimate. */
  expectedArrival: string | null;
  expectedDeparture: string | null;
  delayMinutes: number;
  platform: string | null;
  state: StopState;
}

export type TrainState = 'NOT_STARTED' | 'RUNNING' | 'ARRIVED' | 'CANCELLED';

export interface TrainStatus {
  trainNumber: string;
  trainName: string;
  /** The date the train starts from its origin (YYYY-MM-DD, IST). */
  startDate: string;
  state: TrainState;
  /** Last station reached, if any. */
  currentStation: { code: string; name: string } | null;
  /** Current delay in minutes (0 = on time). */
  delayMinutes: number;
  cancelled: boolean;
  diverted: boolean;
  /** Human-readable note from the source, e.g. the diversion route. */
  note: string | null;
  stations: StationStatus[];
  /** When this data was fetched from the source. Always shown to users as "as of". */
  fetchedAt: string;
  /** Which provider produced it. */
  source: string;
}

export interface TrainSummary {
  trainNumber: string;
  trainName: string;
  from: { code: string; departure: string };
  to: { code: string; arrival: string };
}

export interface TrainDataProvider {
  readonly name: string;
  capabilities(): ProviderCapabilities;
  /** null if the source doesn't know this train on this date. */
  getLiveStatus(trainNumber: string, startDate: string): Promise<TrainStatus | null>;
  /** null if the source doesn't know this train. */
  getSchedule(trainNumber: string): Promise<TrainSchedule | null>;
  /** Only when capabilities().trainsBetween is true. */
  trainsBetween?(fromCode: string, toCode: string, date: string): Promise<TrainSummary[]>;
}

export type ProviderErrorKind = 'TIMEOUT' | 'UNAVAILABLE' | 'BAD_RESPONSE' | 'CIRCUIT_OPEN';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  get retryable(): boolean {
    return this.kind === 'TIMEOUT' || this.kind === 'UNAVAILABLE';
  }
}
