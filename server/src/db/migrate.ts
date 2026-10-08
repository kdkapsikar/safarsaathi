import { migrations as defaultMigrations, type Migration } from './migrations.js';

/** The subset of better-sqlite3 the migrator needs, so the browser demo can reuse it. */
interface MigratableDb {
  exec(sql: string): unknown;
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
  transaction(fn: () => void): () => void;
}

export function migrate(db: MigratableDb, migrations: Migration[] = defaultMigrations): number[] {
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
