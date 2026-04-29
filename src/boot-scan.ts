import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from './db/index.js';
import type { ReferenceDocRow, UserRow } from './types.js';
import { queueParse } from './ai/parsePdf.js';

/**
 * On server boot:
 * 1. Scan `data/uploads/` for PDFs not yet tracked in `reference_docs`
 *    and create pending rows for them. This handles the operator dropping
 *    sample PDFs into the uploads folder directly, before any real user
 *    has uploaded anything through the UI.
 * 2. Recover any docs left in `pending` or `running` from a previous
 *    session — the server may have restarted mid-parse, which would
 *    otherwise leave those docs stuck forever.
 *
 * If no user exists yet, new rows are not created (since `uploaded_by` is
 * NOT NULL). The scan runs again on the next boot, after signup.
 */
export function scanExistingUploads(db: DB, dataDir: string): number {
  const uploadDir = join(dataDir, 'uploads');
  let files: string[] = [];
  try {
    files = readdirSync(uploadDir).filter((f) => f.toLowerCase().endsWith('.pdf'));
  } catch {
    // `data/uploads/` doesn't exist yet — nothing to scan, but we still
    // want to run the stale-parse recovery below.
  }

  const firstUser = db.prepare<[], UserRow>('SELECT * FROM users ORDER BY id ASC LIMIT 1').get();

  let created = 0;
  if (firstUser && files.length > 0) {
    const known = new Set(
      db
        .prepare<[], { stored_filename: string }>('SELECT stored_filename FROM reference_docs')
        .all()
        .map((r) => r.stored_filename),
    );

    for (const file of files) {
      if (known.has(file)) continue;
      const now = new Date().toISOString();
      const info = db
        .prepare(
          `INSERT INTO reference_docs (trip_id, title, kind, source_filename, stored_filename, parse_status, uploaded_by, uploaded_at)
           VALUES (NULL, ?, 'other', ?, ?, 'pending', ?, ?)`,
        )
        .run(deriveTitle(file), file, file, firstUser.id, now);
      const id = Number(info.lastInsertRowid);
      const doc = db
        .prepare<[number], ReferenceDocRow>('SELECT * FROM reference_docs WHERE id = ?')
        .get(id)!;
      queueParse(db, doc, uploadDir);
      created += 1;
    }
  }

  // Recover docs stuck in pending/running from a prior boot. Reset them
  // to pending (so queueParse does the status flip) and re-queue.
  const stuck = db
    .prepare<
      [],
      ReferenceDocRow
    >(`SELECT * FROM reference_docs WHERE parse_status IN ('pending', 'running')`)
    .all();
  if (stuck.length > 0) {
    db.prepare(
      `UPDATE reference_docs SET parse_status = 'pending', parse_error = NULL
       WHERE parse_status IN ('pending', 'running')`,
    ).run();
    for (const doc of stuck) {
      // queueParse is a no-op if no API key is configured; the row stays
      // pending and the next boot will try again.
      queueParse(db, doc, uploadDir);
    }
  }

  return created;
}

function deriveTitle(filename: string): string {
  return filename
    .replace(/\.pdf$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}
