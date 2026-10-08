import { describe, expect, it } from 'vitest';
import { simulateStatus, type ScenarioId } from '../src/trains/mock/scenarios.js';
import { MOCK_TIMETABLES } from '../src/trains/mock/timetables.js';
import { istInstant } from '../src/trains/time.js';

const rajdhani = MOCK_TIMETABLES.find((t) => t.trainNumber === '12951')!;
const START = '2026-10-09';
// 12951 leaves MMCT 17:00 IST day 1, reaches NDLS 08:32 IST day 2.
const at = (hhmm: string, day = 1) => istInstant(START, hhmm, day);
const run = (scenario: ScenarioId, now: Date) => simulateStatus(rajdhani, START, scenario, now);

describe('simulateStatus', () => {
  it('converts IST timetable times to UTC instants across midnight', () => {
    const s = run('ON_TIME', at('12:00'));
    expect(s.stations[0]!.scheduledDeparture).toBe('2026-10-09T11:30:00.000Z');
    expect(s.stations.at(-1)!.scheduledArrival).toBe('2026-10-10T03:02:00.000Z');
  });

  describe('ON_TIME', () => {
    it('walks through the journey: not started, running, arrived', () => {
      expect(run('ON_TIME', at('16:00'))).toMatchObject({
        state: 'NOT_STARTED',
        currentStation: null,
        delayMinutes: 0,
      });

      const mid = run('ON_TIME', at('21:10'));
      expect(mid.state).toBe('RUNNING');
      expect(mid.currentStation).toEqual({ code: 'BRC', name: 'Vadodara Junction' });
      expect(mid.stations.map((s) => s.state)).toEqual([
        'DEPARTED',
        'DEPARTED',
        'ARRIVED',
        'UPCOMING',
        'UPCOMING',
        'UPCOMING',
      ]);

      expect(run('ON_TIME', at('09:00', 2)).state).toBe('ARRIVED');
    });

    it('reports fetchedAt as the time of the reading', () => {
      const now = at('18:00');
      expect(run('ON_TIME', now).fetchedAt).toBe(now.toISOString());
    });
  });

  describe('GROWING_DELAY', () => {
    it('is on time at departure and grows while running', () => {
      expect(run('GROWING_DELAY', at('17:05')).delayMinutes).toBe(0);
      const later = run('GROWING_DELAY', at('21:00'));
      expect(later.delayMinutes).toBeGreaterThan(60);
      const evenLater = run('GROWING_DELAY', at('02:00', 2));
      expect(evenLater.delayMinutes).toBeGreaterThan(later.delayMinutes);
    });

    it('caps the delay and projects it onto upcoming stations', () => {
      const s = run('GROWING_DELAY', at('03:00', 2));
      expect(s.delayMinutes).toBeLessThanOrEqual(150);
      const dest = s.stations.at(-1)!;
      expect(dest.state).toBe('UPCOMING');
      expect(dest.delayMinutes).toBe(s.delayMinutes);
      expect(
        new Date(dest.expectedArrival!).getTime() - new Date(dest.scheduledArrival!).getTime(),
      ).toBe(s.delayMinutes * 60_000);
    });

    it('keeps a station upcoming until the late train actually reaches it', () => {
      // Surat is due 19:43; by then the train is ~40 min late, so at 19:50 it hasn't arrived.
      const s = run('GROWING_DELAY', at('19:50'));
      expect(s.stations[1]!.state).toBe('UPCOMING');
      expect(s.currentStation?.code).toBe('MMCT');
    });
  });

  describe('PLATFORM_CHANGE', () => {
    it('announces platforms 3 hours ahead, then changes them 30 minutes before', () => {
      expect(run('PLATFORM_CHANGE', at('13:00')).stations[0]!.platform).toBeNull();
      const announced = run('PLATFORM_CHANGE', at('14:30')).stations[0]!.platform;
      expect(announced).not.toBeNull();
      const changed = run('PLATFORM_CHANGE', at('16:40')).stations[0]!.platform;
      expect(changed).not.toBeNull();
      expect(changed).not.toBe(announced);
    });

    it('never changes platforms in other scenarios', () => {
      const a = run('ON_TIME', at('14:30')).stations[0]!.platform;
      expect(run('ON_TIME', at('16:40')).stations[0]!.platform).toBe(a);
    });
  });

  describe('CANCELLED', () => {
    it('looks normal until 4 hours before departure, then is cancelled', () => {
      expect(run('CANCELLED', at('12:30')).cancelled).toBe(false);
      const s = run('CANCELLED', at('13:30'));
      expect(s).toMatchObject({ state: 'CANCELLED', cancelled: true, currentStation: null });
      expect(s.note).toMatch(/Cancelled/);
      expect(s.stations.every((st) => st.state === 'UPCOMING' && st.platform === null)).toBe(true);
    });

    it('stays cancelled after the departure time passes', () => {
      expect(run('CANCELLED', at('20:00')).state).toBe('CANCELLED');
    });
  });

  describe('DIVERTED', () => {
    it('skips a mid-route stop and runs late after it', () => {
      expect(run('DIVERTED', at('15:00')).diverted).toBe(false);
      const s = run('DIVERTED', at('03:00', 2));
      expect(s.diverted).toBe(true);
      const skipped = s.stations.filter((st) => st.state === 'SKIPPED');
      expect(skipped.map((st) => st.code)).toEqual(['RTM']);
      expect(s.note).toMatch(/Ratlam Junction/);
      expect(s.delayMinutes).toBeGreaterThan(0);
    });
  });
});
