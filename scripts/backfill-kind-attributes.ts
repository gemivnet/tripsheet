/**
 * Backfill: re-derive base fields (tz, location, start_time, end_time,
 * hours, cost, confirmation) from each item's attributes_json using
 * the current kind `derive()` functions.
 *
 * Also migrates legacy confirmation values stored inside attributes_json
 * (flight `confirmation`, reservation `reservation_number`) to the base
 * `items.confirmation` column.
 *
 * Idempotent + resumable — safe to re-run, safe to interrupt.
 * Never overwrites a non-null base column with a derived value
 * (user-authored values always win).
 *
 * Usage:
 *   yarn tsx scripts/backfill-kind-attributes.ts
 */
import { openDb, dbPath } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { defForKind } from '../src/itemKinds/index.js';
import type { ItemKind } from '../src/types.js';

interface ItemRow {
  id: number;
  kind: string;
  title: string;
  day_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  hours: string | null;
  cost: string | null;
  tz: string | null;
  end_tz: string | null;
  confirmation: string | null;
  attributes_json: string;
}

async function main(): Promise<void> {
  const dataDir = process.env.DATA_DIR ?? './data';
  const db = openDb(dbPath(dataDir));
  migrate(db);

  const items = db
    .prepare<[], ItemRow>(`
      SELECT id, kind, title, day_date, start_time, end_time, location,
             hours, cost, tz, end_tz, confirmation, attributes_json
      FROM items
      WHERE kind NOT IN ('option', 'note')
    `)
    .all();

  let updated = 0;
  let skipped = 0;

  const updateStmt = db.prepare(`
    UPDATE items SET
      tz           = COALESCE(tz, ?),
      end_tz       = COALESCE(end_tz, ?),
      day_date     = COALESCE(?, day_date),
      start_time   = COALESCE(start_time, ?),
      end_time     = COALESCE(end_time, ?),
      location     = COALESCE(location, ?),
      hours        = COALESCE(hours, ?),
      cost         = COALESCE(cost, ?),
      confirmation = COALESCE(confirmation, ?),
      updated_at   = datetime('now')
    WHERE id = ?
  `);

  for (const item of items) {
    let attrs: Record<string, unknown> = {};
    try { attrs = JSON.parse(item.attributes_json) as Record<string, unknown>; }
    catch { skipped++; continue; }

    const def = defForKind(item.kind as ItemKind);
    if (!def.derive) { skipped++; continue; }

    const derived = def.derive(attrs, { start_time: item.start_time });

    // Only apply fields where the derived value is non-null and the current
    // base column is null (user values always win).
    const willUpdate =
      (derived.tz && !item.tz) ||
      (derived.end_tz && !item.end_tz) ||
      (derived.day_date && item.day_date !== derived.day_date) ||
      (derived.start_time && !item.start_time) ||
      (derived.end_time && !item.end_time) ||
      (derived.location && !item.location) ||
      (derived.hours && !item.hours) ||
      (derived.cost && !item.cost) ||
      (derived.confirmation && !item.confirmation);

    if (!willUpdate) { skipped++; continue; }

    updateStmt.run(
      derived.tz ?? null,
      derived.end_tz ?? null,
      derived.day_date ?? null,
      derived.start_time ?? null,
      derived.end_time ?? null,
      derived.location ?? null,
      derived.hours ?? null,
      derived.cost ?? null,
      derived.confirmation ?? null,
      item.id,
    );

    updated++;
    console.log(`  ✓ item ${item.id} (${item.kind}) "${item.title}"`);
  }

  console.log(`\nDone — ${updated} updated, ${skipped} skipped (already derived or no attrs).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
