import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = Database.Database;

let instance: DB | undefined;

/**
 * Open (or return the cached) SQLite handle. Enables WAL mode for better
 * concurrent-read performance and enforces foreign keys so the schema's
 * cascades actually fire.
 *
 * Tests pass `:memory:` to get an isolated DB per suite.
 */
export function openDb(path: string): DB {
  if (instance?.name === path) return instance;
  if (instance) instance.close();

  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  instance = db;
  return db;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = undefined;
  }
}

export function dbPath(dataDir: string): string {
  return `${dataDir}/tripsheet.db`;
}
