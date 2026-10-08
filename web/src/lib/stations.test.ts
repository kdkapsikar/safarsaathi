import { describe, expect, it } from 'vitest';
import { findStation, searchStations, STATIONS } from './stations';

describe('stations', () => {
  it('has unique, well-formed codes', () => {
    const codes = STATIONS.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^[A-Z]{1,5}$/);
  });

  it('ranks an exact code match first', () => {
    expect(searchStations('ndls')[0]?.code).toBe('NDLS');
  });

  it('matches name word prefixes', () => {
    const codes = searchStations('mumbai').map((s) => s.code);
    expect(codes).toContain('MMCT');
  });

  it('returns nothing for an empty query', () => {
    expect(searchStations('  ')).toEqual([]);
  });

  it('finds a station by code, case-insensitively', () => {
    expect(findStation(' mas ')?.name).toBe('Chennai Central');
    expect(findStation('ZZZZ')).toBeUndefined();
  });
});
