import { describe, expect, it } from 'vitest';
import { delayBucket, deriveEvents, type JourneyContext } from '../src/alerts/events.js';
import { pollIntervalMinutes } from '../src/alerts/engine.js';
import { inQuietHours } from '../src/alerts/quietHours.js';
import { simulateStatus } from '../src/trains/mock/scenarios.js';
import { MOCK_TIMETABLES } from '../src/trains/mock/timetables.js';
import { resolveStartDate } from '../src/trains/startDate.js';
import { istInstant } from '../src/trains/time.js';

const rajdhani = MOCK_TIMETABLES.find((t) => t.trainNumber === '12951')!;
const START = '2026-10-09';
const at = (hhmm: string, day = 1) => istInstant(START, hhmm, day);
const journey = {
  trainNumber: '12951',
  fromStationCode: 'MMCT',
  toStationCode: 'NDLS',
  minDelayMinutes: null,
};

describe('inQuietHours (IST)', () => {
  it('handles a same-day window', () => {
    expect(inQuietHours(at('13:30'), '13:00', '14:00')).toBe(true);
    expect(inQuietHours(at('14:00'), '13:00', '14:00')).toBe(false);
  });
  it('handles a window crossing midnight', () => {
    expect(inQuietHours(at('23:30'), '22:00', '06:30')).toBe(true);
    expect(inQuietHours(at('02:00', 2), '22:00', '06:30')).toBe(true);
    expect(inQuietHours(at('07:00', 2), '22:00', '06:30')).toBe(false);
  });
  it('treats missing or equal times as no quiet hours', () => {
    expect(inQuietHours(at('23:30'), null, null)).toBe(false);
    expect(inQuietHours(at('23:30'), '22:00', '22:00')).toBe(false);
  });
});

describe('delayBucket', () => {
  it('starts at the threshold, then steps up', () => {
    expect(delayBucket(10, 15)).toBeNull();
    expect(delayBucket(15, 15)).toBe(15);
    expect(delayBucket(29, 15)).toBe(15);
    expect(delayBucket(31, 15)).toBe(30);
    expect(delayBucket(95, 15)).toBe(90);
    expect(delayBucket(95, 45)).toBe(90);
    expect(delayBucket(50, 45)).toBe(45);
  });
});

describe('resolveStartDate', () => {
  it('maps a day-2 boarding date back to the start date, across a month end', () => {
    expect(resolveStartDate(rajdhani, 'KOTA', '2026-10-10')).toBe('2026-10-09');
    expect(resolveStartDate(rajdhani, 'KOTA', '2026-11-01')).toBe('2026-10-31');
  });
  it('leaves day-1 stops and unknown stations alone', () => {
    expect(resolveStartDate(rajdhani, 'BRC', '2026-10-09')).toBe('2026-10-09');
    expect(resolveStartDate(rajdhani, 'XYZ', '2026-10-09')).toBe('2026-10-09');
    expect(resolveStartDate(null, 'KOTA', '2026-10-10')).toBe('2026-10-10');
  });
});

describe('deriveEvents', () => {
  const events = (
    scenario: Parameters<typeof simulateStatus>[2],
    now: Date,
    j: JourneyContext = journey,
  ) => deriveEvents(j, simulateStatus(rajdhani, START, scenario, now), null, now);

  it('nothing to say for an on-time train far from departure', () => {
    expect(events('ON_TIME', at('10:00'))).toEqual([]);
  });

  it('departure, with a stable key and the departure time', () => {
    const e = events('ON_TIME', at('17:10')).find((x) => x.kind === 'DEPARTED');
    expect(e).toMatchObject({ key: 'DEPARTED:MMCT', ruleType: 'DEPARTURE' });
    expect(e!.body).toContain('Departed MMCT at 17:00 on time');
  });

  it('delay events say how late and include "As of"', () => {
    const e = events('GROWING_DELAY', at('21:00')).find(
      (x) => x.kind === 'DELAY_CROSSED_THRESHOLD',
    )!;
    expect(e.key).toMatch(/^DELAY:\d+$/);
    expect(e.title).toMatch(/running \d+ h/);
    expect(e.body).toMatch(/As of 21:00\./);
  });

  it('respects a custom delay threshold', () => {
    const now = at('19:00'); // ~30 min late
    expect(events('GROWING_DELAY', now).some((x) => x.ruleType === 'DELAY')).toBe(true);
    expect(
      events('GROWING_DELAY', now, { ...journey, minDelayMinutes: 45 }).some(
        (x) => x.ruleType === 'DELAY',
      ),
    ).toBe(false);
  });

  it('cancellation is critical and suppresses everything else', () => {
    const e = events('CANCELLED', at('14:00'));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ kind: 'CANCELLED', critical: true, ruleType: null });
  });

  it('diversion names a skipped station on the journey', () => {
    const e = events('DIVERTED', at('22:00'), { ...journey, toStationCode: 'RTM' }).find(
      (x) => x.kind === 'DIVERTED',
    )!;
    expect(e.body).toContain('will not stop at Ratlam Junction');
  });

  it('platform change mentions the previous platform', () => {
    const before = simulateStatus(rajdhani, START, 'PLATFORM_CHANGE', at('15:00'));
    const now = at('16:40');
    const after = simulateStatus(rajdhani, START, 'PLATFORM_CHANGE', now);
    const e = deriveEvents(journey, after, before, now).find((x) => x.kind === 'PLATFORM_CHANGED')!;
    const was = before.stations[0]!.platform;
    expect(e.title).toContain('Platform change');
    expect(e.body).toContain(`(was ${was})`);
    expect(e.key).toBe(`PLATFORM:MMCT:${after.stations[0]!.platform}`);
  });

  it('arriving soon, 30 minutes out', () => {
    expect(events('ON_TIME', at('08:05', 2)).some((x) => x.kind === 'ARRIVING_SOON')).toBe(true);
    expect(events('ON_TIME', at('07:55', 2)).some((x) => x.kind === 'ARRIVING_SOON')).toBe(false);
  });
});

describe('pollIntervalMinutes', () => {
  const status = (now: Date) => simulateStatus(rajdhani, START, 'ON_TIME', now);
  it('polls every minute near departure, every 5 while running, rarely when far', () => {
    expect(pollIntervalMinutes(null, at('10:00'))).toBe(0);
    expect(pollIntervalMinutes(status(at('16:30')), at('16:30'))).toBe(1);
    expect(pollIntervalMinutes(status(at('22:30')), at('22:30'))).toBe(5);
    expect(pollIntervalMinutes(status(at('09:00')), at('09:00'))).toBe(15);
    expect(pollIntervalMinutes(status(at('10:00', 2)), at('10:00', 2))).toBe(30);
  });
});
