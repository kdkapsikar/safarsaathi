export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/**
 * Append-only. Never edit a migration that has shipped; add a new one.
 * Timestamps are ISO-8601 UTC strings. IDs are UUIDs generated in the app.
 */
export const migrations: Migration[] = [
  {
    id: 1,
    name: 'initial_schema',
    sql: /* sql */ `
      CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );

      -- id is the SHA-256 of the cookie token, so a leaked DB can't be replayed as cookies.
      CREATE TABLE sessions (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   TEXT NOT NULL,
        expires_at   TEXT NOT NULL,
        user_agent   TEXT
      );
      CREATE INDEX sessions_user_id ON sessions(user_id);
      CREATE INDEX sessions_expires_at ON sessions(expires_at);

      CREATE TABLE journeys (
        id                TEXT PRIMARY KEY,
        user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        train_number      TEXT NOT NULL,
        from_station_code TEXT NOT NULL,
        from_station_name TEXT,
        to_station_code   TEXT NOT NULL,
        to_station_name   TEXT,
        journey_date      TEXT NOT NULL,           -- YYYY-MM-DD (IST calendar date)
        status            TEXT NOT NULL DEFAULT 'ACTIVE'
                          CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
        created_at        TEXT NOT NULL
      );
      CREATE INDEX journeys_user_created ON journeys(user_id, created_at DESC);
      CREATE INDEX journeys_train_date ON journeys(train_number, journey_date);

      CREATE TABLE alert_rules (
        id                TEXT PRIMARY KEY,
        journey_id        TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
        type              TEXT NOT NULL
                          CHECK (type IN ('DEPARTURE', 'ARRIVAL', 'DELAY', 'PLATFORM_CHANGE')),
        min_delay_minutes INTEGER CHECK (min_delay_minutes IS NULL OR min_delay_minutes >= 0),
        quiet_hours_start TEXT,                    -- HH:MM IST, both or neither
        quiet_hours_end   TEXT,
        channel           TEXT NOT NULL DEFAULT 'IN_APP' CHECK (channel IN ('IN_APP', 'EMAIL')),
        created_at        TEXT NOT NULL,
        UNIQUE (journey_id, type),
        CHECK ((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL))
      );

      CREATE TABLE recipients (
        id            TEXT PRIMARY KEY,
        journey_id    TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        email         TEXT NOT NULL COLLATE NOCASE,
        channel       TEXT NOT NULL DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL')),
        opt_out_token TEXT NOT NULL UNIQUE,
        opted_out_at  TEXT,
        created_at    TEXT NOT NULL,
        UNIQUE (journey_id, email)
      );

      -- Delivery log. recipient_id NULL means the journey owner.
      CREATE TABLE notification_log (
        id           TEXT PRIMARY KEY,
        journey_id   TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
        rule_id      TEXT REFERENCES alert_rules(id) ON DELETE SET NULL,
        recipient_id TEXT REFERENCES recipients(id) ON DELETE CASCADE,
        event_key    TEXT NOT NULL,
        channel      TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
        error        TEXT,
        created_at   TEXT NOT NULL,
        sent_at      TEXT
      );
      -- Dedupe. COALESCE because SQLite treats NULLs as distinct in UNIQUE constraints.
      CREATE UNIQUE INDEX notification_log_dedupe
        ON notification_log(journey_id, COALESCE(recipient_id, ''), event_key);

      -- Public train data, not user-owned.
      CREATE TABLE train_snapshots (
        id           TEXT PRIMARY KEY,
        train_number TEXT NOT NULL,
        journey_date TEXT NOT NULL,
        status_json  TEXT NOT NULL,
        fetched_at   TEXT NOT NULL,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX train_snapshots_lookup ON train_snapshots(train_number, journey_date, created_at DESC);

      -- In-app notification feed for the journey owner.
      CREATE TABLE notifications (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        journey_id TEXT REFERENCES journeys(id) ON DELETE SET NULL,
        event_key  TEXT NOT NULL,
        title      TEXT NOT NULL,
        body       TEXT NOT NULL,
        read_at    TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX notifications_user_created ON notifications(user_id, created_at DESC);

      CREATE TABLE chat_sessions (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX chat_sessions_user_updated ON chat_sessions(user_id, updated_at DESC);

      CREATE TABLE chat_messages (
        id              TEXT PRIMARY KEY,
        chat_session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
        content_json    TEXT NOT NULL,
        created_at      TEXT NOT NULL
      );
      CREATE INDEX chat_messages_session_created ON chat_messages(chat_session_id, created_at);
    `,
  },
  {
    id: 2,
    name: 'assistant_proposals',
    sql: /* sql */ `
      -- Write actions the assistant proposes. Nothing happens until the user
      -- clicks Confirm in the UI; the server then runs the stored payload.
      CREATE TABLE assistant_proposals (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind         TEXT NOT NULL CHECK (kind IN ('CREATE_JOURNEY', 'DELETE_JOURNEY')),
        payload_json TEXT NOT NULL,
        summary      TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED')),
        created_at   TEXT NOT NULL,
        expires_at   TEXT NOT NULL
      );
      CREATE INDEX assistant_proposals_user ON assistant_proposals(user_id, created_at DESC);
    `,
  },
];
