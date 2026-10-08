import { istDate } from '../schemas/dates.js';

/** In-memory sliding-window limiter (per process; fine for a single server). */
export class HourlyLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly windowMs = 60 * 60_000) {}

  /** Records a hit and returns whether it's within `limit`. */
  allow(key: string, limit: number, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

/** Daily token budget across all users: the assistant's cost cap. */
export class DailyTokenBudget {
  private day = '';
  private used = 0;
  constructor(private readonly cap: number) {}

  private roll(now: Date) {
    const today = istDate(now);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
  }

  exhausted(now = new Date()): boolean {
    this.roll(now);
    return this.used >= this.cap;
  }

  record(tokens: number, now = new Date()): void {
    this.roll(now);
    this.used += tokens;
  }

  get usedToday(): number {
    return this.used;
  }
}
