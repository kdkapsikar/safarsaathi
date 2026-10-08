import { addMinutes, istInstant, minutesBetween } from '../time.js';
import type { StationStatus, TrainSchedule, TrainState, TrainStatus } from '../types.js';

export const SCENARIOS = {
  ON_TIME: { label: 'On time', description: 'Runs exactly to schedule.' },
  GROWING_DELAY: {
    label: 'Growing delay',
    description: 'Leaves on time, then loses about 18 minutes an hour (up to 2½ hours).',
  },
  PLATFORM_CHANGE: {
    label: 'Platform change',
    description: 'Platforms are announced 3 hours ahead, then changed 30 minutes before arrival.',
  },
  CANCELLED: {
    label: 'Cancelled',
    description: 'Cancellation is announced 4 hours before departure.',
  },
  DIVERTED: {
    label: 'Diverted',
    description:
      'Announced 1 hour before departure: skips a mid-route stop and runs late after it.',
  },
} as const;

export type ScenarioId = keyof typeof SCENARIOS;
export const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];

const PLATFORM_NOTICE_MIN = 180;
const PLATFORM_CHANGE_MIN = 30;
const CANCEL_NOTICE_MIN = 240;
const DIVERSION_NOTICE_MIN = 60;

/** Stable small hash, so the same train and station always get the same platform. */
function basePlatform(trainNumber: string, code: string): number {
  let h = 0;
  for (const ch of trainNumber + code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 6) + 1;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Computes the live status of `schedule` started on `startDate`, as it would be
 * at `now`, under `scenario`. Pure and deterministic, so tests and the simulator
 * can step through a journey minute by minute.
 */
export function simulateStatus(
  schedule: TrainSchedule,
  startDate: string,
  scenario: ScenarioId,
  now: Date,
): TrainStatus {
  const stops = schedule.stops.map((s) => ({
    ...s,
    schedArr: s.arrival ? istInstant(startDate, s.arrival, s.day) : null,
    schedDep: s.departure ? istInstant(startDate, s.departure, s.day) : null,
  }));
  const originDep = stops[0]!.schedDep!;
  const minsToDeparture = minutesBetween(now, originDep);

  const cancelled = scenario === 'CANCELLED' && minsToDeparture <= CANCEL_NOTICE_MIN;
  const diverted = scenario === 'DIVERTED' && minsToDeparture <= DIVERSION_NOTICE_MIN;
  const skippedIndex = diverted ? Math.floor(stops.length / 2) : -1;
  const skippedAt = skippedIndex >= 0 ? stops[skippedIndex]!.schedArr! : null;

  const delayAt = (t: Date): number => {
    if (scenario === 'GROWING_DELAY') {
      return clamp(Math.round((minutesBetween(originDep, t) - 20) * 0.3), 0, 150);
    }
    if (diverted && skippedAt && t > skippedAt) {
      return clamp(Math.round(minutesBetween(skippedAt, t) * 0.5), 0, 45);
    }
    return 0;
  };
  const currentDelay = cancelled ? 0 : delayAt(now);

  const stations: StationStatus[] = stops.map((s, i) => {
    const ref = (s.schedArr ?? s.schedDep)!;
    const pastDelay = delayAt(ref);
    const passed = !cancelled && addMinutes(ref, pastDelay) <= now;
    const delay = cancelled ? 0 : passed ? pastDelay : currentDelay;

    const expectedArrival = s.schedArr ? addMinutes(s.schedArr, delay) : null;
    const expectedDeparture = s.schedDep ? addMinutes(s.schedDep, delay) : null;
    const expectedRef = (expectedArrival ?? expectedDeparture)!;

    let state: StationStatus['state'] = 'UPCOMING';
    if (i === skippedIndex) state = 'SKIPPED';
    else if (!cancelled && expectedDeparture && now >= expectedDeparture) state = 'DEPARTED';
    else if (!cancelled && expectedArrival && now >= expectedArrival) state = 'ARRIVED';

    let platform: string | null = null;
    const minsToStop = minutesBetween(now, expectedRef);
    if (!cancelled && state !== 'SKIPPED' && minsToStop <= PLATFORM_NOTICE_MIN) {
      const base = basePlatform(schedule.trainNumber, s.code);
      const changed = scenario === 'PLATFORM_CHANGE' && minsToStop <= PLATFORM_CHANGE_MIN;
      platform = String(changed ? ((base + 2) % 6) + 1 : base);
    }

    return {
      code: s.code,
      name: s.name,
      scheduledArrival: s.schedArr?.toISOString() ?? null,
      scheduledDeparture: s.schedDep?.toISOString() ?? null,
      expectedArrival: expectedArrival?.toISOString() ?? null,
      expectedDeparture: expectedDeparture?.toISOString() ?? null,
      delayMinutes: delay,
      platform,
      state,
    };
  });

  const reached = stations.filter((s) => s.state === 'ARRIVED' || s.state === 'DEPARTED');
  const last = stations[stations.length - 1]!;
  let state: TrainState = 'RUNNING';
  if (cancelled) state = 'CANCELLED';
  else if (stations[0]!.state === 'UPCOMING') state = 'NOT_STARTED';
  else if (last.state === 'ARRIVED') state = 'ARRIVED';

  const current = reached[reached.length - 1];
  let note: string | null = null;
  if (cancelled) note = 'Cancelled (simulated).';
  else if (diverted) {
    note = `Diverted via an alternative route; will not stop at ${stations[skippedIndex]!.name} (simulated).`;
  }

  return {
    trainNumber: schedule.trainNumber,
    trainName: schedule.trainName,
    startDate,
    state,
    currentStation: current ? { code: current.code, name: current.name } : null,
    delayMinutes: state === 'ARRIVED' ? last.delayMinutes : currentDelay,
    cancelled,
    diverted,
    note,
    stations,
    fetchedAt: now.toISOString(),
    source: 'simulator',
  };
}
