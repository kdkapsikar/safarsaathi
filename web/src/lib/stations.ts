import stationsData from '../data/stations.json';

export interface Station {
  code: string;
  name: string;
}

/**
 * A sample of major stations for autocomplete. Not the full Indian Railways
 * list; any valid code can still be typed in by hand.
 */
export const STATIONS: readonly Station[] = stationsData;

const byCode = new Map(STATIONS.map((s) => [s.code, s]));

export const findStation = (code: string): Station | undefined =>
  byCode.get(code.trim().toUpperCase());

/** Exact code first, then code prefix, then name word-prefix, then name substring. */
export function searchStations(query: string, limit = 8): Station[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored: { s: Station; score: number }[] = [];
  for (const s of STATIONS) {
    const code = s.code.toLowerCase();
    const name = s.name.toLowerCase();
    let score = -1;
    if (code === q) score = 0;
    else if (code.startsWith(q)) score = 1;
    else if (name.split(/[\s.]+/).some((w) => w.startsWith(q))) score = 2;
    else if (name.includes(q)) score = 3;
    if (score >= 0) scored.push({ s, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.s.name.localeCompare(b.s.name))
    .slice(0, limit)
    .map((x) => x.s);
}
