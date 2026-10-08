import type { StationStatus, TrainStatus } from '../lib/api';

const stop = (
  code: string,
  name: string,
  overrides: Partial<StationStatus> = {},
): StationStatus => ({
  code,
  name,
  scheduledArrival: null,
  scheduledDeparture: '2026-10-09T11:30:00.000Z',
  expectedArrival: null,
  expectedDeparture: '2026-10-09T11:30:00.000Z',
  delayMinutes: 0,
  platform: null,
  state: 'UPCOMING',
  ...overrides,
});

/** 12951 MMCT (dep 17:00 IST) -> BRC -> NDLS. */
export const trainStatus = (overrides: Partial<TrainStatus> = {}): TrainStatus => ({
  trainNumber: '12951',
  trainName: 'Mumbai Rajdhani',
  startDate: '2026-10-09',
  state: 'NOT_STARTED',
  currentStation: null,
  delayMinutes: 0,
  cancelled: false,
  diverted: false,
  note: null,
  stations: [
    stop('MMCT', 'Mumbai Central', { platform: '4' }),
    stop('BRC', 'Vadodara Junction', {
      scheduledArrival: '2026-10-09T15:36:00.000Z',
      expectedArrival: '2026-10-09T15:36:00.000Z',
      scheduledDeparture: '2026-10-09T15:46:00.000Z',
      expectedDeparture: '2026-10-09T15:46:00.000Z',
    }),
    stop('NDLS', 'New Delhi', {
      scheduledArrival: '2026-10-10T03:02:00.000Z',
      expectedArrival: '2026-10-10T03:02:00.000Z',
      scheduledDeparture: null,
      expectedDeparture: null,
    }),
  ],
  fetchedAt: '2026-10-09T10:12:00.000Z',
  source: 'simulator',
  ...overrides,
});
