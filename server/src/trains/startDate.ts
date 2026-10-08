import type { TrainSchedule } from './types.js';

/**
 * Journeys store the date the passenger boards. Providers key runs by the date
 * the train left its origin. A passenger boarding at a day-2 stop on the 10th is
 * on the run that started on the 9th.
 */
export function resolveStartDate(
  schedule: TrainSchedule | null,
  boardingCode: string,
  boardingDate: string,
): string {
  const stop = schedule?.stops.find((s) => s.code === boardingCode);
  if (!stop || stop.day <= 1) return boardingDate;
  const [y, m, d] = boardingDate.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - (stop.day - 1))).toISOString().slice(0, 10);
}
