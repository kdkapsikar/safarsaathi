const IST_OFFSET_MIN = 330;

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/**
 * Whether `now` falls inside quiet hours given as "HH:MM" IST. Handles windows
 * that cross midnight ("22:00"-"06:30"). start == end means no quiet hours.
 */
export function inQuietHours(now: Date, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return false;
  const t = (Math.floor(now.getTime() / 60_000) + IST_OFFSET_MIN) % 1440;
  return s < e ? t >= s && t < e : t >= s || t < e;
}
