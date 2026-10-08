import { formatDelay, formatIstTime } from '../schemas/format.js';
import type { AlertType } from '../schemas/journey.js';
import type { StationStatus, TrainStatus } from '../trains/types.js';

export type EventKind =
  | 'DEPARTED'
  | 'ARRIVING_SOON'
  | 'DELAY_CROSSED_THRESHOLD'
  | 'PLATFORM_CHANGED'
  | 'CANCELLED'
  | 'DIVERTED';

export interface AlertEvent {
  kind: EventKind;
  /** Stable per journey: the same situation always gets the same key, so it's sent once. */
  key: string;
  /** Which alert type the user must have chosen; null = always sent (cancellation, diversion). */
  ruleType: AlertType | null;
  /** Critical events ignore quiet hours. */
  critical: boolean;
  title: string;
  body: string;
}

export interface JourneyContext {
  trainNumber: string;
  fromStationCode: string;
  toStationCode: string;
  /** The rule's delay threshold, if any (DELAY rule). */
  minDelayMinutes: number | null;
}

export const DEFAULT_DELAY_THRESHOLD = 15;
const DELAY_STEPS = [30, 60, 90, 120, 180, 240];
export const ARRIVING_SOON_MINUTES = 30;
/** A departure older than this isn't news any more (e.g. a journey added late). */
const DEPARTED_FRESH_MINUTES = 60;

const minutesUntil = (iso: string, now: Date) => (new Date(iso).getTime() - now.getTime()) / 60_000;

/** Delay steps worth telling people about: the threshold, then 30, 60, 90... above it. */
export function delayBucket(delay: number, threshold: number): number | null {
  if (delay < threshold) return null;
  const steps = [threshold, ...DELAY_STEPS.filter((s) => s > threshold)];
  return steps.filter((s) => s <= delay).at(-1)!;
}

/**
 * The alert-worthy facts about one journey right now. `previous` is the last
 * stored snapshot of the same train run, used to describe changes ("was 3").
 * Events are derived from current state with stable keys, so a missed run
 * never loses an alert and a repeated run never duplicates one.
 */
export function deriveEvents(
  j: JourneyContext,
  status: TrainStatus,
  previous: TrainStatus | null,
  now: Date,
): AlertEvent[] {
  const events: AlertEvent[] = [];
  const asOf = `As of ${formatIstTime(status.fetchedAt)}.`;
  const name = `${status.trainNumber} ${status.trainName}`;
  const boarding = status.stations.find((s) => s.code === j.fromStationCode);
  const dest = status.stations.find((s) => s.code === j.toStationCode);
  const prevBoarding = previous?.stations.find((s) => s.code === j.fromStationCode);

  if (status.cancelled) {
    events.push({
      kind: 'CANCELLED',
      key: 'CANCELLED',
      ruleType: null,
      critical: true,
      title: `${status.trainNumber} is cancelled`,
      body: `${name} (starting ${status.startDate}) has been cancelled. ${status.note ?? ''} ${asOf}`
        .replace(/\s+/g, ' ')
        .trim(),
    });
    return events;
  }

  if (status.diverted) {
    const skipped = [boarding, dest].filter((s): s is StationStatus => s?.state === 'SKIPPED');
    const affects = skipped.length
      ? ` It will not stop at ${skipped.map((s) => s.name).join(' or ')}, which is on your journey.`
      : '';
    events.push({
      kind: 'DIVERTED',
      key: 'DIVERTED',
      ruleType: null,
      critical: true,
      title: `${status.trainNumber} is diverted`,
      body: `${name} is running on a diverted route.${affects} ${status.note ?? ''} ${asOf}`
        .replace(/\s+/g, ' ')
        .trim(),
    });
  }

  if (status.state === 'ARRIVED') return events;

  // Departed from the passenger's station.
  if (
    boarding?.state === 'DEPARTED' &&
    boarding.expectedDeparture &&
    minutesUntil(boarding.expectedDeparture, now) >= -DEPARTED_FRESH_MINUTES
  ) {
    events.push({
      kind: 'DEPARTED',
      key: `DEPARTED:${boarding.code}`,
      ruleType: 'DEPARTURE',
      critical: false,
      title: `${status.trainNumber} has left ${boarding.name}`,
      body: `Departed ${boarding.code} at ${formatIstTime(boarding.expectedDeparture)}${
        boarding.delayMinutes > 0 ? `, ${formatDelay(boarding.delayMinutes)}` : ' on time'
      }. ${asOf}`,
    });
  }

  // Nearly at the destination.
  if (
    dest &&
    dest.state === 'UPCOMING' &&
    dest.expectedArrival &&
    minutesUntil(dest.expectedArrival, now) <= ARRIVING_SOON_MINUTES
  ) {
    events.push({
      kind: 'ARRIVING_SOON',
      key: `ARRIVING_SOON:${dest.code}`,
      ruleType: 'ARRIVAL',
      critical: false,
      title: `${status.trainNumber} arriving at ${dest.name} soon`,
      body: `Expected at ${dest.code} at ${formatIstTime(dest.expectedArrival)}${
        dest.delayMinutes > 0 ? ` (${formatDelay(dest.delayMinutes)})` : ''
      }${dest.platform ? `, platform ${dest.platform}` : ''}. ${asOf}`,
    });
  }

  // Delay crossing the threshold, then each bigger step.
  const threshold = j.minDelayMinutes ?? DEFAULT_DELAY_THRESHOLD;
  const watch = boarding && boarding.state === 'UPCOMING' ? boarding : dest;
  const delay = watch?.delayMinutes ?? status.delayMinutes;
  const bucket = delayBucket(delay, threshold);
  if (bucket !== null && watch) {
    const expected = watch.expectedArrival ?? watch.expectedDeparture;
    const scheduled = watch.scheduledArrival ?? watch.scheduledDeparture;
    events.push({
      kind: 'DELAY_CROSSED_THRESHOLD',
      key: `DELAY:${bucket}`,
      ruleType: 'DELAY',
      critical: false,
      title: `${status.trainNumber} is running ${formatDelay(delay)}`,
      body: `${name} is ${formatDelay(delay)}. Now expected at ${watch.code} at ${
        expected ? formatIstTime(expected) : '?'
      }${scheduled ? ` instead of ${formatIstTime(scheduled)}` : ''}. ${asOf}`,
    });
  }

  // Platform announced or changed at the boarding station (until departure).
  if (boarding && boarding.state === 'UPCOMING' && boarding.platform) {
    const was = prevBoarding?.platform;
    const changed = was && was !== boarding.platform;
    events.push({
      kind: 'PLATFORM_CHANGED',
      key: `PLATFORM:${boarding.code}:${boarding.platform}`,
      ruleType: 'PLATFORM_CHANGE',
      critical: false,
      title: changed
        ? `Platform change for ${status.trainNumber} at ${boarding.code}`
        : `${status.trainNumber}: platform ${boarding.platform} at ${boarding.code}`,
      body: changed
        ? `${name} will now leave ${boarding.name} from platform ${boarding.platform} (was ${was}). ${asOf}`
        : `${name} is expected on platform ${boarding.platform} at ${boarding.name}. ${asOf}`,
    });
  }

  return events;
}
