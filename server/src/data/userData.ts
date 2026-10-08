import { randomBytes } from 'node:crypto';
import type { Db } from '../db/index.js';
import type {
  AddRecipientInput,
  AlertType,
  CreateJourneyInput,
  UpdateAlertRuleInput,
} from '../schemas/journey.js';
import { newId, nowIso } from './util.js';

export interface Journey {
  id: string;
  trainNumber: string;
  fromStationCode: string;
  fromStationName: string | null;
  toStationCode: string;
  toStationName: string | null;
  journeyDate: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  alertTypes: AlertType[];
  createdAt: string;
}

export interface AlertRule {
  id: string;
  journeyId: string;
  type: AlertType;
  minDelayMinutes: number | null;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  channel: 'IN_APP' | 'EMAIL';
}

export interface Recipient {
  id: string;
  journeyId: string;
  name: string;
  email: string;
  channel: 'EMAIL';
  optedOut: boolean;
  createdAt: string;
}

export interface Notification {
  id: string;
  journeyId: string | null;
  eventKey: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: unknown;
  createdAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- raw SQLite rows */
const toJourney = (r: any): Journey => ({
  id: r.id,
  trainNumber: r.train_number,
  fromStationCode: r.from_station_code,
  fromStationName: r.from_station_name,
  toStationCode: r.to_station_code,
  toStationName: r.to_station_name,
  journeyDate: r.journey_date,
  status: r.status,
  alertTypes: r.alert_types ? (r.alert_types as string).split(',').sort() as AlertType[] : [],
  createdAt: r.created_at,
});
const toRule = (r: any): AlertRule => ({
  id: r.id,
  journeyId: r.journey_id,
  type: r.type,
  minDelayMinutes: r.min_delay_minutes,
  quietHoursStart: r.quiet_hours_start,
  quietHoursEnd: r.quiet_hours_end,
  channel: r.channel,
});
const toRecipient = (r: any): Recipient => ({
  id: r.id,
  journeyId: r.journey_id,
  name: r.name,
  email: r.email,
  channel: r.channel,
  optedOut: r.opted_out_at !== null,
  createdAt: r.created_at,
});
const toNotification = (r: any): Notification => ({
  id: r.id,
  journeyId: r.journey_id,
  eventKey: r.event_key,
  title: r.title,
  body: r.body,
  readAt: r.read_at,
  createdAt: r.created_at,
});
const toChatSession = (r: any): ChatSession => ({
  id: r.id,
  title: r.title,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const JOURNEY_SELECT = `
  SELECT j.*, (SELECT group_concat(type) FROM alert_rules WHERE journey_id = j.id) AS alert_types
  FROM journeys j`;

/**
 * The data-access layer for everything a user owns.
 *
 * Every query filters by the `userId` bound here, directly or through the
 * owning journey / chat session. Callers can't pass a different user_id, so a
 * route or assistant tool can only ever reach the signed-in user's rows.
 * Rows owned by someone else look exactly like rows that don't exist (null/false).
 */
export function createUserData(db: Db, userId: string) {
  const ownsJourney = (journeyId: string): boolean =>
    db.prepare('SELECT 1 FROM journeys WHERE id = ? AND user_id = ?').get(journeyId, userId) !==
    undefined;

  const journeys = {
    /** Newest first. */
    list(): Journey[] {
      return db
        .prepare(`${JOURNEY_SELECT} WHERE j.user_id = ? ORDER BY j.created_at DESC, j.rowid DESC`)
        .all(userId)
        .map(toJourney);
    },

    get(journeyId: string): Journey | null {
      const r = db
        .prepare(`${JOURNEY_SELECT} WHERE j.id = ? AND j.user_id = ?`)
        .get(journeyId, userId);
      return r ? toJourney(r) : null;
    },

    create(input: CreateJourneyInput): Journey {
      const id = newId();
      const createdAt = nowIso();
      db.transaction(() => {
        db.prepare(
          `INSERT INTO journeys (id, user_id, train_number, from_station_code, from_station_name,
             to_station_code, to_station_name, journey_date, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          userId,
          input.trainNumber,
          input.fromStationCode,
          input.fromStationName ?? null,
          input.toStationCode,
          input.toStationName ?? null,
          input.journeyDate,
          createdAt,
        );
        const insertRule = db.prepare(
          'INSERT INTO alert_rules (id, journey_id, type, created_at) VALUES (?, ?, ?, ?)',
        );
        for (const type of input.alertTypes) insertRule.run(newId(), id, type, createdAt);
      })();
      return this.get(id)!;
    },

    /** Returns false if the journey doesn't exist or isn't this user's. */
    delete(journeyId: string): boolean {
      return (
        db.prepare('DELETE FROM journeys WHERE id = ? AND user_id = ?').run(journeyId, userId)
          .changes > 0
      );
    },
  };

  const alertRules = {
    listForJourney(journeyId: string): AlertRule[] | null {
      if (!ownsJourney(journeyId)) return null;
      return db
        .prepare('SELECT * FROM alert_rules WHERE journey_id = ? ORDER BY type')
        .all(journeyId)
        .map(toRule);
    },

    update(ruleId: string, patch: UpdateAlertRuleInput): AlertRule | null {
      const owned = db
        .prepare(
          `SELECT r.* FROM alert_rules r JOIN journeys j ON j.id = r.journey_id
           WHERE r.id = ? AND j.user_id = ?`,
        )
        .get(ruleId, userId);
      if (!owned) return null;
      const current = toRule(owned);
      const next = {
        minDelayMinutes:
          patch.minDelayMinutes !== undefined ? patch.minDelayMinutes : current.minDelayMinutes,
        quietHoursStart:
          patch.quietHoursStart !== undefined ? patch.quietHoursStart : current.quietHoursStart,
        quietHoursEnd:
          patch.quietHoursEnd !== undefined ? patch.quietHoursEnd : current.quietHoursEnd,
        channel: patch.channel ?? current.channel,
      };
      db.prepare(
        `UPDATE alert_rules SET min_delay_minutes = ?, quiet_hours_start = ?, quiet_hours_end = ?, channel = ?
         WHERE id = ? AND journey_id IN (SELECT id FROM journeys WHERE user_id = ?)`,
      ).run(
        next.minDelayMinutes,
        next.quietHoursStart,
        next.quietHoursEnd,
        next.channel,
        ruleId,
        userId,
      );
      return { ...current, ...next };
    },
  };

  const recipients = {
    listForJourney(journeyId: string): Recipient[] | null {
      if (!ownsJourney(journeyId)) return null;
      return db
        .prepare('SELECT * FROM recipients WHERE journey_id = ? ORDER BY created_at')
        .all(journeyId)
        .map(toRecipient);
    },

    add(journeyId: string, input: AddRecipientInput): Recipient | null {
      if (!ownsJourney(journeyId)) return null;
      const row = {
        id: newId(),
        journey_id: journeyId,
        name: input.name,
        email: input.email,
        channel: 'EMAIL',
        opt_out_token: randomBytes(24).toString('base64url'),
        opted_out_at: null,
        created_at: nowIso(),
      };
      db.prepare(
        `INSERT INTO recipients (id, journey_id, name, email, channel, opt_out_token, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.id,
        row.journey_id,
        row.name,
        row.email,
        row.channel,
        row.opt_out_token,
        row.created_at,
      );
      return toRecipient(row);
    },

    remove(recipientId: string): boolean {
      return (
        db
          .prepare(
            `DELETE FROM recipients WHERE id = ?
             AND journey_id IN (SELECT id FROM journeys WHERE user_id = ?)`,
          )
          .run(recipientId, userId).changes > 0
      );
    },
  };

  const notifications = {
    list(limit = 50): Notification[] {
      return db
        .prepare(
          'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
        )
        .all(userId, limit)
        .map(toNotification);
    },

    unreadCount(): number {
      return (
        db
          .prepare('SELECT count(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL')
          .get(userId) as { n: number }
      ).n;
    },

    markRead(notificationId: string): boolean {
      return (
        db
          .prepare(
            'UPDATE notifications SET read_at = coalesce(read_at, ?) WHERE id = ? AND user_id = ?',
          )
          .run(nowIso(), notificationId, userId).changes > 0
      );
    },
  };

  const ownsChat = (chatSessionId: string): boolean =>
    db
      .prepare('SELECT 1 FROM chat_sessions WHERE id = ? AND user_id = ?')
      .get(chatSessionId, userId) !== undefined;

  const chat = {
    createSession(title?: string): ChatSession {
      const now = nowIso();
      const row = { id: newId(), title: title ?? null, created_at: now, updated_at: now };
      db.prepare(
        'INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run(row.id, userId, row.title, row.created_at, row.updated_at);
      return toChatSession(row);
    },

    listSessions(): ChatSession[] {
      return db
        .prepare('SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC')
        .all(userId)
        .map(toChatSession);
    },

    getMessages(chatSessionId: string): ChatMessage[] | null {
      if (!ownsChat(chatSessionId)) return null;
      return db
        .prepare(
          'SELECT * FROM chat_messages WHERE chat_session_id = ? ORDER BY created_at, rowid',
        )
        .all(chatSessionId)
        .map((r) => {
          const m = r as { id: string; role: ChatMessage['role']; content_json: string; created_at: string };
          return { id: m.id, role: m.role, content: JSON.parse(m.content_json), createdAt: m.created_at };
        });
    },

    appendMessage(
      chatSessionId: string,
      message: { role: ChatMessage['role']; content: unknown },
    ): ChatMessage | null {
      if (!ownsChat(chatSessionId)) return null;
      const row = { id: newId(), created_at: nowIso() };
      db.transaction(() => {
        db.prepare(
          'INSERT INTO chat_messages (id, chat_session_id, role, content_json, created_at) VALUES (?, ?, ?, ?, ?)',
        ).run(row.id, chatSessionId, message.role, JSON.stringify(message.content), row.created_at);
        db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ? AND user_id = ?').run(
          row.created_at,
          chatSessionId,
          userId,
        );
      })();
      return { id: row.id, role: message.role, content: message.content, createdAt: row.created_at };
    },

    deleteSession(chatSessionId: string): boolean {
      return (
        db
          .prepare('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?')
          .run(chatSessionId, userId).changes > 0
      );
    },
  };

  return { userId, journeys, alertRules, recipients, notifications, chat };
}

export type UserData = ReturnType<typeof createUserData>;
