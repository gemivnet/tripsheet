import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.js';
import type { ParticipantRow, TripRow, ItemRow } from '../types.js';
import { requireAuth, authed } from '../auth/middleware.js';
import { writeAudit } from '../audit.js';

const ParticipantBody = z.object({
  display_name: z.string().min(1).max(100),
  user_id: z.number().int().positive().nullable().optional(),
  color_hue: z.number().int().min(0).max(360).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

const AttachBody = z.object({
  participant_ids: z.array(z.number().int().positive()),
});

/**
 * Participants are people on a trip — accounts or not. Items can be
 * attached to subsets of them ("Joe is only here for the first three
 * days"). When an item has no explicit participant rows, the convention
 * is "everyone on the trip."
 */
export function participantsRouter(db: DB): Router {
  const router = Router();
  router.use(requireAuth(db));

  const getTrip = db.prepare<[number], TripRow>('SELECT * FROM trips WHERE id = ?');
  const getItem = db.prepare<[number], ItemRow>('SELECT * FROM items WHERE id = ?');

  router.get('/trips/:tripId', (req, res) => {
    const tripId = Number(req.params.tripId);
    const rows = db
      .prepare<[number], ParticipantRow>('SELECT * FROM participants WHERE trip_id = ? ORDER BY id')
      .all(tripId);
    res.json({ participants: rows });
  });

  router.post('/trips/:tripId', (req, res) => {
    const tripId = Number(req.params.tripId);
    if (!getTrip.get(tripId)) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }
    const parsed = ParticipantBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
      return;
    }
    const userId = authed(req).user.id;
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO participants (trip_id, user_id, display_name, color_hue, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        tripId,
        parsed.data.user_id ?? null,
        parsed.data.display_name,
        parsed.data.color_hue ?? null,
        parsed.data.notes ?? null,
        now,
      );
    const id = Number(info.lastInsertRowid);
    const row = db
      .prepare<[number], ParticipantRow>('SELECT * FROM participants WHERE id = ?')
      .get(id)!;
    writeAudit(db, {
      user_id: userId,
      entity: 'trip', // participants don't have their own audit kind; logged under the trip
      entity_id: tripId,
      action: 'update',
      diff: { participant_added: { id, display_name: row.display_name } },
    });
    res.status(201).json({ participant: row });
  });

  router.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    const before = db
      .prepare<[number], ParticipantRow>('SELECT * FROM participants WHERE id = ?')
      .get(id);
    if (!before) {
      res.status(404).json({ error: 'Participant not found' });
      return;
    }
    const parsed = ParticipantBody.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid patch', issues: parsed.error.issues });
      return;
    }
    const next = { ...before, ...parsed.data };
    db.prepare(
      'UPDATE participants SET display_name = ?, user_id = ?, color_hue = ?, notes = ? WHERE id = ?',
    ).run(next.display_name, next.user_id, next.color_hue, next.notes, id);
    res.json({ participant: { ...next, id } });
  });

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM participants WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // Item ↔ participant attach/detach. Replaces the full set in one call.
  router.put('/items/:itemId', (req, res) => {
    const itemId = Number(req.params.itemId);
    if (!getItem.get(itemId)) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    const parsed = AttachBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
      return;
    }
    db.transaction(() => {
      db.prepare('DELETE FROM item_participants WHERE item_id = ?').run(itemId);
      const insert = db.prepare(
        'INSERT INTO item_participants (item_id, participant_id) VALUES (?, ?)',
      );
      for (const pid of parsed.data.participant_ids) insert.run(itemId, pid);
    })();
    res.json({ ok: true, participant_ids: parsed.data.participant_ids });
  });

  router.get('/items/:itemId', (req, res) => {
    const itemId = Number(req.params.itemId);
    const rows = db
      .prepare<[number], ParticipantRow>(
        `SELECT p.* FROM participants p
           JOIN item_participants ip ON ip.participant_id = p.id
          WHERE ip.item_id = ?
          ORDER BY p.id`,
      )
      .all(itemId);
    res.json({ participants: rows });
  });

  return router;
}
