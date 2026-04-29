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
      tz              = COALESCE(tz, ?),
      end_tz          = COALESCE(end_tz, ?),
      day_date        = ?,
      start_time      = ?,
      end_time        = ?,
      title           = ?,
      location        = ?,
      hours           = COALESCE(hours, ?),
      cost            = COALESCE(cost, ?),
      confirmation    = COALESCE(confirmation, ?),
      attributes_json = ?,
      updated_at      = datetime('now')
    WHERE id = ?
  `);

  for (const item of items) {
    let attrs: Record<string, unknown> = {};
    try { attrs = JSON.parse(item.attributes_json) as Record<string, unknown>; }
    catch { skipped++; continue; }

    const def = defForKind(item.kind as ItemKind);
    if (!def.derive && !def.normalizeAttrs) { skipped++; continue; }

    // Run the kind's canonicalization pass over attrs (e.g. airline name
    // → IATA code) before deriving so backfilled rows pick up the same
    // normalization that runtime saves do.
    const normalized = def.normalizeAttrs ? def.normalizeAttrs(attrs) : attrs;
    const derived = def.derive ? def.derive(normalized, { start_time: item.start_time }) : {};
    const attrsChanged = JSON.stringify(normalized) !== item.attributes_json;

    // For derive-owning kinds (derivesTitle / derivesLocation / ownsTime),
    // the derived value WINS — that's the whole architecture. For other
    // kinds, only fill base columns that are null.
    const newTitle = def.derivesTitle ? (derived.title ?? item.title) : item.title;
    const newLocation = def.derivesLocation
      ? (derived.location ?? item.location)
      : (item.location ?? derived.location ?? null);
    const newDayDate = def.ownsTime && derived.day_date ? derived.day_date : item.day_date;
    const newStartTime = def.ownsTime
      ? (derived.start_time ?? null)
      : (item.start_time ?? derived.start_time ?? null);
    const newEndTime = def.ownsTime
      ? (derived.end_time ?? item.end_time ?? null)
      : (item.end_time ?? derived.end_time ?? null);

    const willUpdate =
      attrsChanged ||
      newTitle !== item.title ||
      newLocation !== item.location ||
      newDayDate !== item.day_date ||
      newStartTime !== item.start_time ||
      newEndTime !== item.end_time ||
      (derived.tz && !item.tz) ||
      (derived.end_tz && !item.end_tz) ||
      (derived.hours && !item.hours) ||
      (derived.cost && !item.cost) ||
      (derived.confirmation && !item.confirmation);

    if (!willUpdate) { skipped++; continue; }

    updateStmt.run(
      derived.tz ?? null,
      derived.end_tz ?? null,
      newDayDate,
      newStartTime,
      newEndTime,
      newTitle,
      newLocation,
      derived.hours ?? null,
      derived.cost ?? null,
      derived.confirmation ?? null,
      JSON.stringify(normalized),
      item.id,
    );

    updated++;
    console.log(`  ✓ item ${item.id} (${item.kind}) "${item.title}" → "${newTitle}"`);
  }

  console.log(`\nDone — ${updated} updated, ${skipped} skipped (already derived or no attrs).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
