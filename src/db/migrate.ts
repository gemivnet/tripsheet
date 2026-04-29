import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, dbPath, type DB } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, 'migrations');

/**
 * Apply all pending migrations in filename order. Migrations are raw `.sql`
 * files; each one runs inside a transaction. A `schema_migrations` table
 * records which files have been applied so re-runs are no-ops.
 */
export function migrate(db: DB, migrationsDir: string = MIGRATIONS_DIR): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare<[], { filename: string }>('SELECT filename FROM schema_migrations')
      .all()
      .map((r) => r.filename),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const newlyApplied: string[] = [];
  const recordMigration = db.prepare(
    'INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)',
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.exec(sql);
      recordMigration.run(file, now);
    });
    tx();
    newlyApplied.push(file);
  }

  return newlyApplied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = process.env.DATA_DIR ?? './data';
  const db = openDb(dbPath(dataDir));
  const applied = migrate(db);
  if (applied.length === 0) {
    console.log('No pending migrations.');
  } else {
    console.log(`Applied ${applied.length} migration(s):`);
    for (const f of applied) console.log(`  ✓ ${f}`);
  }
}
