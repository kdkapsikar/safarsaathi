import type { Db } from '../db/index.js';
import type { AddRecipientInput } from '../schemas/journey.js';
import { DuplicateRecipientError } from './userData.js';
import { newId, nowIso, randomToken } from './util.js';

export interface InviteInfo {
  trainNumber: string;
  fromStationCode: string;
  toStationCode: string;
  journeyDate: string;
  /** First name only, so a link leaks as little as possible. */
  ownerFirstName: string;
}

export interface OptOutInfo {
  recipientName: string;
  trainNumber: string;
  fromStationCode: string;
  toStationCode: string;
  journeyDate: string;
  optedOut: boolean;
}

/**
 * The two things reachable without signing in, each by an unguessable token
 * that the journey owner (invite) or the recipient (opt-out) holds. They expose
 * only the fields above, never ids, emails or other journeys.
 */
export function createPublicLinks(db: Db) {
  const inviteRow = (token: string) =>
    db
      .prepare(
        `SELECT j.id, j.train_number, j.from_station_code, j.to_station_code, j.journey_date, u.name
         FROM journeys j JOIN users u ON u.id = j.user_id
         WHERE j.invite_token = ? AND j.status = 'ACTIVE'`,
      )
      .get(token) as Record<string, string> | undefined;

  const optOutRow = (token: string) =>
    db
      .prepare(
        `SELECT r.name, r.opted_out_at, j.train_number, j.from_station_code, j.to_station_code, j.journey_date
         FROM recipients r JOIN journeys j ON j.id = r.journey_id WHERE r.opt_out_token = ?`,
      )
      .get(token) as Record<string, string | null> | undefined;

  return {
    inviteInfo(token: string): InviteInfo | null {
      const r = inviteRow(token);
      return r
        ? {
            trainNumber: r['train_number']!,
            fromStationCode: r['from_station_code']!,
            toStationCode: r['to_station_code']!,
            journeyDate: r['journey_date']!,
            ownerFirstName: r['name']!.split(' ')[0]!,
          }
        : null;
    },

    /** Adds the visitor as a recipient. Null if the link is invalid or switched off. */
    join(token: string, input: AddRecipientInput): { name: string } | null {
      const r = inviteRow(token);
      if (!r) return null;
      try {
        db.prepare(
          `INSERT INTO recipients (id, journey_id, name, email, channel, opt_out_token, created_at)
           VALUES (?, ?, ?, ?, 'EMAIL', ?, ?)`,
        ).run(newId(), r['id'], input.name, input.email, randomToken(24), nowIso());
      } catch (err) {
        const e = err as { code?: string; message?: string };
        if (
          e.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
          /UNIQUE constraint failed/.test(e.message ?? '')
        ) {
          throw new DuplicateRecipientError();
        }
        throw err;
      }
      return { name: input.name };
    },

    optOutInfo(token: string): OptOutInfo | null {
      const r = optOutRow(token);
      return r
        ? {
            recipientName: r['name']!,
            trainNumber: r['train_number']!,
            fromStationCode: r['from_station_code']!,
            toStationCode: r['to_station_code']!,
            journeyDate: r['journey_date']!,
            optedOut: r['opted_out_at'] !== null,
          }
        : null;
    },

    /** Stops alerts for this recipient. Idempotent; false if the token is unknown. */
    optOut(token: string): boolean {
      return (
        db
          .prepare(
            'UPDATE recipients SET opted_out_at = coalesce(opted_out_at, ?) WHERE opt_out_token = ?',
          )
          .run(nowIso(), token).changes > 0
      );
    },
  };
}

export type PublicLinks = ReturnType<typeof createPublicLinks>;
