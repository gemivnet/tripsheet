import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.js';
import type { ItemRow, SuggestionRow } from '../types.js';
import { requireAuth, authed } from '../auth/middleware.js';
import { writeAudit } from '../audit.js';
import { createItem, updateItem } from './trips.js';

const SuggestionPatch = z.object({
  payload: z.record(z.string(), z.unknown()).optional(),
  rationale: z.string().max(4000).optional(),
});

export function suggestionsRouter(db: DB): Router {
  const router = Router();
  router.use(requireAuth(db));

  const listPending = db.prepare<[number], SuggestionRow>(
    `SELECT * FROM suggestions WHERE trip_id = ? AND status = 'pending' ORDER BY created_at DESC, id DESC`,
  );
  const getSuggestion = db.prepare<[number], SuggestionRow>(
    'SELECT * FROM suggestions WHERE id = ?',
  );

  router.get('/trips/:tripId', (req, res) => {
    const tripId = Number(req.params.tripId);
    res.json({ suggestions: listPending.all(tripId) });
  });

  router.post('/:id/accept', (req, res) => {
    const id = Number(req.params.id);
    const s = getSuggestion.get(id);
    if (!s) {
      res.status(404).json({ error: 'Suggestion not found' });
      return;
    }
    if (s.status !== 'pending') {
      res.status(409).json({ error: `Already ${s.status}` });
      return;
    }
    const userId = authed(req).user.id;
    const result = applySuggestion(db, s, userId);
    res.json(result);
  });

  router.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    const s = getSuggestion.get(id);
    if (!s) {
      res.status(404).json({ error: 'Suggestion not found' });
      return;
    }
    if (s.status !== 'pending') {
      res.status(409).json({ error: `Cannot edit ${s.status} suggestion` });
      return;
    }
    const parsed = SuggestionPatch.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid patch', issues: parsed.error.issues });
      return;
    }
    const userId = authed(req).user.id;
    const nextPayload = parsed.data.payload ? JSON.stringify(parsed.data.payload) : s.payload_json;
    const nextRationale = parsed.data.rationale ?? s.rationale;
    db.transaction(() => {
      db.prepare(`UPDATE suggestions SET payload_json = ?, rationale = ? WHERE id = ?`).run(
        nextPayload,
        nextRationale,
        id,
      );
      writeAudit(db, {
        user_id: userId,
        entity: 'suggestion',
        entity_id: id,
        action: 'update',
        diff: {
          before: { payload_json: s.payload_json, rationale: s.rationale },
          after: { payload_json: nextPayload, rationale: nextRationale },
        },
      });
    })();
    const updated = getSuggestion.get(id)!;
    res.json({ suggestion: updated });
  });

  router.post('/:id/reject', (req, res) => {
    const id = Number(req.params.id);
    const s = getSuggestion.get(id);
    if (!s) {
      res.status(404).json({ error: 'Suggestion not found' });
      return;
    }
    if (s.status !== 'pending') {
      res.status(409).json({ error: `Already ${s.status}` });
      return;
    }
    const userId = authed(req).user.id;
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(
        `UPDATE suggestions SET status = 'rejected', decided_by = ?, decided_at = ? WHERE id = ?`,
      ).run(userId, now, id);
      writeAudit(db, {
        user_id: userId,
        entity: 'suggestion',
        entity_id: id,
        action: 'reject',
      });
    })();
    res.json({ ok: true });
  });

  return router;
}

/**
 * Apply an accepted suggestion: mutate the itinerary according to its kind,
 * then flip the suggestion's status. All DB writes (itinerary mutation +
 * suggestion update + audit entries) run in a single transaction so a
 * partial application is impossible.
 */
export interface AcceptResult {
  ok: true;
  item?: ItemRow;
  removed_item_id?: number;
}

export function applySuggestion(db: DB, suggestion: SuggestionRow, userId: number): AcceptResult {
  const payload = JSON.parse(suggestion.payload_json) as Record<string, unknown>;
  const now = new Date().toISOString();

  const tx = db.transaction((): AcceptResult => {
    let newItem: ItemRow | undefined;
    let removedId: number | undefined;
    switch (suggestion.kind) {
      case 'add_item': {
        newItem = createItem(
          db,
          suggestion.trip_id,
          payload as Parameters<typeof createItem>[2],
          userId,
        );
        break;
      }
      case 'modify_item':
      case 'move_item': {
        // Same DB effect: patch an existing item with the payload fields.
        // The distinction is semantic (modify = field edit, move = reschedule)
        // and is preserved only in the audit log + UI rendering.
        if (!suggestion.target_item_id) break;
        const before = db
          .prepare<[number], ItemRow>('SELECT * FROM items WHERE id = ?')
          .get(suggestion.target_item_id);
        if (before) {
          newItem = updateItem(db, suggestion.target_item_id, payload, userId, before);
        }
        break;
      }
      case 'remove_item': {
        if (!suggestion.target_item_id) break;
        const before = db
          .prepare<[number], ItemRow>('SELECT * FROM items WHERE id = ?')
          .get(suggestion.target_item_id);
        if (before) {
          db.prepare('DELETE FROM items WHERE id = ?').run(suggestion.target_item_id);
          writeAudit(db, {
            user_id: userId,
            entity: 'item',
            entity_id: suggestion.target_item_id,
            action: 'delete',
            diff: { before, via_suggestion: suggestion.id },
          });
          removedId = suggestion.target_item_id;
        }
        break;
      }
      case 'note':
        // no itinerary mutation; accepting just closes the card
        break;
      default:
        // exhaustiveness guard for future SuggestionKind values
        break;
    }

    db.prepare(
      `UPDATE suggestions SET status = 'accepted', decided_by = ?, decided_at = ? WHERE id = ?`,
    ).run(userId, now, suggestion.id);
    writeAudit(db, {
      user_id: userId,
      entity: 'suggestion',
      entity_id: suggestion.id,
      action: 'accept',
      diff: {
        kind: suggestion.kind,
        applied_item_id: newItem?.id ?? null,
        removed_item_id: removedId ?? null,
      },
    });

    return { ok: true, item: newItem, removed_item_id: removedId };
  });

  return tx();
}
