import { addMinutes, systemClock, type Clock } from '../time.js';
import {
  ProviderError,
  type ProviderCapabilities,
  type TrainDataProvider,
  type TrainSchedule,
  type TrainStatus,
  type TrainSummary,
} from '../types.js';
import { simulateStatus, type ScenarioId } from './scenarios.js';
import { MOCK_TIMETABLES } from './timetables.js';

/** A clock the simulator can move: real time plus an adjustable offset. */
export class SimClock implements Clock {
  private offsetMs = 0;
  constructor(private readonly base: Clock = systemClock) {}

  now(): Date {
    return new Date(this.base.now().getTime() + this.offsetMs);
  }
  get offsetMinutes(): number {
    return Math.round(this.offsetMs / 60_000);
  }
  advance(minutes: number): void {
    this.offsetMs += minutes * 60_000;
  }
  set(at: Date): void {
    this.offsetMs = at.getTime() - this.base.now().getTime();
  }
  reset(): void {
    this.offsetMs = 0;
  }
}

/** How the simulated data source behaves, to exercise retries and the circuit breaker. */
export type SourceHealth = 'HEALTHY' | 'SLOW' | 'DOWN';

export const DEFAULT_SCENARIOS: Record<string, ScenarioId> = {
  '12951': 'GROWING_DELAY',
  '12301': 'PLATFORM_CHANGE',
  '12627': 'ON_TIME',
  '12002': 'ON_TIME',
};

export class MockProvider implements TrainDataProvider {
  readonly name = 'simulator';
  readonly clock: SimClock;
  health: SourceHealth = 'HEALTHY';
  /** Delay for SLOW health; longer than the default timeout. */
  slowMs = 10_000;
  private readonly scenarios = new Map<string, ScenarioId>(Object.entries(DEFAULT_SCENARIOS));
  private readonly timetables = new Map(MOCK_TIMETABLES.map((t) => [t.trainNumber, t]));

  constructor(clock = new SimClock()) {
    this.clock = clock;
  }

  capabilities(): ProviderCapabilities {
    return {
      liveStatus: true,
      schedule: true,
      platforms: true,
      coachPosition: false,
      trainsBetween: true,
    };
  }

  trains(): TrainSchedule[] {
    return [...this.timetables.values()];
  }

  scenarioFor(trainNumber: string): ScenarioId {
    return this.scenarios.get(trainNumber) ?? 'ON_TIME';
  }

  setScenario(trainNumber: string, scenario: ScenarioId): boolean {
    if (!this.timetables.has(trainNumber)) return false;
    this.scenarios.set(trainNumber, scenario);
    return true;
  }

  async getLiveStatus(trainNumber: string, startDate: string): Promise<TrainStatus | null> {
    await this.behave();
    const schedule = this.timetables.get(trainNumber);
    if (!schedule) return null;
    return simulateStatus(schedule, startDate, this.scenarioFor(trainNumber), this.clock.now());
  }

  async getSchedule(trainNumber: string): Promise<TrainSchedule | null> {
    await this.behave();
    return this.timetables.get(trainNumber) ?? null;
  }

  async trainsBetween(fromCode: string, toCode: string, date: string): Promise<TrainSummary[]> {
    await this.behave();
    const out: TrainSummary[] = [];
    for (const t of this.timetables.values()) {
      const from = t.stops.findIndex((s) => s.code === fromCode);
      const to = t.stops.findIndex((s) => s.code === toCode);
      if (from < 0 || to <= from) continue;
      const status = simulateStatus(t, date, 'ON_TIME', this.clock.now());
      out.push({
        trainNumber: t.trainNumber,
        trainName: t.trainName,
        from: { code: fromCode, departure: status.stations[from]!.scheduledDeparture! },
        to: { code: toCode, arrival: status.stations[to]!.scheduledArrival! },
      });
    }
    return out.sort((a, b) => a.from.departure.localeCompare(b.from.departure));
  }

  /** The instant `minutesBefore` the train's scheduled departure on `startDate`. */
  beforeDeparture(trainNumber: string, startDate: string, minutesBefore: number): Date | null {
    const t = this.timetables.get(trainNumber);
    if (!t) return null;
    const dep = simulateStatus(t, startDate, 'ON_TIME', this.clock.now()).stations[0]!
      .scheduledDeparture!;
    return addMinutes(new Date(dep), -minutesBefore);
  }

  private async behave(): Promise<void> {
    if (this.health === 'DOWN') {
      throw new ProviderError('UNAVAILABLE', 'Simulated data source is down.');
    }
    if (this.health === 'SLOW') await new Promise((r) => setTimeout(r, this.slowMs));
  }
}
