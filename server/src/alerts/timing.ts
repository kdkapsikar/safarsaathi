import type { TrainStatus } from '../trains/types.js';

const MINUTE = 60_000;
const minutesBetween = (fromIso: string | Date, toIso: string | Date) =>
  Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / MINUTE);

export type LeaveTime =
  | {
      state: 'OK';
      /** When to leave home: expected departure − travel − buffer. */
      leaveBy: string;
      expectedDeparture: string;
      scheduledDeparture: string;
      delayMinutes: number;
      travelMinutes: number;
      bufferMinutes: number;
      /** Negative once the leave-by time has passed. */
      minutesUntilLeave: number;
      asOf: string;
    }
  | { state: 'DEPARTED' | 'CANCELLED' | 'NOT_STOPPING' | 'UNKNOWN_STATION'; asOf: string };

/**
 * "Leave home now" maths. Uses the live expected departure at the boarding
 * station, so it moves with every status change: later when the train runs
 * late, earlier again if the delay shrinks. Instants are absolute, so a
 * leave-by time on the evening before a 00:30 departure works naturally.
 */
export function computeLeaveTime(
  status: TrainStatus,
  boardingCode: string,
  travelMinutes: number,
  bufferMinutes: number,
  now: Date,
): LeaveTime {
  const asOf = status.fetchedAt;
  if (status.cancelled) return { state: 'CANCELLED', asOf };
  const st = status.stations.find((s) => s.code === boardingCode);
  if (!st || !st.scheduledDeparture || !st.expectedDeparture)
    return { state: 'UNKNOWN_STATION', asOf };
  if (st.state === 'SKIPPED') return { state: 'NOT_STOPPING', asOf };
  if (st.state === 'DEPARTED') return { state: 'DEPARTED', asOf };

  const leaveBy = new Date(
    new Date(st.expectedDeparture).getTime() - (travelMinutes + bufferMinutes) * MINUTE,
  );
  return {
    state: 'OK',
    leaveBy: leaveBy.toISOString(),
    expectedDeparture: st.expectedDeparture,
    scheduledDeparture: st.scheduledDeparture,
    delayMinutes: st.delayMinutes,
    travelMinutes,
    bufferMinutes,
    minutesUntilLeave: minutesBetween(now, leaveBy),
    asOf,
  };
}

export type ConnectionRisk = {
  level: 'OK' | 'TIGHT' | 'MISSED';
  /** Minutes between arriving on the first train and the second train leaving. */
  spareMinutes: number;
  arriveAt: string;
  departAt: string;
  bufferMinutes: number;
} | null;

/**
 * Whether a delay on the first train threatens the second. TIGHT: less spare
 * time than the buffer the user asked for. MISSED: the second leaves first.
 * Null if either side can't be judged (unknown station, cancelled, skipped).
 */
export function connectionRisk(
  first: TrainStatus,
  arrivalCode: string,
  second: TrainStatus,
  departureCode: string,
  bufferMinutes: number,
): ConnectionRisk {
  if (first.cancelled || second.cancelled) return null;
  const arrive = first.stations.find((s) => s.code === arrivalCode);
  const depart = second.stations.find((s) => s.code === departureCode);
  if (!arrive?.expectedArrival || !depart?.expectedDeparture) return null;
  if (arrive.state === 'SKIPPED' || depart.state === 'SKIPPED') return null;

  const spareMinutes = minutesBetween(arrive.expectedArrival, depart.expectedDeparture);
  const level = spareMinutes < 0 ? 'MISSED' : spareMinutes < bufferMinutes ? 'TIGHT' : 'OK';
  return {
    level,
    spareMinutes,
    arriveAt: arrive.expectedArrival,
    departAt: depart.expectedDeparture,
    bufferMinutes,
  };
}
