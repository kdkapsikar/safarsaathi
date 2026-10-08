// Shared with web/: how times and delays read to users, identical in alerts,
// the dashboard and the assistant.

const IST_OFFSET_MS = 330 * 60_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** "17:05" in India Standard Time, from an ISO instant. */
export function formatIstTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "25 min late", "1 h 5 min late", "On time". */
export function formatDelay(minutes: number): string {
  if (minutes <= 0) return 'On time';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} h ${m} min late`;
  return h ? `${h} h late` : `${m} min late`;
}
