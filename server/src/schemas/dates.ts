/** Calendar dates are YYYY-MM-DD in India Standard Time (UTC+05:30, no DST). */
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function istDate(at: Date = new Date(), addDays = 0): string {
  return new Date(at.getTime() + IST_OFFSET_MS + addDays * DAY_MS).toISOString().slice(0, 10);
}

/** How far ahead a journey can be created. Indian Railways opens booking 60 days ahead. */
export const MAX_DAYS_AHEAD = 120;

/**
 * A journey can start yesterday at the earliest (a train that left last night
 * may still be running) and at most MAX_DAYS_AHEAD days from today.
 * Returns an error message, or null if the date is fine.
 */
export function journeyDateProblem(date: string, now: Date = new Date()): string | null {
  if (date < istDate(now, -1)) return 'Journey date is in the past';
  if (date > istDate(now, MAX_DAYS_AHEAD)) {
    return `Journey date must be within ${MAX_DAYS_AHEAD} days`;
  }
  return null;
}
