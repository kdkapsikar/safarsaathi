import type { Db } from '../db/index.js';
import type { AlertType } from '../schemas/journey.js';
import type { TrainStatus } from '../trains/types.js';
import { newId, nowIso } from './util.js';

export interface EngineRule {
  id: string;
  type: AlertType;
  minDelayMinutes: number | null;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  channel: 'IN_APP' | 'EMAIL';
}

export interface EngineJourney {
  id: string;
  userId: string;
  ownerName: string;
  ownerEmail: string;
  trainNumber: string;
  fromStationCode: string;
  toStationCode: string;
  journeyDate: string;
  rules: EngineRule[];
}

interface RuleRow {
  id: string;
  type: AlertType;
  min_delay_minutes: number | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  channel: 'IN_APP' | 'EMAIL';
}

export interface EngineRecipient {
  id: string;
  name: string;
  email: string;
}

/**
 * System-level data access for the alert engine ONLY. Unlike data.forUser(),
 * this reads across all users: the engine has to find every journey on a
 * train. It is never handed to request handlers or the assistant, and every
 * write it makes is addressed to the journey's own owner or recipients.
 */
export function createEngineStore(db: Db) {
  return {
    /** Active journeys whose boarding date falls in [fromDate, toDate]. */
    candidateJourneys(fromDate: string, toDate: string): EngineJourney[] {
      const rows = db
        .prepare(
          `SELECT j.id, j.user_id, u.name AS owner_name, u.email AS owner_email, j.train_number,
                  j.from_station_code, j.to_station_code, j.journey_date
           FROM journeys j JOIN users u ON u.id = j.user_id
           WHERE j.status = 'ACTIVE' AND j.journey_date BETWEEN ? AND ?`,
        )
        .all(fromDate, toDate) as Record<string, string>[];
      const rulesFor = db.prepare('SELECT * FROM alert_rules WHERE journey_id = ?');
      return rows.map((r) => ({
        id: r.id!,
        userId: r.user_id!,
        ownerName: r.owner_name!,
        ownerEmail: r.owner_email!,
        trainNumber: r.train_number!,
        fromStationCode: r.from_station_code!,
        toStationCode: r.to_station_code!,
        journeyDate: r.journey_date!,
        rules: (rulesFor.all(r.id) as RuleRow[]).map((x) => ({
          id: x.id,
          type: x.type,
          minDelayMinutes: x.min_delay_minutes,
          quietHoursStart: x.quiet_hours_start,
          quietHoursEnd: x.quiet_hours_end,
          channel: x.channel,
        })),
      }));
    },

    activeRecipients(journeyId: string): EngineRecipient[] {
      return db
        .prepare(
          'SELECT id, name, email FROM recipients WHERE journey_id = ? AND opted_out_at IS NULL',
        )
        .all(journeyId) as EngineRecipient[];
    },

    latestSnapshot(trainNumber: string, startDate: string): TrainStatus | null {
      const row = db
        .prepare(
          `SELECT status_json FROM train_snapshots WHERE train_number = ? AND journey_date = ?
           ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        )
        .get(trainNumber, startDate) as { status_json: string } | undefined;
      return row ? (JSON.parse(row.status_json) as TrainStatus) : null;
    },

    /** Stores the latest status and keeps only that one per train run. */
    saveSnapshot(status: TrainStatus): void {
      db.transaction(() => {
        db.prepare(
          `INSERT INTO train_snapshots (id, train_number, journey_date, status_json, fetched_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          newId(),
          status.trainNumber,
          status.startDate,
          JSON.stringify(status),
          status.fetchedAt,
          nowIso(),
        );
        db.prepare(
          `DELETE FROM train_snapshots WHERE train_number = ? AND journey_date = ?
           AND rowid NOT IN (SELECT rowid FROM train_snapshots WHERE train_number = ? AND journey_date = ?
                             ORDER BY created_at DESC, rowid DESC LIMIT 1)`,
        ).run(status.trainNumber, status.startDate, status.trainNumber, status.startDate);
      })();
    },

    /**
     * Claims (journey, recipient, event) for delivery. Returns the log id, or
     * null if it was already claimed: this is what makes runs idempotent.
     */
    claim(input: {
      journeyId: string;
      ruleId: string | null;
      recipientId: string | null;
      eventKey: string;
      channel: string;
    }): string | null {
      const id = newId();
      const res = db
        .prepare(
          `INSERT OR IGNORE INTO notification_log (id, journey_id, rule_id, recipient_id, event_key, channel, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.journeyId,
          input.ruleId,
          input.recipientId,
          input.eventKey,
          input.channel,
          nowIso(),
        );
      return res.changes > 0 ? id : null;
    },

    markDelivered(logId: string, status: 'SENT' | 'FAILED', error?: string): void {
      db.prepare('UPDATE notification_log SET status = ?, error = ?, sent_at = ? WHERE id = ?').run(
        status,
        error ?? null,
        nowIso(),
        logId,
      );
    },

    addInAppNotification(input: {
      userId: string;
      journeyId: string;
      eventKey: string;
      title: string;
      body: string;
    }): void {
      db.prepare(
        `INSERT INTO notifications (id, user_id, journey_id, event_key, title, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId(),
        input.userId,
        input.journeyId,
        input.eventKey,
        input.title,
        input.body,
        nowIso(),
      );
    },
  };
}

export type EngineStore = ReturnType<typeof createEngineStore>;
