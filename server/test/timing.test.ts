import { describe, expect, it } from 'vitest';
import { explainEventKey } from '../src/alerts/explain.js';
import { connectionEvent, deriveEvents } from '../src/alerts/events.js';
import { computeLeaveTime, connectionRisk } from '../src/alerts/timing.js';
import { simulateStatus } from '../src/trains/mock/scenarios.js';
import { MOCK_TIMETABLES } from '../src/trains/mock/timetables.js';
import { istInstant } from '../src/trains/time.js';
import type { StationStatus, TrainStatus } from '../src/trains/types.js';

const iso = (s: string) => new Date(s).toISOString();

/** A hand-built status, so delays can do anything (including shrink). */
function status(
  stations: Partial<StationStatus>[],
  overrides: Partial<TrainStatus> = {},
): TrainStatus {
  return {
    trainNumber: '12345',
    trainName: 'Test Express',
    startDate: '2026-10-09',
    state: 'NOT_STARTED',
    currentStation: null,
    delayMinutes: 0,
    cancelled: false,
    diverted: false,
    note: null,
    fetchedAt: iso('2026-10-09T12:00:00Z'),
    source: 'test',
    stations: stations.map((s) => ({
      code: 'X',
      name: 'X',
      scheduledArrival: null,
      scheduledDeparture: null,
      expectedArrival: null,
      expectedDeparture: null,
      delayMinutes: 0,
      platform: null,
      state: 'UPCOMING',
      ...s,
    })),
    ...overrides,
  };
}

// A train leaving AAA at 00:30 IST on the 10th (= 19:00 UTC on the 9th).
const boarding = (delay: number, state: StationStatus['state'] = 'UPCOMING') =>
  status([
    {
      code: 'AAA',
      name: 'Alpha',
      scheduledDeparture: iso('2026-10-09T19:00:00Z'),
      expectedDeparture: new Date(
        Date.parse('2026-10-09T19:00:00Z') + delay * 60_000,
      ).toISOString(),
      delayMinutes: delay,
      state,
    },
    {
      code: 'BBB',
      name: 'Beta',
      scheduledArrival: iso('2026-10-10T02:00:00Z'),
      expectedArrival: iso('2026-10-10T02:00:00Z'),
    },
  ]);

describe('computeLeaveTime', () => {
  it('is departure − travel − buffer, crossing midnight (00:30 train → leave 23:35 the day before)', () => {
    const t = computeLeaveTime(boarding(0), 'AAA', 40, 15, new Date('2026-10-09T17:00:00Z'));
    expect(t).toMatchObject({
      state: 'OK',
      leaveBy: iso('2026-10-09T18:05:00Z'),
      minutesUntilLeave: 65,
    });
  });

  it('moves later with a delay and earlier again when the delay shrinks', () => {
    const now = new Date('2026-10-09T17:00:00Z');
    const late = computeLeaveTime(boarding(60), 'AAA', 40, 15, now);
    const less = computeLeaveTime(boarding(20), 'AAA', 40, 15, now);
    expect(late.state === 'OK' && late.leaveBy).toBe(iso('2026-10-09T19:05:00Z'));
    expect(less.state === 'OK' && less.leaveBy).toBe(iso('2026-10-09T18:25:00Z'));
  });

  it('turns negative once the leave-by time has passed', () => {
    const t = computeLeaveTime(boarding(0), 'AAA', 40, 15, new Date('2026-10-09T18:20:00Z'));
    expect(t.state === 'OK' && t.minutesUntilLeave).toBe(-15);
  });

  it('reports departed, cancelled, skipped and unknown stations instead of a time', () => {
    const now = new Date('2026-10-09T18:00:00Z');
    expect(computeLeaveTime(boarding(0, 'DEPARTED'), 'AAA', 40, 15, now).state).toBe('DEPARTED');
    expect(computeLeaveTime(boarding(0, 'SKIPPED'), 'AAA', 40, 15, now).state).toBe('NOT_STOPPING');
    expect(computeLeaveTime({ ...boarding(0), cancelled: true }, 'AAA', 40, 15, now).state).toBe(
      'CANCELLED',
    );
    expect(computeLeaveTime(boarding(0), 'ZZZ', 40, 15, now).state).toBe('UNKNOWN_STATION');
  });
});

describe('LEAVE_NOW event', () => {
  const j = {
    trainNumber: '12345',
    fromStationCode: 'AAA',
    toStationCode: 'BBB',
    minDelayMinutes: null,
    travelTimeMinutes: 40,
    leaveBufferMinutes: 15,
  };
  const leaveNow = (s: TrainStatus, now: string) =>
    deriveEvents(j, s, null, new Date(now)).find((e) => e.kind === 'LEAVE_NOW');

  it('fires at the leave-by time, not before', () => {
    expect(leaveNow(boarding(0), '2026-10-09T18:04:00Z')).toBeUndefined();
    expect(leaveNow(boarding(0), '2026-10-09T18:05:00Z')).toMatchObject({
      key: 'LEAVE_NOW:AAA',
      critical: true,
      ownerOnly: true,
    });
  });

  it('waits for a late train, and fires straight away if the delay shrinks past now', () => {
    // At 18:30 a 60-min-late train means leave at 19:05: not yet.
    expect(leaveNow(boarding(60), '2026-10-09T18:30:00Z')).toBeUndefined();
    // The delay drops to 20 min: leave-by is now 18:25, already passed, so go now.
    const e = leaveNow(boarding(20), '2026-10-09T18:30:00Z')!;
    expect(e.body).toContain('expected to depart AAA at 00:50 (20 min late)');
  });

  it('is off without a travel time', () => {
    const e = deriveEvents(
      { ...j, travelTimeMinutes: null },
      boarding(0),
      null,
      new Date('2026-10-09T18:30:00Z'),
    );
    expect(e.some((x) => x.kind === 'LEAVE_NOW')).toBe(false);
  });

  it('works with the simulator: 12951 from MMCT (17:00) with 45 min travel + 15 buffer → 16:00', () => {
    const t = MOCK_TIMETABLES.find((x) => x.trainNumber === '12951')!;
    const at = (hhmm: string) => istInstant('2026-10-09', hhmm);
    const jj = {
      ...j,
      trainNumber: '12951',
      fromStationCode: 'MMCT',
      toStationCode: 'NDLS',
      travelTimeMinutes: 45,
    };
    const ev = (hhmm: string) =>
      deriveEvents(jj, simulateStatus(t, '2026-10-09', 'ON_TIME', at(hhmm)), null, at(hhmm));
    expect(ev('15:59').some((e) => e.kind === 'LEAVE_NOW')).toBe(false);
    expect(ev('16:00').some((e) => e.kind === 'LEAVE_NOW')).toBe(true);
    expect(ev('17:05').some((e) => e.kind === 'LEAVE_NOW')).toBe(false); // already departed
  });
});

describe('connectionRisk', () => {
  const first = (arrDelay: number) =>
    status([
      {
        code: 'AAA',
        scheduledDeparture: iso('2026-10-09T18:00:00Z'),
        expectedDeparture: iso('2026-10-09T18:00:00Z'),
      },
      {
        code: 'HUB',
        name: 'Hub Junction',
        scheduledArrival: iso('2026-10-09T23:00:00Z'),
        expectedArrival: new Date(
          Date.parse('2026-10-09T23:00:00Z') + arrDelay * 60_000,
        ).toISOString(),
        delayMinutes: arrDelay,
      },
    ]);
  // The second train leaves HUB at 00:30 UTC on the 10th: a 90-min window, across midnight UTC.
  const second = status(
    [
      {
        code: 'HUB',
        scheduledDeparture: iso('2026-10-10T00:30:00Z'),
        expectedDeparture: iso('2026-10-10T00:30:00Z'),
      },
    ],
    { trainNumber: '22222' },
  );

  it('OK with enough time, TIGHT below the buffer, MISSED when the second leaves first', () => {
    expect(connectionRisk(first(0), 'HUB', second, 'HUB', 30)).toMatchObject({
      level: 'OK',
      spareMinutes: 90,
    });
    expect(connectionRisk(first(70), 'HUB', second, 'HUB', 30)).toMatchObject({
      level: 'TIGHT',
      spareMinutes: 20,
    });
    expect(connectionRisk(first(100), 'HUB', second, 'HUB', 30)).toMatchObject({
      level: 'MISSED',
      spareMinutes: -10,
    });
  });

  it('recovers when the delay shrinks', () => {
    expect(connectionRisk(first(70), 'HUB', second, 'HUB', 30)!.level).toBe('TIGHT');
    expect(connectionRisk(first(30), 'HUB', second, 'HUB', 30)!.level).toBe('OK');
  });

  it("can't judge cancelled trains or unknown stations", () => {
    expect(connectionRisk({ ...first(0), cancelled: true }, 'HUB', second, 'HUB', 30)).toBeNull();
    expect(connectionRisk(first(0), 'NOPE', second, 'HUB', 30)).toBeNull();
  });

  it('builds a critical, owner-only alert with a level-specific key', () => {
    const e = connectionEvent(connectionRisk(first(70), 'HUB', second, 'HUB', 30), first(70), {
      journeyId: 'j2',
      trainNumber: '22222',
      stationCode: 'HUB',
    })!;
    expect(e).toMatchObject({ key: 'CONNECTION:j2:TIGHT', critical: true, ownerOnly: true });
    expect(e.body).toContain('leaving 20 min to catch 22222');
    expect(
      connectionEvent(connectionRisk(first(0), 'HUB', second, 'HUB', 30), first(0), {
        journeyId: 'j2',
        trainNumber: '22222',
        stationCode: 'HUB',
      }),
    ).toBeNull();
  });
});

describe('explainEventKey', () => {
  const settings = {
    minDelayMinutes: 30,
    quietHoursStart: '22:00',
    quietHoursEnd: '06:30',
    travelTimeMinutes: 40,
    leaveBufferMinutes: 15,
    connectionBufferMinutes: 30,
  };
  it("explains each kind of alert in terms of the user's own settings", () => {
    expect(explainEventKey('DELAY:60', settings)).toMatch(
      /reached 60 minutes.*once it's 30 minutes late.*quiet hours \(22:00–06:30 IST\)/,
    );
    expect(explainEventKey('LEAVE_NOW:MMCT', settings)).toMatch(
      /your 40-minute journey.*15-minute buffer/,
    );
    expect(explainEventKey('PLATFORM:MMCT:5', settings)).toContain('changed to 5');
    expect(explainEventKey('CONNECTION:x:MISSED', settings)).toContain(
      'after your connecting train leaves',
    );
    expect(explainEventKey('CANCELLED', settings)).toContain('always sent');
  });
});
