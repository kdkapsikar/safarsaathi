const IST_OFFSET_MIN = 330;
const MINUTE = 60_000;

/** The instant of "HH:MM" IST on `startDate` + (day - 1) days. */
export function istInstant(startDate: string, hhmm: string, day = 1): Date {
  const [y, m, d] = startDate.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + day - 1, hh!, mm!) - IST_OFFSET_MIN * MINUTE);
}

export const addMinutes = (date: Date, minutes: number): Date =>
  new Date(date.getTime() + minutes * MINUTE);

export const minutesBetween = (from: Date, to: Date): number =>
  (to.getTime() - from.getTime()) / MINUTE;

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
