import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const CHAT_SYSTEM_PROMPT = readFileSync(join(here, '..', 'prompts', 'chat.md'), 'utf-8');

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const ChatRequest = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(16000),
      }),
    )
    .min(1)
    .max(40),
});

const SuggestionSchema = z.object({
  kind: z.enum(['add_item', 'modify_item', 'remove_item', 'move_item', 'note']),
  target_item_id: z.number().int().nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
  rationale: z.string(),
  citations: z
    .array(z.object({ url: z.string(), title: z.string() }))
    .default([]),
});

export type ChatRequestBody = z.infer<typeof ChatRequest>;

export function parseChatRequest(body: unknown):
  | { ok: true; data: ChatRequestBody }
  | { ok: false; error: string } {
  const r = ChatRequest.safeParse(body);
  if (!r.success) return { ok: false, error: 'Invalid chat payload' };
  return { ok: true, data: r.data };
}

/**
 * Run one turn of stateful chat about a trip. The client sends the full
 * message history; the server adds trip context via the system prompt
 * and can persist suggestions embedded in the assistant's reply.
 *
 * Suggestions are emitted inside a `<suggestions>[...]</suggestions>`
 * block which we strip from the visible reply and persist as pending rows
 * sharing a single batch_id.
 */
export async function runChat(
  db: DB,
  config: Config,
  tripId: number,
  messages: ChatMessage[],
): Promise<{ reply: string; suggestions: SuggestionRow[] }> {
  const trip = db.prepare<[number], TripRow>('SELECT * FROM trips WHERE id = ?').get(tripId);
  if (!trip) throw new Error(`Trip ${tripId} not found`);

  const items = db
    .prepare<[number], ItemRow>(
      'SELECT * FROM items WHERE trip_id = ? ORDER BY day_date, sort_order, id',
    )
    .all(tripId);

  const refDocs = db
    .prepare<[number], ReferenceDocRow>(
      `SELECT * FROM reference_docs WHERE parse_status = 'complete' AND (trip_id IS NULL OR trip_id = ?) ORDER BY uploaded_at DESC LIMIT 6`,
    )
    .all(tripId);

  const refItemsByDoc = new Map<number, ReferenceItemRow[]>();
  for (const doc of refDocs) {
    refItemsByDoc.set(
      doc.id,
      db
        .prepare<[number], ReferenceItemRow>(
          'SELECT * FROM reference_items WHERE doc_id = ? ORDER BY day_offset, id',
        )
        .all(doc.id),
    );
  }

  const context = buildContext(trip, items, refDocs, refItemsByDoc, config.ai.max_suggestions);
  const systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = [
    { type: 'text', text: CHAT_SYSTEM_PROMPT },
    { type: 'text', text: context, cache_control: { type: 'ephemeral' } },
  ];

  // Anthropic requires max_tokens > thinking.budget_tokens. Reserve 4096
  // tokens of actual output on top of whatever thinking budget is configured.
  const maxTokens = config.ai.thinking_budget_tokens + 4096;
  const response = await callMessages<unknown>('chat', {
    model: config.ai.model,
    max_tokens: maxTokens,
    system: systemBlocks,
    ...(config.ai.thinking_budget_tokens > 0 && {
      thinking: { type: 'enabled', budget_tokens: config.ai.thinking_budget_tokens },
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
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const raw = extractText(response);
  const { prose, suggestions: parsedSuggestions } = splitSuggestions(raw);

  const batchId = randomUUID();
  const now = new Date().toISOString();
  const insertStmt = db.prepare(
    `INSERT INTO suggestions (trip_id, batch_id, kind, target_item_id, payload_json, rationale, citations_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  );
  const selectStmt = db.prepare<[number], SuggestionRow>('SELECT * FROM suggestions WHERE id = ?');

  const inserted = db.transaction(() => {
    const rows: SuggestionRow[] = [];
    for (const s of parsedSuggestions) {
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
      const row = selectStmt.get(Number(info.lastInsertRowid))!;
      rows.push(row);
    }
    return rows;
  })();

  return { reply: prose.trim(), suggestions: inserted };
}

function buildContext(
  trip: TripRow,
  items: ItemRow[],
  refDocs: ReferenceDocRow[],
  refItemsByDoc: Map<number, ReferenceItemRow[]>,
  maxSuggestions: number,
): string {
  const lines: string[] = [];
  lines.push(`# Trip`);
  lines.push(`Name: ${trip.name}`);
  lines.push(`Dates: ${trip.start_date} → ${trip.end_date}`);
  if (trip.destination) lines.push(`Destination: ${trip.destination}`);
  if (trip.goals) lines.push(`\nGoals:\n${trip.goals}`);

  lines.push(`\n# Current itinerary (${items.length} items)`);
  if (items.length === 0) {
    lines.push('(empty)');
  } else {
    for (const i of items) {
      const when = [i.start_time, i.end_time].filter(Boolean).join('–') || 'any time';
      lines.push(
        `- [id=${i.id}] ${i.day_date} ${when} · ${i.kind} · ${i.title}${i.location ? ` @ ${i.location}` : ''}`,
      );
    }
  }

  if (refDocs.length > 0) {
    lines.push(`\n# Reference material`);
    for (const doc of refDocs) {
      lines.push(`\n## ${doc.title} (${doc.kind})`);
      if (doc.parsed_summary) lines.push(doc.parsed_summary);
      for (const r of (refItemsByDoc.get(doc.id) ?? []).slice(0, 40)) {
        lines.push(`- ${r.kind} · ${r.title}${r.location ? ` @ ${r.location}` : ''}`);
      }
    }
  }

  lines.push(
    `\nAt most ${maxSuggestions} atomic suggestions per reply. Each suggestion = one independently acceptable change.`,
  );
  return lines.join('\n');
}

function extractText(response: unknown): string {
  const r = response as { content?: Array<{ type: string; text?: string }> };
  return (r.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

function splitSuggestions(raw: string): {
  prose: string;
  suggestions: z.infer<typeof SuggestionSchema>[];
} {
  const match = raw.match(/<suggestions>([\s\S]*?)<\/suggestions>/);
  if (!match) return { prose: raw, suggestions: [] };
  const prose = raw.replace(/<suggestions>[\s\S]*?<\/suggestions>/g, '');
  try {
    const json = stripFence(match[1]);
    const arr = JSON.parse(json);
    const parsed = z.array(SuggestionSchema).safeParse(arr);
    if (!parsed.success) return { prose, suggestions: [] };
    return { prose, suggestions: parsed.data };
  } catch {
    return { prose, suggestions: [] };
  }
}

function stripFence(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : s).trim();
}
