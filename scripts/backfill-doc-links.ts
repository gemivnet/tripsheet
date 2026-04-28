/**
 * Backfill: re-route existing reference_docs through the new import
 * logic introduced in migration 0002. Idempotent + resumable — safe to
 * re-run, safe to interrupt.
 *
 * What it does:
 * - For each library-scoped itinerary doc (`trip_id IS NULL`,
 *   `kind IN ('external_itinerary','past_itinerary')`,
 *   `parse_status='complete'`, `derived_trip_id IS NULL`,
 *   `parsed_trip_json IS NULL`) → re-queue the parse so the new prompt
 *   extracts trip metadata and the new routing branch builds a trip.
 *
 * What it does NOT do:
 * - Re-attach historical confirmations to existing items. The original
 *   parse already emitted swipe-deck suggestions which the user
 *   accepted/rejected; rewriting that history would be lossy.
 *
 * Usage:
 *   yarn tsx scripts/backfill-doc-links.ts
 */
import { openDb, dbPath } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { queueParse } from '../src/ai/parsePdf.js';
import type { ReferenceDocRow } from '../src/types.js';

async function main(): Promise<void> {
  const dataDir = process.env.DATA_DIR ?? './data';
  const db = openDb(dbPath(dataDir));
  migrate(db);

  const candidates = db
    .prepare<[], ReferenceDocRow>(
      `SELECT * FROM reference_docs
        WHERE trip_id IS NULL
          AND parse_status = 'complete'
          AND derived_trip_id IS NULL
          AND parsed_trip_json IS NULL
          AND kind IN ('external_itinerary', 'past_itinerary')
        ORDER BY id`,
    )
    .all();

  if (candidates.length === 0) {
    console.log('Nothing to backfill — no library itineraries are missing trip linkage.');
    return;
  }

  console.log(`Re-routing ${candidates.length} library itinerary doc(s) through the new importer…`);
  const uploadDir = `${dataDir}/uploads`;
  for (const doc of candidates) {
    console.log(`  • doc #${doc.id} "${doc.title}" — re-queueing parse`);
    queueParse(db, doc, uploadDir);
  }
  console.log('Queued. The parses run async; check the Reference library in the UI for "Open the trip built from this PDF" links as they complete.');
}

void main();
