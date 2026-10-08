import { describe, expect, it } from 'vitest';
import { formatJourneyDate, relativeDateLabel } from './dates';

describe('dates', () => {
  it('formats journey dates the same everywhere', () => {
    expect(formatJourneyDate('2026-10-09')).toBe('Fri, 9 Oct 2026');
    expect(formatJourneyDate('2027-01-01')).toBe('Fri, 1 Jan 2027');
  });

  it('labels dates relative to today in IST', () => {
    // 2026-10-08 20:00 UTC is 2026-10-09 01:30 IST.
    const now = new Date('2026-10-08T20:00:00Z');
    expect(relativeDateLabel('2026-10-09', now)).toBe('Today');
    expect(relativeDateLabel('2026-10-10', now)).toBe('Tomorrow');
    expect(relativeDateLabel('2026-10-08', now)).toBe('Yesterday');
    expect(relativeDateLabel('2026-10-20', now)).toBe('Upcoming');
    expect(relativeDateLabel('2026-10-01', now)).toBe('Past');
  });
});
