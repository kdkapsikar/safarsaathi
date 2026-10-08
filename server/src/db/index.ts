import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { migrations as defaultMigrations, type Migration } from './migrations.js';

export type Db = Database.Database;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export function openDatabase(path: string): Db {
  const isMemory = path === ':memory:';
  const file = isMemory || isAbsolute(path) ? path : resolve(repoRoot, path);
  if (!isMemory) mkdirSync(dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  if (!isMemory) db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  migrate(db);
  return db;
}

export function migrate(db: Db, migrations: Migration[] = defaultMigrations): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    db
      .prepare('SELECT id FROM schema_migrations')
      .all()
      .map((r) => (r as { id: number }).id),
  );

  const ran: number[] = [];
  for (const m of [...migrations].sort((a, b) => a.id - b.id)) {
    if (applied.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        m.id,
        m.name,
        new Date().toISOString(),
      );
    })();
    ran.push(m.id);
  }
  return ran;
}
