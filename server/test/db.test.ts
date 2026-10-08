import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../src/db/index.js';

const EXPECTED_TABLES = [
  'alert_rules',
  'assistant_proposals',
  'chat_messages',
  'chat_sessions',
  'journeys',
  'notification_log',
  'notifications',
  'recipients',
  'schema_migrations',
  'sessions',
  'train_snapshots',
  'users',
];

function seedJourney(db: ReturnType<typeof openDatabase>) {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO users VALUES ('u1', 'A', 'a@example.com', 'h', ?)").run(now);
  db.prepare(
    `INSERT INTO journeys (id, user_id, train_number, from_station_code, to_station_code, journey_date, created_at)
     VALUES ('j1', 'u1', '12951', 'MMCT', 'NDLS', '2026-10-09', ?)`,
  ).run(now);
  db.prepare(
    `INSERT INTO recipients (id, journey_id, name, email, opt_out_token, created_at)
     VALUES ('r1', 'j1', 'Driver', 'd@example.com', 't1', ?)`,
  ).run(now);
  return now;
}

describe('database', () => {
  it('creates every table', () => {
    const db = openDatabase(':memory:');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(EXPECTED_TABLES);
  });

  it('is safe to migrate twice', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db)).toEqual([]);
  });

  it('enforces foreign keys and cascades journey deletes', () => {
    const db = openDatabase(':memory:');
    seedJourney(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO journeys (id, user_id, train_number, from_station_code, to_station_code, journey_date, created_at)
           VALUES ('j2', 'missing-user', '1', 'A', 'B', '2026-01-01', 'x')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);

    db.prepare("DELETE FROM journeys WHERE id = 'j1'").run();
    expect(db.prepare('SELECT count(*) AS n FROM recipients').get()).toEqual({ n: 0 });
  });

  describe('notification_log dedupe on (journey_id, recipient_id, event_key)', () => {
    const insert = (
      db: ReturnType<typeof openDatabase>,
      id: string,
      recipient: string | null,
      key: string,
    ) =>
      db
        .prepare(
          `INSERT INTO notification_log (id, journey_id, recipient_id, event_key, channel, created_at)
           VALUES (?, 'j1', ?, ?, 'EMAIL', 'now')`,
        )
        .run(id, recipient, key);

    it('rejects a duplicate for the same recipient', () => {
      const db = openDatabase(':memory:');
      seedJourney(db);
      insert(db, 'n1', 'r1', 'DELAY:30');
      expect(() => insert(db, 'n2', 'r1', 'DELAY:30')).toThrow(/UNIQUE/);
    });

    it('rejects a duplicate for the owner (NULL recipient)', () => {
      const db = openDatabase(':memory:');
      seedJourney(db);
      insert(db, 'n1', null, 'DELAY:30');
      expect(() => insert(db, 'n2', null, 'DELAY:30')).toThrow(/UNIQUE/);
    });

    it('allows the same event for different recipients', () => {
      const db = openDatabase(':memory:');
      seedJourney(db);
      insert(db, 'n1', null, 'DELAY:30');
      expect(() => insert(db, 'n2', 'r1', 'DELAY:30')).not.toThrow();
    });
  });
});
