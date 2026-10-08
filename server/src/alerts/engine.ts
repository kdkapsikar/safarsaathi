import type { FastifyBaseLogger } from 'fastify';
import type { EngineJourney, EngineStore } from '../data/engineStore.js';
import { istDate } from '../schemas/dates.js';
import { istInstant, minutesBetween, type Clock } from '../trains/time.js';
import {
  ProviderError,
  resolveStartDate,
  type TrainDataProvider,
  type TrainSchedule,
  type TrainStatus,
} from '../trains/index.js';
import type { NotificationChannel, OutgoingNotification } from './channels.js';
import { connectionEvent, deriveEvents, type AlertEvent } from './events.js';
import { inQuietHours } from './quietHours.js';
import { computeLeaveTime, connectionRisk } from './timing.js';

export interface RunSummary {
  ranAt: string;
  journeysConsidered: number;
  outsideWindow: number;
  trainRuns: number;
  notDue: number;
  statusFetches: number;
  events: number;
  notificationsSent: number;
  duplicatesSkipped: number;
  quietHoursSkipped: number;
  errors: string[];
  skippedBecauseRunning?: boolean;
}

interface Group {
  trainNumber: string;
  startDate: string;
  journeys: EngineJourney[];
}

/** Watch from 6 h before boarding until 6 h after scheduled arrival (allows for delays). */
const WINDOW_BEFORE_MIN = 6 * 60;
const WINDOW_AFTER_MIN = 6 * 60;

/**
 * How often to re-check a train run: every minute close to a departure or
 * arrival, every 5 minutes otherwise while it matters, rarely when far off or done.
 */
export function pollIntervalMinutes(
  previous: TrainStatus | null,
  now: Date,
  /** Other moments that matter, e.g. passengers' leave-by times. */
  extraMoments: string[] = [],
): number {
  if (!previous) return 0;
  if (previous.state === 'ARRIVED' || previous.state === 'CANCELLED') return 30;
  const upcoming = [
    ...previous.stations
      .filter((s) => s.state === 'UPCOMING')
      .map((s) => s.expectedArrival ?? s.expectedDeparture)
      .filter((t): t is string => t !== null),
    ...extraMoments,
  ].map((t) => minutesBetween(now, new Date(t)));
  const next = Math.min(...upcoming.map((m) => Math.abs(m)));
  if (next <= 60) return 1;
  if (previous.state === 'NOT_STARTED' && next > 360) return 15;
  return 5;
}

export interface AlertEngineDeps {
  store: EngineStore;
  provider: TrainDataProvider;
  /** The simulator's clock in development, so stepping time drives alerts. */
  clock: Clock;
  inApp: NotificationChannel;
  email: NotificationChannel | null;
  log: FastifyBaseLogger;
  /** Public web address, for recipients' opt-out links. */
  appUrl: string;
}

export class AlertEngine {
  private readonly lastPolled = new Map<string, number>();
  private running = false;
  lastRun: RunSummary | null = null;

  constructor(private readonly deps: AlertEngineDeps) {}

  /** One pass over every active journey. `force` ignores the polling schedule. */
  async runOnce({ force = false } = {}): Promise<RunSummary> {
    const now = this.deps.clock.now();
    const summary: RunSummary = {
      ranAt: now.toISOString(),
      journeysConsidered: 0,
      outsideWindow: 0,
      trainRuns: 0,
      notDue: 0,
      statusFetches: 0,
      events: 0,
      notificationsSent: 0,
      duplicatesSkipped: 0,
      quietHoursSkipped: 0,
      errors: [],
    };
    if (this.running) return { ...summary, skippedBecauseRunning: true };
    this.running = true;

    try {
      const groups = await this.groupJourneys(now, summary);
      summary.trainRuns = groups.size;

      for (const [key, group] of groups) {
        const previous = this.deps.store.latestSnapshot(group.trainNumber, group.startDate);
        const last = this.lastPolled.get(key);
        const leaveMoments = previous
          ? group.journeys.flatMap((j) => {
              if (j.travelTimeMinutes === null) return [];
              const t = computeLeaveTime(
                previous,
                j.fromStationCode,
                j.travelTimeMinutes,
                j.leaveBufferMinutes,
                now,
              );
              return t.state === 'OK' ? [t.leaveBy] : [];
            })
          : [];
        const due =
          force ||
          last === undefined ||
          Math.abs(now.getTime() - last) >=
            pollIntervalMinutes(previous, now, leaveMoments) * 60_000;
        if (!due) {
          summary.notDue += 1;
          continue;
        }

        let status: TrainStatus | null;
        try {
          status = await this.deps.provider.getLiveStatus(group.trainNumber, group.startDate);
          summary.statusFetches += 1;
        } catch (err) {
          const why = err instanceof ProviderError ? err.kind : String(err);
          summary.errors.push(`${group.trainNumber} ${group.startDate}: ${why}`);
          continue;
        }
        this.lastPolled.set(key, now.getTime());
        if (!status) continue;

        for (const journey of group.journeys) {
          await this.notifyJourney(journey, status, previous, now, summary);
        }
        this.deps.store.saveSnapshot(status);
      }
    } finally {
      this.running = false;
    }

    this.lastRun = summary;
    if (summary.notificationsSent || summary.errors.length) {
      this.deps.log.info({ summary }, 'Alert run');
    }
    return summary;
  }

  /** Active journeys grouped by train run, so each run is fetched once for everyone on it. */
  private async groupJourneys(now: Date, summary: RunSummary): Promise<Map<string, Group>> {
    const journeys = this.deps.store.candidateJourneys(istDate(now, -3), istDate(now, 1));
    summary.journeysConsidered = journeys.length;
    const schedules = new Map<string, TrainSchedule | null>();
    const groups = new Map<string, Group>();

    for (const j of journeys) {
      if (!schedules.has(j.trainNumber)) {
        schedules.set(
          j.trainNumber,
          await this.deps.provider.getSchedule(j.trainNumber).catch(() => null),
        );
      }
      const schedule = schedules.get(j.trainNumber) ?? null;
      const startDate = resolveStartDate(schedule, j.fromStationCode, j.journeyDate);

      if (schedule && !insideWindow(schedule, startDate, j, now)) {
        summary.outsideWindow += 1;
        continue;
      }
      const key = `${j.trainNumber}:${startDate}`;
      const group = groups.get(key) ?? { trainNumber: j.trainNumber, startDate, journeys: [] };
      group.journeys.push(j);
      groups.set(key, group);
    }
    return groups;
  }

  private async notifyJourney(
    journey: EngineJourney,
    status: TrainStatus,
    previous: TrainStatus | null,
    now: Date,
    summary: RunSummary,
  ): Promise<void> {
    const delayRule = journey.rules.find((r) => r.type === 'DELAY');
    const events = deriveEvents(
      {
        trainNumber: journey.trainNumber,
        fromStationCode: journey.fromStationCode,
        toStationCode: journey.toStationCode,
        minDelayMinutes: delayRule?.minDelayMinutes ?? null,
        travelTimeMinutes: journey.travelTimeMinutes,
        leaveBufferMinutes: journey.leaveBufferMinutes,
      },
      status,
      previous,
      now,
    );
    const connection = await this.connectionCheck(journey, status);
    if (connection) events.push(connection);

    for (const event of events) {
      const rule = event.ruleType ? journey.rules.find((r) => r.type === event.ruleType) : null;
      if (event.ruleType && !rule) continue; // the user didn't ask for this kind of alert
      summary.events += 1;
      if (!event.critical && rule && inQuietHours(now, rule.quietHoursStart, rule.quietHoursEnd)) {
        // Not logged: if it's still true after quiet hours, it goes out then.
        summary.quietHoursSkipped += 1;
        continue;
      }

      const wantsEmail = rule
        ? rule.channel === 'EMAIL'
        : journey.rules.some((r) => r.channel === 'EMAIL');
      const ownerChannels = [
        this.deps.inApp,
        ...(wantsEmail && this.deps.email ? [this.deps.email] : []),
      ];
      const base = {
        journeyId: journey.id,
        eventKey: event.key,
        title: event.title,
        body: event.body,
      };

      await this.deliver(
        {
          ...base,
          to: {
            kind: 'owner',
            userId: journey.userId,
            name: journey.ownerName,
            email: journey.ownerEmail,
          },
        },
        ownerChannels,
        { ruleId: rule?.id ?? null, recipientId: null },
        summary,
      );

      if (this.deps.email && !event.ownerOnly) {
        for (const r of this.deps.store.activeRecipients(journey.id)) {
          const optOutUrl = `${this.deps.appUrl.replace(/\/$/, '')}/optout/${r.optOutToken}`;
          await this.deliver(
            { ...base, to: { kind: 'recipient', name: r.name, email: r.email, optOutUrl } },
            [this.deps.email],
            { ruleId: rule?.id ?? null, recipientId: r.id },
            summary,
          );
        }
      }
    }
  }

  /** Connection mode: does this journey's delay threaten the journey it feeds into? */
  private async connectionCheck(
    journey: EngineJourney,
    status: TrainStatus,
  ): Promise<AlertEvent | null> {
    const next = journey.connectsTo;
    if (!next) return null;
    try {
      const schedule = await this.deps.provider.getSchedule(next.trainNumber);
      const startDate = resolveStartDate(schedule, next.fromStationCode, next.journeyDate);
      const second = await this.deps.provider.getLiveStatus(next.trainNumber, startDate);
      if (!second) return null;
      const risk = connectionRisk(
        status,
        journey.toStationCode,
        second,
        next.fromStationCode,
        journey.connectionBufferMinutes,
      );
      return connectionEvent(risk, status, {
        journeyId: next.journeyId,
        trainNumber: next.trainNumber,
        stationCode: next.fromStationCode,
      });
    } catch {
      return null; // the second train's data is unavailable; try again next run
    }
  }

  private async deliver(
    n: OutgoingNotification,
    channels: NotificationChannel[],
    ids: { ruleId: string | null; recipientId: string | null },
    summary: RunSummary,
  ): Promise<void> {
    const logId = this.deps.store.claim({
      journeyId: n.journeyId,
      ruleId: ids.ruleId,
      recipientId: ids.recipientId,
      eventKey: n.eventKey,
      channel: channels.map((c) => c.name).join('+'),
    });
    if (!logId) {
      summary.duplicatesSkipped += 1;
      return;
    }
    try {
      for (const channel of channels) await channel.deliver(n);
      this.deps.store.markDelivered(logId, 'SENT');
      summary.notificationsSent += 1;
    } catch (err) {
      this.deps.store.markDelivered(
        logId,
        'FAILED',
        err instanceof Error ? err.message : String(err),
      );
      summary.errors.push(`delivery ${n.eventKey}: ${String(err)}`);
    }
  }
}

function insideWindow(
  schedule: TrainSchedule,
  startDate: string,
  j: EngineJourney,
  now: Date,
): boolean {
  // A long trip to the station starts the watch earlier, so "leave now" isn't missed.
  const before = Math.max(
    WINDOW_BEFORE_MIN,
    (j.travelTimeMinutes ?? 0) + j.leaveBufferMinutes + 90,
  );
  const from = schedule.stops.find((s) => s.code === j.fromStationCode);
  const to = schedule.stops.find((s) => s.code === j.toStationCode);
  if (!from || !to) return true; // can't tell; watch it
  const boardAt = istInstant(startDate, (from.departure ?? from.arrival)!, from.day);
  const arriveAt = istInstant(startDate, (to.arrival ?? to.departure)!, to.day);
  return (
    minutesBetween(now, boardAt) <= before && minutesBetween(arriveAt, now) <= WINDOW_AFTER_MIN
  );
}
