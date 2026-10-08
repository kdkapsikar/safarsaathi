import { istDate } from '@safar-saathi/server/schemas';

export { istDate };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Fri, 9 Oct 2026" from "2026-10-09". Formatted by hand so it is the same in
 * every browser and timezone (Intl output varies between ICU versions).
 */
export function formatJourneyDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return `${WEEKDAYS[weekday]}, ${d} ${MONTHS[m! - 1]} ${y}`;
}

export type DateLabel = 'Today' | 'Tomorrow' | 'Yesterday' | 'Upcoming' | 'Past';

export function relativeDateLabel(date: string, now: Date = new Date()): DateLabel {
  if (date === istDate(now)) return 'Today';
  if (date === istDate(now, 1)) return 'Tomorrow';
  if (date === istDate(now, -1)) return 'Yesterday';
  return date > istDate(now) ? 'Upcoming' : 'Past';
}

import { formatDelay, formatIstTime } from '@safar-saathi/server/schemas';

export { formatDelay, formatIstTime };

const IST_OFFSET_MS = 330 * 60_000;

/** The IST calendar date (YYYY-MM-DD) of an ISO instant. */
export function istDateOf(iso: string): string {
  return new Date(new Date(iso).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** "Fri, 9 Oct 2026, 17:05" in IST. */
export function formatIstDateTime(iso: string): string {
  return `${formatJourneyDate(istDateOf(iso))}, ${formatIstTime(iso)}`;
}
