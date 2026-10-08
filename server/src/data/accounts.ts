import type { Db } from '../db/index.js';
import { newId, nowIso } from './util.js';

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: string;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  name: r.name,
  email: r.email,
  createdAt: r.created_at,
});

export class EmailTakenError extends Error {
  constructor() {
    super('Email already registered');
  }
}

/**
 * Accounts and sessions. These are the only unscoped lookups: they run before a
 * user is authenticated, and they resolve *which* user_id the rest of the app uses.
 */
export function createAccountStore(db: Db) {
  const insertUser = db.prepare(
    'INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const userByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const userById = db.prepare('SELECT * FROM users WHERE id = ?');

  const insertSession = db.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
  );
  const sessionUser = db.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  );
  const deleteSession = db.prepare('DELETE FROM sessions WHERE id = ?');
  const deleteExpired = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

  return {
    createUser(input: { name: string; email: string; passwordHash: string }): User {
      const row: UserRow = {
        id: newId(),
        name: input.name,
        email: input.email,
        password_hash: input.passwordHash,
        created_at: nowIso(),
      };
      try {
        insertUser.run(row.id, row.name, row.email, row.password_hash, row.created_at);
      } catch (err) {
        if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new EmailTakenError();
        }
        throw err;
      }
      return toUser(row);
    },

    findUserForLogin(email: string): (User & { passwordHash: string }) | null {
      const r = userByEmail.get(email) as UserRow | undefined;
      return r ? { ...toUser(r), passwordHash: r.password_hash } : null;
    },

    getUser(id: string): User | null {
      const r = userById.get(id) as UserRow | undefined;
      return r ? toUser(r) : null;
    },

    createSession(input: {
      tokenHash: string;
      userId: string;
      expiresAt: Date;
      userAgent?: string;
    }): void {
      insertSession.run(
        input.tokenHash,
        input.userId,
        nowIso(),
        input.expiresAt.toISOString(),
        input.userAgent?.slice(0, 255) ?? null,
      );
    },

    userForSession(tokenHash: string, now = new Date()): User | null {
      const r = sessionUser.get(tokenHash, now.toISOString()) as UserRow | undefined;
      return r ? toUser(r) : null;
    },

    deleteSession(tokenHash: string): void {
      deleteSession.run(tokenHash);
    },

    deleteExpiredSessions(now = new Date()): number {
      return deleteExpired.run(now.toISOString()).changes;
    },
  };
}

export type AccountStore = ReturnType<typeof createAccountStore>;
