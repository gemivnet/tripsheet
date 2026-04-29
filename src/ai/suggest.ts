import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DB } from '../db/index.js';
import type { Config } from '../config.js';
import type {
  ItemRow,
  ReferenceDocRow,
  ReferenceItemRow,
  SuggestionRow,
  TripRow,
} from '../types.js';
import { callMessages } from './client.js';

const here = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(join(here, '..', 'prompts', 'suggest.md'), 'utf-8');

const CitationSchema = z.object({ url: z.string(), title: z.string() });
const SuggestionSchema = z.object({
  kind: z.enum(['add_item', 'modify_item', 'remove_item', 'note']),
  target_item_id: z.number().int().nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
  rationale: z.string(),
  citations: z.array(CitationSchema).default([]),
});
const ResponseSchema = z.object({ suggestions: z.array(SuggestionSchema) });

/**
 * Run a single "Research & suggest" pass for a trip: gather context,
 * call Claude with web search + extended thinking, validate, persist
 * suggestions, return the inserted rows.
 */
export async function runSuggest(db: DB, config: Config, tripId: number): Promise<SuggestionRow[]> {
  const trip = db.prepare<[number], TripRow>('SELECT * FROM trips WHERE id = ?').get(tripId);
  if (!trip) throw new Error(`Trip ${tripId} not found`);

  const items = db
    .prepare<
      [number],
      ItemRow
    >('SELECT * FROM items WHERE trip_id = ? ORDER BY day_date, sort_order, id')
    .all(tripId);

  const refDocs = db
    .prepare<
      [number],
      ReferenceDocRow
    >(`SELECT * FROM reference_docs WHERE parse_status = 'complete' AND (trip_id IS NULL OR trip_id = ?) ORDER BY uploaded_at DESC LIMIT 6`)
    .all(tripId);

  const refItemsByDoc = new Map<number, ReferenceItemRow[]>();
  for (const doc of refDocs) {
    refItemsByDoc.set(
      doc.id,
      db
        .prepare<
          [number],
          ReferenceItemRow
        >('SELECT * FROM reference_items WHERE doc_id = ? ORDER BY day_offset, id')
        .all(doc.id),
    );
  }

  const recentDecisions = db
    .prepare<
      [number],
      SuggestionRow
    >(`SELECT * FROM suggestions WHERE trip_id = ? AND status IN ('accepted', 'rejected') ORDER BY decided_at DESC LIMIT 10`)
    .all(tripId);

  const userMessage = buildUserMessage(
    trip,
    items,
    refDocs,
    refItemsByDoc,
    recentDecisions,
    config.ai.max_suggestions,
  );

  // Anthropic requires max_tokens > thinking.budget_tokens. Reserve 8192
  // tokens of actual output on top of the thinking budget so the JSON array
  // of suggestions has room even after extended reasoning.
  const maxTokens = config.ai.thinking_budget_tokens + 8192;
  const response = await callMessages<unknown>('suggest', {
    model: config.ai.model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    ...(config.ai.thinking_budget_tokens > 0 && {
      thinking: {
        type: 'enabled',
        budget_tokens: config.ai.thinking_budget_tokens,
      },
    }),
    ...(config.ai.max_web_searches > 0 && {
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: config.ai.max_web_searches,
        },
      ],
    }),
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = extractText(response);
  const parsed = ResponseSchema.parse(JSON.parse(extractJson(text)));

  const batchId = randomUUID();
  const now = new Date().toISOString();
  const insertStmt = db.prepare(
    `INSERT INTO suggestions (trip_id, batch_id, kind, target_item_id, payload_json, rationale, citations_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  );

  const inserted: SuggestionRow[] = db.transaction(() => {
    const rows: SuggestionRow[] = [];
    for (const s of parsed.suggestions) {
      const info = insertStmt.run(
        tripId,
        batchId,
        s.kind,
        s.target_item_id ?? null,
        JSON.stringify(s.payload),
        s.rationale,
        JSON.stringify(s.citations),
        now,
      );
      const id = Number(info.lastInsertRowid);
      const row = db
        .prepare<[number], SuggestionRow>('SELECT * FROM suggestions WHERE id = ?')
        .get(id)!;
      rows.push(row);
    }
    return rows;
  })();

  return inserted;
}

interface BusyWindow {
  from_date: string;
  from_time: string;
  to_date: string;
  to_time: string;
  title: string;
}

/**
 * Find items that occupy a contiguous time block — including overnight
 * spans. A flight that departs JFK 23:00 and arrives LHR 11:00 the
 * next day blocks both day 1 evening and day 2 morning. The model gets
 * told to skip these when proposing food/activities.
 */
function computeBusyWindows(items: ItemRow[]): BusyWindow[] {
  const out: BusyWindow[] = [];
  for (const i of items) {
    if (!i.start_time) continue;
    const endTime = i.end_time;
    let endDate = i.day_date;
    let crosses = false;
    try {
      const a = JSON.parse(i.attributes_json) as { arrival_day_offset?: number };
      if (a.arrival_day_offset && a.arrival_day_offset > 0) {
        const d = new Date(i.day_date + 'T12:00:00');
        d.setDate(d.getDate() + a.arrival_day_offset);
        endDate = d.toISOString().slice(0, 10);
        crosses = true;
      }
    } catch {
      /* malformed attributes — ignore */
    }
    if (endTime && endTime < (i.start_time ?? '')) {
      // Wrap-around clock value (e.g. 23:00 → 02:00) — bumps day by 1
      // unless we already know a longer offset.
      if (!crosses) {
        const d = new Date(i.day_date + 'T12:00:00');
        d.setDate(d.getDate() + 1);
        endDate = d.toISOString().slice(0, 10);
      }
    }
    if (!endTime) continue;
    out.push({
      from_date: i.day_date,
      from_time: i.start_time,
      to_date: endDate,
      to_time: endTime,
      title: i.title,
    });
  }
  return out;
}

function buildUserMessage(
  trip: TripRow,
  items: ItemRow[],
  refDocs: ReferenceDocRow[],
  refItemsByDoc: Map<number, ReferenceItemRow[]>,
  recentDecisions: SuggestionRow[],
  maxSuggestions: number,
): string {
  const lines: string[] = [];
  lines.push(`# Trip`);
  lines.push(`Name: ${trip.name}`);
  lines.push(`Dates: ${trip.start_date} → ${trip.end_date}`);
  if (trip.destination) lines.push(`Destination: ${trip.destination}`);
  if (trip.goals) lines.push(`\nGoals:\n${trip.goals}`);
  if (trip.notes) lines.push(`\nNotes:\n${trip.notes}`);

  lines.push(`\n# Current itinerary (${items.length} items)`);
  if (items.length === 0) {
    lines.push('(no items yet)');
  } else {
    for (const i of items) {
      const when = [i.start_time, i.end_time].filter(Boolean).join('–') || 'any time';
      lines.push(
        `- [id=${i.id}] ${i.day_date} ${when} · ${i.kind} · ${i.title}${i.location ? ` @ ${i.location}` : ''}${i.notes ? ` — ${i.notes}` : ''}`,
      );
    }
  }

  // Multi-day busy windows: any item whose end_time wraps past midnight
  // or whose attributes declare an arrival_day_offset > 0 occupies time
  // on the following day. Surface these explicitly so the model knows
  // not to schedule meals/activities during them.
  const busy = computeBusyWindows(items);
  if (busy.length > 0) {
    lines.push(`\n# Do-not-schedule windows`);
    lines.push(
      `(items below already occupy these spans — do NOT propose meals, activities, or transit during them)`,
    );
    for (const b of busy) {
      lines.push(`- ${b.from_date} ${b.from_time} → ${b.to_date} ${b.to_time} · "${b.title}"`);
    }
  }

  if (refDocs.length > 0) {
    lines.push(`\n# Reference documents`);
    for (const doc of refDocs) {
      lines.push(`\n## ${doc.title} (${doc.kind})`);
      if (doc.parsed_summary) lines.push(doc.parsed_summary);
      const refItems = refItemsByDoc.get(doc.id) ?? [];
      for (const r of refItems.slice(0, 50)) {
        const day = r.day_offset ? `day ${r.day_offset}` : '—';
        lines.push(
          `- ${day} · ${r.kind} · ${r.title}${r.location ? ` @ ${r.location}` : ''}${r.notes ? ` — ${r.notes}` : ''}`,
        );
      }
    }
  }

  if (recentDecisions.length > 0) {
    lines.push(`\n# Recent decisions on earlier suggestions`);
    for (const d of recentDecisions) {
      lines.push(`- ${d.status.toUpperCase()}: ${d.kind} — ${d.rationale}`);
    }
  }

  lines.push(`\n# Request`);
  lines.push(
    `Produce at most ${maxSuggestions} atomic suggestions. Return JSON only, matching the schema from the system prompt.`,
  );

  return lines.join('\n');
}

function extractText(response: unknown): string {
  // response.content is an array of content blocks. We want the text blocks
  // (extended-thinking blocks and tool-use blocks are also present).
  const r = response as { content?: { type: string; text?: string }[] };
  const blocks = r.content ?? [];
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!)
    .join('\n');
}

function extractJson(text: string): string {
  // Be lenient: Claude occasionally wraps JSON in a ```json fence despite
  // the "no fence" instruction. Strip it if present.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return (fenced ? fenced[1] : text).trim();
}
