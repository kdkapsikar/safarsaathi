import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { migrate } from './migrate.js';

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

export { migrate } from './migrate.js';
