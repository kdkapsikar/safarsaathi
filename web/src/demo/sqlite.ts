import initSqlJs, { type Database as SqlJsDatabase, type SqlValue } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { migrate } from '@safar-saathi/server/db/migrate';

const STORAGE_KEY = 'safar-saathi-demo-db';

type Params = unknown[];
const bindable = (params: Params): SqlValue[] =>
  params.map((p) =>
    p === undefined ? null : typeof p === 'boolean' ? Number(p) : (p as SqlValue),
  );

/** Rethrows SQLite errors with better-sqlite3's error codes, which the data layer checks. */
function translate(err: unknown): never {
  const e = err as Error & { code?: string };
  if (/UNIQUE constraint failed/.test(e.message)) e.code = 'SQLITE_CONSTRAINT_UNIQUE';
  throw e;
}

/**
 * The slice of better-sqlite3's API that the server's data layer uses, on top
 * of sql.js (SQLite compiled to WebAssembly). Lets the GitHub Pages demo run
 * the real data-access code, migrations and alert engine in the browser.
 */
let savingDisabled = false;

export class BrowserDb {
  private depth = 0;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly db: SqlJsDatabase) {}

  prepare(sql: string) {
    const run = (...params: Params) => {
      try {
        this.db.run(sql, bindable(params));
      } catch (err) {
        translate(err);
      }
      const changes = this.db.getRowsModified();
      this.scheduleSave();
      return { changes, lastInsertRowid: 0 };
    };
    const all = (...params: Params): Record<string, unknown>[] => {
      const stmt = this.db.prepare(sql);
      try {
        stmt.bind(bindable(params));
        const rows: Record<string, unknown>[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
      } catch (err) {
        return translate(err);
      } finally {
        stmt.free();
      }
    };
    return { run, all, get: (...params: Params) => all(...params)[0] };
  }

  exec(sql: string): this {
    this.db.exec(sql);
    this.scheduleSave();
    return this;
  }

  pragma(): void {}

  /** Same contract as better-sqlite3: returns a function that runs `fn` atomically. Nests via savepoints. */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A) => {
      const name = `sp${this.depth++}`;
      this.db.exec(`SAVEPOINT ${name}`);
      try {
        const result = fn(...args);
        this.db.exec(`RELEASE ${name}`);
        return result;
      } catch (err) {
        this.db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
        throw err;
      } finally {
        this.depth -= 1;
        this.scheduleSave();
      }
    };
  }

  /** Persists to localStorage shortly after writes. */
  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 150);
  }

  saveNow(): void {
    if (savingDisabled) return;
    try {
      const bytes = this.db.export();
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      localStorage.setItem(STORAGE_KEY, btoa(binary));
    } catch {
      // Storage full or blocked (private mode): the demo still works for this visit.
    }
  }
}

function restore(): Uint8Array | undefined {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return undefined;
    return Uint8Array.from(atob(saved), (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
}

export function clearSavedDb(): void {
  savingDisabled = true;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing saved */
  }
}

export async function openBrowserDb(): Promise<BrowserDb> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  let raw: SqlJsDatabase;
  try {
    raw = new SQL.Database(restore());
  } catch {
    raw = new SQL.Database();
  }
  raw.exec('PRAGMA foreign_keys = ON');
  const db = new BrowserDb(raw);
  migrate(db as never);
  return db;
}
