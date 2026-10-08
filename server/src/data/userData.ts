import type { Db } from '../db/index.js';
import { ALERT_TYPES } from '../schemas/journey.js';
import type {
  AddRecipientInput,
  AlertType,
  CreateJourneyInput,
  JourneySettings,
  UpdateAlertRuleInput,
} from '../schemas/journey.js';
import { newId, nowIso, randomToken } from './util.js';

export class DuplicateRecipientError extends Error {
  constructor() {
    super('That email is already on this journey.');
  }
}

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; message?: string };
  return e.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/.test(e.message ?? '');
};

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
  /** Smart rules, "leave now" and connection settings. */
  settings: JourneySettings;
  /** Secret for the invite link, if one is active. Only ever shown to the owner. */
  inviteToken: string | null;
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

export type ProposalKind = 'CREATE_JOURNEY' | 'DELETE_JOURNEY';

export interface Proposal {
  id: string;
  kind: ProposalKind;
  payload: unknown;
  summary: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  createdAt: string;
  expiresAt: string;
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
  alertTypes: r.alert_types
    ? ((r.alert_types as string).split(',') as AlertType[]).sort(
        (a, b) => ALERT_TYPES.indexOf(a) - ALERT_TYPES.indexOf(b),
      )
    : [],
  settings: {
    minDelayMinutes: r.min_delay_minutes ?? null,
    quietHoursStart: r.quiet_hours_start ?? null,
    quietHoursEnd: r.quiet_hours_end ?? null,
    travelTimeMinutes: r.travel_time_minutes ?? null,
    leaveBufferMinutes: r.leave_buffer_minutes ?? 15,
    connectsToJourneyId: r.connects_to_journey_id ?? null,
    connectionBufferMinutes: r.connection_buffer_minutes ?? 30,
  },
  inviteToken: r.invite_token ?? null,
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
  SELECT j.*,
    (SELECT group_concat(type) FROM alert_rules WHERE journey_id = j.id) AS alert_types,
    (SELECT min_delay_minutes FROM alert_rules WHERE journey_id = j.id AND type = 'DELAY') AS min_delay_minutes,
    (SELECT quiet_hours_start FROM alert_rules WHERE journey_id = j.id AND quiet_hours_start IS NOT NULL LIMIT 1) AS quiet_hours_start,
    (SELECT quiet_hours_end FROM alert_rules WHERE journey_id = j.id AND quiet_hours_end IS NOT NULL LIMIT 1) AS quiet_hours_end
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

    /**
     * Saves smart rules ("leave now", connection, quiet hours on every alert
     * type, delay threshold on the delay alert). The connection target must be
     * another of this user's journeys.
     */
    updateSettings(
      journeyId: string,
      settings: JourneySettings,
    ): Journey | 'NOT_FOUND' | 'BAD_CONNECTION' {
      if (!ownsJourney(journeyId)) return 'NOT_FOUND';
      const target = settings.connectsToJourneyId;
      if (target && (target === journeyId || !ownsJourney(target))) return 'BAD_CONNECTION';
      db.transaction(() => {
        db.prepare(
          `UPDATE journeys SET travel_time_minutes = ?, leave_buffer_minutes = ?,
             connects_to_journey_id = ?, connection_buffer_minutes = ?
           WHERE id = ? AND user_id = ?`,
        ).run(
          settings.travelTimeMinutes,
          settings.leaveBufferMinutes,
          target,
          settings.connectionBufferMinutes,
          journeyId,
          userId,
        );
        db.prepare(
          `UPDATE alert_rules SET quiet_hours_start = ?, quiet_hours_end = ? WHERE journey_id = ?`,
        ).run(settings.quietHoursStart, settings.quietHoursEnd, journeyId);
        db.prepare(
          `UPDATE alert_rules SET min_delay_minutes = ? WHERE journey_id = ? AND type = 'DELAY'`,
        ).run(settings.minDelayMinutes, journeyId);
      })();
      return this.get(journeyId)!;
    },

    /** Turns the invite link on (new secret each time) or off. Null if not this user's journey. */
    setInvite(journeyId: string, enabled: boolean): { inviteToken: string | null } | null {
      if (!ownsJourney(journeyId)) return null;
      const token = enabled ? randomToken(18) : null;
      db.prepare('UPDATE journeys SET invite_token = ? WHERE id = ? AND user_id = ?').run(
        token,
        journeyId,
        userId,
      );
      return { inviteToken: token };
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
        opt_out_token: randomToken(24),
        opted_out_at: null,
        created_at: nowIso(),
      };
      const insert = db.prepare(
        `INSERT INTO recipients (id, journey_id, name, email, channel, opt_out_token, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      try {
        insert.run(
          row.id,
          row.journey_id,
          row.name,
          row.email,
          row.channel,
          row.opt_out_token,
          row.created_at,
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw new DuplicateRecipientError();
        throw err;
      }
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

    markAllRead(): number {
      return db
        .prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
        .run(nowIso(), userId).changes;
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
        .prepare('SELECT * FROM chat_messages WHERE chat_session_id = ? ORDER BY created_at, rowid')
        .all(chatSessionId)
        .map((r) => {
          const m = r as {
            id: string;
            role: ChatMessage['role'];
            content_json: string;
            created_at: string;
          };
          return {
            id: m.id,
            role: m.role,
            content: JSON.parse(m.content_json),
            createdAt: m.created_at,
          };
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
      return {
        id: row.id,
        role: message.role,
        content: message.content,
        createdAt: row.created_at,
      };
    },

    deleteSession(chatSessionId: string): boolean {
      return (
        db
          .prepare('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?')
          .run(chatSessionId, userId).changes > 0
      );
    },
  };

  /* eslint-disable @typescript-eslint/no-explicit-any -- raw SQLite rows */
  const toProposal = (r: any): Proposal => ({
    id: r.id,
    kind: r.kind,
    payload: JSON.parse(r.payload_json),
    summary: r.summary,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const proposals = {
    create(kind: ProposalKind, payload: unknown, summary: string, ttlMinutes = 30): Proposal {
      const now = new Date();
      const row = {
        id: newId(),
        kind,
        payload_json: JSON.stringify(payload),
        summary,
        status: 'PENDING',
        created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
      };
      db.prepare(
        `INSERT INTO assistant_proposals (id, user_id, kind, payload_json, summary, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.id,
        userId,
        row.kind,
        row.payload_json,
        row.summary,
        row.status,
        row.created_at,
        row.expires_at,
      );
      return toProposal(row);
    },

    /** A pending, unexpired proposal of this user's, or null. */
    getPending(proposalId: string, now = new Date()): Proposal | null {
      const r = db
        .prepare(
          `SELECT * FROM assistant_proposals
           WHERE id = ? AND user_id = ? AND status = 'PENDING' AND expires_at > ?`,
        )
        .get(proposalId, userId, now.toISOString());
      return r ? toProposal(r) : null;
    },

    /** Moves a pending proposal to CONFIRMED/CANCELLED; false if it wasn't pending or isn't mine. */
    resolve(proposalId: string, status: 'CONFIRMED' | 'CANCELLED'): boolean {
      return (
        db
          .prepare(
            `UPDATE assistant_proposals SET status = ?
             WHERE id = ? AND user_id = ? AND status = 'PENDING'`,
          )
          .run(status, proposalId, userId).changes > 0
      );
    },
  };

  return { userId, journeys, alertRules, recipients, notifications, chat, proposals };
}

export type UserData = ReturnType<typeof createUserData>;
