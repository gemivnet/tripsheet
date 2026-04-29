import type { DB } from './db/index.js';
import { defForKind } from './itemKinds/index.js';
import type { ItemKind } from './types.js';
import { generateUniqueTripSlug } from './slug.js';

/**
 * Assign URL-safe slugs to any pre-existing trips that don't have one
 * yet. Slugs are required for the SPA's "open this trip via URL" flow,
 * so without backfill, a trip created before the migration would never
 * get one. Idempotent.
 */
export function backfillTripSlugs(db: DB): { updated: number } {
  const rows = db
    .prepare<[], { id: number }>(`SELECT id FROM trips WHERE slug IS NULL`)
    .all();
  if (rows.length === 0) return { updated: 0 };
  const update = db.prepare('UPDATE trips SET slug = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const r of rows) update.run(generateUniqueTripSlug(db), r.id);
  });
  tx();
  return { updated: rows.length };
}

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

/**
 * On every boot, walk every item and re-run the kind's
 * `normalizeAttrs` + `derive` pipeline. Items whose stored title /
 * location / day_date / start_time / end_time / attributes_json differ
 * from the freshly-derived values are updated in place.
 *
 * Idempotent — items already in their canonical form are skipped.
 * Resumable — interruption only means some rows haven't been touched
 * yet; the next boot picks up where we left off because matching rows
 * are no-ops.
 *
 * This exists because we keep adding new structured-attribute rules
 * (airline normalization, derivesTitle, derivesLocation, …) and existing
 * trips need to pick them up automatically — per CLAUDE.md, "Retroactive
 * by default."
 */
export function backfillItemDerivations(db: DB): { updated: number; scanned: number } {
  const items = db
    .prepare<[], ItemRow>(`
      SELECT id, kind, title, day_date, start_time, end_time, location,
             hours, cost, tz, end_tz, confirmation, attributes_json
      FROM items
      WHERE kind NOT IN ('option', 'note')
    `)
    .all();

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

  let updated = 0;
  const tx = db.transaction(() => {
    for (const item of items) {
      let attrs: Record<string, unknown> = {};
      try { attrs = JSON.parse(item.attributes_json) as Record<string, unknown>; }
      catch { continue; }

      const def = defForKind(item.kind as ItemKind);
      if (!def.derive && !def.normalizeAttrs) continue;

      const normalized = def.normalizeAttrs ? def.normalizeAttrs(attrs) : attrs;
      const derived = def.derive ? def.derive(normalized, { start_time: item.start_time }) : {};
      const newAttrsJson = JSON.stringify(normalized);

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

      const changed =
        newAttrsJson !== item.attributes_json ||
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
      if (!changed) continue;

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
        newAttrsJson,
        item.id,
      );
      updated++;
    }
  });
  tx();

  return { updated, scanned: items.length };
}
