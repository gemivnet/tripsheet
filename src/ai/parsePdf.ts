import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DB } from '../db/index.js';
import type { ItemRow, ReferenceDocKind, ReferenceDocRow, TripRow } from '../types.js';
import { ITEM_KINDS } from '../types.js';
import { writeAudit } from '../audit.js';
import { createTrip, createItem } from '../routes/trips.js';
import { callMessages, hasAnthropicKey } from './client.js';

const here = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(join(here, '..', 'prompts', 'parse-pdf.md'), 'utf-8');

const DOC_KINDS = [
  'past_itinerary',
  'journal',
  'external_itinerary',
  'confirmation',
  'other',
] as const satisfies readonly ReferenceDocKind[];

const TripMetaSchema = z
  .object({
    name: z.string().min(1).max(200),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    destination: z.string().max(200).nullable().optional(),
  })
  .nullable()
  .optional();

const ParsedSchema = z.object({
  doc_kind: z.enum(DOC_KINDS).default('other'),
  summary: z.string(),
  trip: TripMetaSchema,
  items: z.array(
    z.object({
      day_offset: z.number().int().nullable().optional(),
      day_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      kind: z.string(),
      title: z.string(),
      start_time: z.string().nullable().optional(),
      end_time: z.string().nullable().optional(),
      location: z.string().nullable().optional(),
      url: z.string().nullable().optional(),
      confirmation: z.string().nullable().optional(),
      hours: z.string().nullable().optional(),
      cost: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      tags: z.array(z.string()).default([]),
      tz: z.string().max(60).nullable().optional(),
      end_tz: z.string().max(60).nullable().optional(),
      // Kind-specific structured attributes (airline, venue_name, etc.)
      attributes: z.record(z.unknown()).optional(),
    }),
  ),
});

type ParsedItem = z.infer<typeof ParsedSchema>['items'][number];

/**
 * Kick off a background parse for a newly-uploaded reference doc. Returns
 * immediately; the caller writes a `pending` row to the DB and the parse
 * task will flip it to `complete` or `error` when done.
 *
 * If no ANTHROPIC_API_KEY is configured, the doc stays in `pending` until
 * the operator adds one and re-triggers.
 *
 * When the doc is trip-scoped (`doc.trip_id` is set), the parse also emits
 * `add_item` suggestions so the user can swipe the imported items into
 * the trip. When the doc is library-wide, the parse stores
 * `reference_items` used as context for future AI runs.
 */
export function queueParse(db: DB, doc: ReferenceDocRow, uploadDir: string): void {
  if (!hasAnthropicKey()) return;

  db.prepare(`UPDATE reference_docs SET parse_status = 'running', parse_error = NULL WHERE id = ?`)
    .run(doc.id);

  void parseDoc(db, doc, uploadDir).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[parsePdf] doc ${doc.id} "${doc.title}" failed: ${msg}`);
    db.prepare(`UPDATE reference_docs SET parse_status = 'error', parse_error = ? WHERE id = ?`)
      .run(msg, doc.id);
  });
}

async function parseDoc(db: DB, doc: ReferenceDocRow, uploadDir: string): Promise<void> {
  const trip = doc.trip_id
    ? db.prepare<[number], TripRow>('SELECT * FROM trips WHERE id = ?').get(doc.trip_id) ?? null
    : null;

  const fileBytes = readFileSync(join(uploadDir, doc.stored_filename));
  const base64 = fileBytes.toString('base64');

  const promptLines: string[] = [`Parse this document. Title: ${doc.title}.`];
  if (trip) {
    promptLines.push(
      '',
      'Trip context (this document was uploaded inside a specific trip — align items to real calendar dates when possible):',
      `- Trip name: ${trip.name}`,
      `- Dates: ${trip.start_date} → ${trip.end_date}`,
    );
    if (trip.destination) promptLines.push(`- Destination: ${trip.destination}`);
    if (trip.goals) promptLines.push(`- Goals: ${trip.goals}`);
  } else {
    promptLines.push('', 'No trip context — this is a library-wide reference doc.');
  }

  const response = await callMessages<Anthropic.Messages.Message>('parsePdf', {
    max_tokens: 16_384,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          },
          { type: 'text', text: promptLines.join('\n') },
        ],
      },
    ],
  });

  const text = extractText(response);
  const jsonStr = extractJsonBlob(text);
  const parsed = ParsedSchema.parse(JSON.parse(jsonStr));

  const tripMeta = parsed.trip ?? null;
  const tripMetaJson = tripMeta ? JSON.stringify(tripMeta) : null;

  // Clear stale derived state from any prior parse so reparses are
  // idempotent. We don't delete the *items* a prior parse may have
  // built (the user may have edited them); we only drop reference_items
  // (pure parse output) and unbind the derived_trip pointer so the new
  // routing branch has a clean slate.
  db.prepare('DELETE FROM reference_items WHERE doc_id = ?').run(doc.id);
  db.prepare(
    `UPDATE reference_docs SET parsed_summary = ?, kind = ?, parsed_trip_json = ?, derived_trip_id = NULL, parse_status = 'complete' WHERE id = ?`,
  ).run(parsed.summary, parsed.doc_kind, tripMetaJson, doc.id);

  // If this doc previously built a trip and that trip still exists,
  // skip re-building. Otherwise the routing branch is free to act.
  if (doc.derived_trip_id != null) {
    const stillThere = db
      .prepare<[number], { id: number }>('SELECT id FROM trips WHERE id = ?')
      .get(doc.derived_trip_id);
    if (stillThere) {
      db.prepare('UPDATE reference_docs SET derived_trip_id = ? WHERE id = ?').run(
        doc.derived_trip_id,
        doc.id,
      );
      return;
    }
  }

  if (trip) {
    routeTripScopedDoc(db, doc, trip, parsed);
  } else {
    routeLibraryDoc(db, doc, parsed);
  }
}

/**
 * Library upload routing (no trip context). Itineraries with parsed
 * trip metadata auto-build a new trip + items. Everything else lands in
 * the reference-items memory cache for future AI context.
 */
function routeLibraryDoc(
  db: DB,
  doc: ReferenceDocRow,
  parsed: z.infer<typeof ParsedSchema>,
): void {
  const isItinerary =
    parsed.doc_kind === 'external_itinerary' || parsed.doc_kind === 'past_itinerary';
  if (isItinerary && parsed.trip) {
    buildTripFromDoc(db, doc, parsed.trip, parsed.items);
    return;
  }
  storeAsReferenceItems(db, doc, parsed.items);
}

/**
 * Trip-scoped upload routing. Confirmations try to attach to an existing
 * matching item; if none match, fall through to a single suggestion.
 * Itineraries land in the swipe deck. Journals/notes/other go to the
 * reference cache so they don't pollute the deck.
 */
function routeTripScopedDoc(
  db: DB,
  doc: ReferenceDocRow,
  trip: TripRow,
  parsed: z.infer<typeof ParsedSchema>,
): void {
  if (parsed.doc_kind === 'confirmation') {
    attachConfirmationToTrip(db, doc, trip, parsed.items);
    return;
  }
  if (parsed.doc_kind === 'external_itinerary' || parsed.doc_kind === 'past_itinerary') {
    emitTripImportSuggestions(db, doc, trip, parsed.items);
    return;
  }
  storeAsReferenceItems(db, doc, parsed.items);
}

function storeAsReferenceItems(db: DB, doc: ReferenceDocRow, items: ParsedItem[]): void {
  const insert = db.prepare(
    `INSERT INTO reference_items (doc_id, day_offset, kind, title, location, notes, tags_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const item of items) {
      insert.run(
        doc.id,
        item.day_offset ?? null,
        item.kind,
        item.title,
        item.location ?? null,
        item.notes ?? null,
        JSON.stringify(item.tags),
      );
    }
  })();
}

/**
 * Build a brand-new trip from a parsed itinerary, applying every item
 * directly (no swipe deck). Each item carries `source_doc_id` so the UI
 * can show a paperclip back to the source PDF.
 */
function buildTripFromDoc(
  db: DB,
  doc: ReferenceDocRow,
  tripMeta: NonNullable<z.infer<typeof ParsedSchema>['trip']>,
  items: ParsedItem[],
): void {
  const userId = doc.uploaded_by;
  const newTrip = createTrip(
    db,
    {
      name: tripMeta.name,
      start_date: tripMeta.start_date,
      end_date: tripMeta.end_date,
      destination: tripMeta.destination ?? null,
    },
    userId,
  );

  db.prepare('UPDATE reference_docs SET derived_trip_id = ? WHERE id = ?').run(newTrip.id, doc.id);

  let order = 0;
  for (const item of items) {
    const dayDate = resolveDayDate(item, newTrip);
    createItem(
      db,
      newTrip.id,
      {
        day_date: dayDate,
        kind: normalizeItemKind(item.kind),
        title: item.title,
        start_time: item.start_time ?? null,
        end_time: item.end_time ?? null,
        location: item.location ?? null,
        url: item.url ?? null,
        confirmation: item.confirmation ?? null,
        hours: item.hours ?? null,
        cost: item.cost ?? null,
        notes: item.notes ?? null,
        sort_order: order++,
        source_doc_id: doc.id,
        tz: item.tz ?? null,
        end_tz: item.end_tz ?? null,
      },
      userId,
    );
  }
}

/**
 * Confirmation upload routing. For each parsed item we try to find a
 * matching existing item in the trip (same kind, near-same day, fuzzy
 * title overlap). On match, fill in confirmation/url/notes from the doc
 * and link source_doc_id. On miss, fall through to a swipe-deck
 * suggestion that carries source_doc_id forward when accepted.
 */
function attachConfirmationToTrip(
  db: DB,
  doc: ReferenceDocRow,
  trip: TripRow,
  items: ParsedItem[],
): void {
  const tripItems = db
    .prepare<[number], ItemRow>('SELECT * FROM items WHERE trip_id = ?')
    .all(trip.id);

  const unmatched: ParsedItem[] = [];

  for (const parsedItem of items) {
    const targetKind = normalizeItemKind(parsedItem.kind);
    const targetDate = resolveDayDate(parsedItem, trip);
    const match = findMatchingItem(tripItems, targetKind, targetDate, parsedItem.title);
    if (match) {
      attachDocToItem(db, doc, match, parsedItem);
    } else {
      unmatched.push(parsedItem);
    }
  }

  if (unmatched.length > 0) {
    emitTripImportSuggestions(db, doc, trip, unmatched);
  }
}

/**
 * Find a trip item that plausibly corresponds to a parsed confirmation
 * line. Match strategy: same kind, day within +/-1, and either a
 * lowercase substring overlap on title (>= 4 chars) or an exact
 * normalized title equality. Returns the first hit.
 */
function findMatchingItem(
  tripItems: ItemRow[],
  kind: string,
  dayDate: string,
  title: string,
): ItemRow | null {
  const normTitle = normalizeTitle(title);
  if (!normTitle) return null;
  for (const item of tripItems) {
    if (item.kind !== kind) continue;
    if (Math.abs(daysBetween(item.day_date, dayDate)) > 1) continue;
    const itemTitle = normalizeTitle(item.title);
    if (!itemTitle) continue;
    if (itemTitle === normTitle) return item;
    if (normTitle.length >= 4 && itemTitle.includes(normTitle)) return item;
    if (itemTitle.length >= 4 && normTitle.includes(itemTitle)) return item;
  }
  return null;
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(a + 'T12:00:00').getTime() - new Date(b + 'T12:00:00').getTime();
  return Math.round(ms / 86_400_000);
}

function attachDocToItem(
  db: DB,
  doc: ReferenceDocRow,
  item: ItemRow,
  parsedItem: ParsedItem,
): void {
  const now = new Date().toISOString();
  const before = { ...item };
  const next = {
    confirmation: item.confirmation ?? parsedItem.confirmation ?? null,
    url: item.url ?? parsedItem.url ?? null,
    notes: item.notes ?? parsedItem.notes ?? null,
    source_doc_id: doc.id,
  };
  db.transaction(() => {
    db.prepare(
      `UPDATE items SET confirmation = ?, url = ?, notes = ?, source_doc_id = ?, updated_at = ? WHERE id = ?`,
    ).run(next.confirmation, next.url, next.notes, next.source_doc_id, now, item.id);
    writeAudit(db, {
      user_id: doc.uploaded_by,
      entity: 'item',
      entity_id: item.id,
      action: 'update',
      diff: { before, after: { ...before, ...next, updated_at: now }, source_doc_id: doc.id },
    });
  })();
}

/**
 * For a trip-scoped import, convert each parsed item into a pending
 * `add_item` suggestion so the user can accept/reject it in the swipe
 * deck. day_date is resolved from the item's own `day_date` when present,
 * otherwise from `day_offset` + trip start, otherwise clamped to the
 * trip's start date.
 */
function emitTripImportSuggestions(
  db: DB,
  doc: ReferenceDocRow,
  trip: TripRow,
  items: ParsedItem[],
): void {
  if (items.length === 0) return;

  const batchId = randomUUID();
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO suggestions (trip_id, batch_id, kind, target_item_id, payload_json, rationale, citations_json, status, created_at)
     VALUES (?, ?, 'add_item', NULL, ?, ?, '[]', 'pending', ?)`,
  );

  for (const item of items) {
    const dayDate = resolveDayDate(item, trip);
    const itemKind = normalizeItemKind(item.kind);
    const payload: Record<string, unknown> = {
      day_date: dayDate,
      kind: itemKind,
      title: item.title,
      start_time: item.start_time ?? null,
      end_time: item.end_time ?? null,
      location: item.location ?? null,
      url: item.url ?? null,
      confirmation: item.confirmation ?? null,
      hours: item.hours ?? null,
      cost: item.cost ?? null,
      notes: item.notes ?? null,
      source_doc_id: doc.id,
      tz: item.tz ?? null,
      end_tz: item.end_tz ?? null,
      // Pass through kind-specific structured attrs so applyDerivation can
      // populate timezones, locations, and times from them on acceptance.
      ...(item.attributes && Object.keys(item.attributes).length > 0
        ? { attributes: item.attributes }
        : {}),
    };
    const rationale = `Imported from "${doc.title}".`;
    const info = insert.run(
      trip.id,
      batchId,
      JSON.stringify(payload),
      rationale,
      now,
    );
    writeAudit(db, {
      user_id: doc.uploaded_by,
      entity: 'suggestion',
      entity_id: Number(info.lastInsertRowid),
      action: 'create',
      diff: { source_doc_id: doc.id, kind: itemKind, day_date: dayDate },
    });
  }
}

function resolveDayDate(item: ParsedItem, trip: TripRow): string {
  if (item.day_date && withinRange(item.day_date, trip.start_date, trip.end_date)) {
    return item.day_date;
  }
  if (item.day_offset && item.day_offset > 0) {
    const start = new Date(trip.start_date + 'T12:00:00');
    start.setDate(start.getDate() + item.day_offset - 1);
    const iso = start.toISOString().slice(0, 10);
    if (withinRange(iso, trip.start_date, trip.end_date)) return iso;
  }
  return trip.start_date;
}

function withinRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function normalizeItemKind(raw: string): string {
  const lower = raw.toLowerCase();
  if ((ITEM_KINDS as readonly string[]).includes(lower)) return lower;
  // Map common parse-time labels back onto the app's canonical set.
  if (lower === 'lodging' || lower === 'hotel' || lower === 'stay') return 'checkin';
  if (lower === 'flight' || lower === 'train' || lower === 'drive' || lower === 'transfer') return 'transit';
  if (lower === 'meal' || lower === 'restaurant' || lower === 'dining') return 'reservation';
  return 'activity';
}

/**
 * Pull the JSON object out of a model response. Tolerates:
 *  - bare JSON
 *  - a closed ```json ... ``` fence
 *  - a half-closed ```json fence (output truncated by max_tokens)
 *  - prose preamble before the object
 * Falls back to the substring between the first `{` and last `}`.
 */
function extractJsonBlob(text: string): string {
  const closed = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (closed) return closed[1].trim();
  const halfOpen = text.match(/```(?:json)?\s*([\s\S]*)$/);
  if (halfOpen) return halfOpen[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) return text.slice(first, last + 1).trim();
  return text.trim();
}

function extractText(response: unknown): string {
  const r = response as { content?: Array<{ type: string; text?: string }> };
  const blocks = r.content ?? [];
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

import type Anthropic from '@anthropic-ai/sdk';
export type { Anthropic };
