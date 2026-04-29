import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.js';
import type { ItemRow, TripRow } from '../types.js';
import { ITEM_KINDS } from '../types.js';
import type { ItemKind } from '../types.js';
import { requireAuth, authed } from '../auth/middleware.js';
import { writeAudit } from '../audit.js';
import { defForKind, safeParseAttrs, KINDS } from '../itemKinds/index.js';
import { buildPdfHtml, type PdfMode } from './pdfTemplate.js';
import { reimportTrip } from '../ai/parsePdf.js';
import type { ReferenceDocRow } from '../types.js';

const TripBody = z.object({
  name: z.string().min(1).max(200),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  destination: z.string().max(200).nullable().optional(),
  goals: z.string().max(4000).nullable().optional(),
  notes: z.string().max(8000).nullable().optional(),
  default_tz: z.string().max(60).nullable().optional(),
});

const ItemBody = z.object({
  day_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(ITEM_KINDS as readonly [string, ...string[]]),
  // Allowed empty so kinds with derivesTitle (flight, checkin, checkout, meal)
  // can be created without the user typing a title — applyDerivation fills it.
  // Falls back to the kind's label if derivation also produces nothing.
  title: z.string().max(300).optional().default(''),
  start_time: z.string().max(20).nullable().optional(),
  end_time: z.string().max(20).nullable().optional(),
  location: z.string().max(300).nullable().optional(),
  url: z.string().url().max(1000).nullable().optional(),
  confirmation: z.string().max(200).nullable().optional(),
  hours: z.string().max(300).nullable().optional(),
  cost: z.string().max(60).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  sort_order: z.number().int().optional(),
  source_doc_id: z.number().int().positive().nullable().optional(),
  tz: z.string().max(60).nullable().optional(),
  end_tz: z.string().max(60).nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});

const ItemPatch = ItemBody.partial();

type TripBodyT = z.infer<typeof TripBody>;
type ItemBodyT = z.infer<typeof ItemBody>;

export function tripsRouter(db: DB, uploadDir?: string): Router {
  const router = Router();
  router.use(requireAuth(db));

  const listTrips = db.prepare<[], TripRow>('SELECT * FROM trips ORDER BY start_date DESC');
  const getTrip = db.prepare<[number], TripRow>('SELECT * FROM trips WHERE id = ?');
  const listItems = db.prepare<[number], ItemRow & { created_by_name: string | null; participant_ids_csv: string | null }>(
    `SELECT i.*,
            u.display_name AS created_by_name,
            (SELECT GROUP_CONCAT(participant_id) FROM item_participants WHERE item_id = i.id) AS participant_ids_csv
       FROM items i
       LEFT JOIN users u ON u.id = i.created_by
      WHERE i.trip_id = ?
      ORDER BY i.day_date, i.sort_order, i.id`,
  );
  const getItem = db.prepare<[number], ItemRow>('SELECT * FROM items WHERE id = ?');

  router.get('/', (_req, res) => {
    res.json({ trips: listTrips.all() });
  });

  router.get('/item-kinds', (_req, res) => {
    res.json({
      kinds: KINDS.map((k) => ({
        kind: k.kind,
        subtype: k.subtype,
        label: k.label,
        hint: k.hint ?? null,
        ownsTime: !!k.ownsTime,
        derivesTitle: !!k.derivesTitle,
        derivesLocation: !!k.derivesLocation,
        fields: k.fields,
      })),
    });
  });

  router.post('/', (req, res) => {
    const parsed = TripBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid trip payload', issues: parsed.error.issues });
      return;
    }
    const userId = authed(req).user.id;
    const result = createTrip(db, parsed.data, userId);
    res.status(201).json({ trip: result });
  });

  router.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    const trip = getTrip.get(id);
    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }
    const rawItems = listItems.all(id);
    const items = rawItems.map((r) => ({
      ...r,
      participant_ids: r.participant_ids_csv
        ? r.participant_ids_csv.split(',').map(Number)
        : [],
    }));
    const participants = db
      .prepare('SELECT * FROM participants WHERE trip_id = ? ORDER BY id')
      .all(id);
    res.json({ trip, items, participants });
  });

  router.get('/:id/export/pdf', (req, res) => {
    const id = Number(req.params.id);
    const trip = getTrip.get(id);
    if (!trip) { res.status(404).json({ error: 'Trip not found' }); return; }
    const mode: PdfMode = req.query.mode === 'condensed' ? 'condensed' : 'per-day';
    const rawItems = listItems.all(id);

    void (async () => {
      try {
        const { default: puppeteer } = await import('puppeteer-core');
        const executablePath =
          process.env.CHROMIUM_PATH ??
          (process.platform === 'darwin'
            ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
            : '/usr/bin/chromium-browser');

        const html = buildPdfHtml(trip, rawItems, mode);
        const browser = await puppeteer.launch({
          executablePath,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
          headless: true,
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
        await browser.close();

        const safeName = trip.name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
        res.send(pdf);
      } catch (err) {
        console.error('[PDF export]', err);
        res.status(500).json({ error: 'PDF generation failed', detail: String(err) });
      }
    })();
  });

  router.post('/:id/reimport', (req, res) => {
    const id = Number(req.params.id);
    const trip = getTrip.get(id);
    if (!trip) { res.status(404).json({ error: 'Trip not found' }); return; }
    if (!uploadDir) { res.status(500).json({ error: 'Upload directory not configured' }); return; }
    const docId = Number(req.body?.doc_id);
    if (!Number.isFinite(docId)) { res.status(400).json({ error: 'doc_id is required' }); return; }
    const doc = db
      .prepare<[number], ReferenceDocRow>('SELECT * FROM reference_docs WHERE id = ?')
      .get(docId);
    if (!doc) { res.status(404).json({ error: 'Doc not found' }); return; }

    const userId = authed(req).user.id;
    void (async () => {
      try {
        const summary = await reimportTrip(db, trip, doc, uploadDir, userId);
        res.json({ ok: true, ...summary });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[reimport]', msg);
        res.status(500).json({ error: 'Reimport failed', detail: msg });
      }
    })();
  });

  router.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    const trip = getTrip.get(id);
    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }
    const parsed = TripBody.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid patch', issues: parsed.error.issues });
      return;
    }
    const userId = authed(req).user.id;
    const updated = updateTrip(db, id, parsed.data, userId, trip);
    res.json({ trip: updated });
  });

  router.delete('/:id/days/:date', (req, res) => {
    const id = Number(req.params.id);
    const date = String(req.params.date);
    const mode = req.query.mode === 'leave' ? 'leave' : 'shift';
    const trip = getTrip.get(id);
    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Invalid date' });
      return;
    }
    if (date < trip.start_date || date > trip.end_date) {
      res.status(400).json({ error: 'Date is outside the trip range' });
      return;
    }
    const userId = authed(req).user.id;
    const result = deleteDay(db, trip, date, mode, userId);
    res.json(result);
  });

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    const trip = getTrip.get(id);
    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }
    const userId = authed(req).user.id;
    db.transaction(() => {
      db.prepare('DELETE FROM trips WHERE id = ?').run(id);
      writeAudit(db, {
        user_id: userId,
        entity: 'trip',
        entity_id: id,
        action: 'delete',
        diff: { before: trip },
      });
    })();
    res.json({ ok: true });
  });

  router.post('/:id/items', (req, res) => {
    const tripId = Number(req.params.id);
    if (!getTrip.get(tripId)) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }
    const parsed = ItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid item payload', issues: parsed.error.issues });
      return;
    }
    const userId = authed(req).user.id;
    const item = createItem(db, tripId, parsed.data, userId);
    res.status(201).json({ item });
  });

  router.patch('/:id/items/:itemId', (req, res) => {
    const itemId = Number(req.params.itemId);
    const before = getItem.get(itemId);
    if (!before) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    const parsed = ItemPatch.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid patch', issues: parsed.error.issues });
      return;
    }
    const userId = authed(req).user.id;
    const updated = updateItem(db, itemId, parsed.data, userId, before);
    res.json({ item: updated });
  });

  router.delete('/:id/items/:itemId', (req, res) => {
    const itemId = Number(req.params.itemId);
    const before = getItem.get(itemId);
    if (!before) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    const userId = authed(req).user.id;
    db.transaction(() => {
      db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
      writeAudit(db, {
        user_id: userId,
        entity: 'item',
        entity_id: itemId,
        action: 'delete',
        diff: { before },
      });
    })();
    res.json({ ok: true });
  });

  return router;
}

export function createTrip(db: DB, body: TripBodyT, userId: number): TripRow {
  const now = new Date().toISOString();
  const tx = db.transaction((): TripRow => {
    const info = db
      .prepare(
        'INSERT INTO trips (name, start_date, end_date, destination, goals, notes, default_tz, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        body.name,
        body.start_date,
        body.end_date,
        body.destination ?? null,
        body.goals ?? null,
        body.notes ?? null,
        body.default_tz ?? null,
        now,
        now,
      );
    const id = Number(info.lastInsertRowid);
    const row = db.prepare<[number], TripRow>('SELECT * FROM trips WHERE id = ?').get(id)!;
    writeAudit(db, {
      user_id: userId,
      entity: 'trip',
      entity_id: id,
      action: 'create',
      diff: { after: row },
    });
    return row;
  });
  return tx();
}

export function updateTrip(
  db: DB,
  id: number,
  patch: Partial<TripBodyT>,
  userId: number,
  before: TripRow,
): TripRow {
  const tx = db.transaction((): TripRow => {
    const next = {
      ...before,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    db.prepare(
      'UPDATE trips SET name = ?, start_date = ?, end_date = ?, destination = ?, goals = ?, notes = ?, default_tz = ?, updated_at = ? WHERE id = ?',
    ).run(
      next.name,
      next.start_date,
      next.end_date,
      next.destination,
      next.goals,
      next.notes,
      next.default_tz,
      next.updated_at,
      id,
    );
    const after = db.prepare<[number], TripRow>('SELECT * FROM trips WHERE id = ?').get(id)!;
    writeAudit(db, {
      user_id: userId,
      entity: 'trip',
      entity_id: id,
      action: 'update',
      diff: { before, after },
    });
    return after;
  });
  return tx();
}

/**
 * Remove a single day from a trip. Two modes:
 *  - `shift` (default): delete the day's items, then move every later
 *    day back by one (day_date := day_date - 1) and shrink end_date by
 *    one. Use when the day was a "we don't want this day at all" extra.
 *  - `leave`: just delete the day's items; trip range unchanged. Use
 *    when the day was a typo or the user wants an empty placeholder.
 *
 * Special-cases the start day (advance start_date by one in `shift`
 * mode) and the end day (always shrink end_date). All writes happen in
 * one transaction so the trip can never be left mid-shift.
 */
export function deleteDay(
  db: DB,
  trip: TripRow,
  date: string,
  mode: 'shift' | 'leave',
  userId: number,
): { ok: true; trip: TripRow; deleted_items: number; shifted_items: number } {
  return db.transaction(() => {
    const dayItems = db
      .prepare<[number, string], ItemRow>(
        'SELECT * FROM items WHERE trip_id = ? AND day_date = ?',
      )
      .all(trip.id, date);

    db.prepare('DELETE FROM items WHERE trip_id = ? AND day_date = ?').run(trip.id, date);
    for (const it of dayItems) {
      writeAudit(db, {
        user_id: userId,
        entity: 'item',
        entity_id: it.id,
        action: 'delete',
        diff: { before: it, via: 'delete_day' },
      });
    }

    let shifted = 0;
    let nextStart = trip.start_date;
    let nextEnd = trip.end_date;
    if (mode === 'shift') {
      const later = db
        .prepare<[number, string], ItemRow>(
          'SELECT id, day_date FROM items WHERE trip_id = ? AND day_date > ? ORDER BY day_date',
        )
        .all(trip.id, date);
      const updateDay = db.prepare('UPDATE items SET day_date = ?, updated_at = ? WHERE id = ?');
      const now = new Date().toISOString();
      for (const it of later) {
        const d = new Date(it.day_date + 'T12:00:00');
        d.setDate(d.getDate() - 1);
        updateDay.run(d.toISOString().slice(0, 10), now, it.id);
        shifted += 1;
      }
      if (date === trip.start_date) {
        const d = new Date(trip.start_date + 'T12:00:00');
        d.setDate(d.getDate() + 1);
        nextStart = d.toISOString().slice(0, 10);
      } else {
        const d = new Date(trip.end_date + 'T12:00:00');
        d.setDate(d.getDate() - 1);
        nextEnd = d.toISOString().slice(0, 10);
      }
    } else if (date === trip.end_date) {
      const d = new Date(trip.end_date + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      nextEnd = d.toISOString().slice(0, 10);
    } else if (date === trip.start_date) {
      const d = new Date(trip.start_date + 'T12:00:00');
      d.setDate(d.getDate() + 1);
      nextStart = d.toISOString().slice(0, 10);
    }

    let nextTrip = trip;
    if (nextStart !== trip.start_date || nextEnd !== trip.end_date) {
      nextTrip = updateTrip(
        db,
        trip.id,
        { start_date: nextStart, end_date: nextEnd },
        userId,
        trip,
      );
    }

    writeAudit(db, {
      user_id: userId,
      entity: 'trip',
      entity_id: trip.id,
      action: 'update',
      diff: { delete_day: date, mode, deleted_items: dayItems.length, shifted_items: shifted },
    });

    return {
      ok: true as const,
      trip: nextTrip,
      deleted_items: dayItems.length,
      shifted_items: shifted,
    };
  })();
}

/**
 * Apply per-kind derivation to fill in any base fields the user didn't
 * specify. The user's explicit value always wins; derive only fills
 * holes. Returns a fresh body — does not mutate the input.
 */
function applyDerivation(body: ItemBodyT): ItemBodyT {
  const def = defForKind(body.kind as ItemKind);
  const parsed = safeParseAttrs(body.kind as ItemKind, body.attributes ?? {});
  // Run the per-kind canonicalization pass before deriving so the values
  // we store and the values we display are always the normalized ones
  // (e.g. "Southwest" → "WN", "AA2364" → "AA 2364").
  const attrs = def.normalizeAttrs ? def.normalizeAttrs(parsed) : parsed;
  // Pass start_time so non-ownsTime kinds (e.g. activity) can derive end_time.
  const derived = def.derive ? def.derive(attrs, { start_time: body.start_time }) : {};
  // For kinds whose dedicated form fields are the canonical source of
  // truth (flight: airline + IATA codes; check-in: property name), the
  // derived value WINS over the body — there's only one place to type it.
  const overrideTime = !!def.ownsTime;
  const overrideTitle = !!def.derivesTitle;
  const overrideLocation = !!def.derivesLocation;
  // Title fallback chain: derived (when kind owns it) → user-typed →
  // derived (otherwise) → kind label. Empty strings collapse to nullish
  // so a blank input doesn't beat a real derived value.
  const userTitle = body.title && body.title.trim() ? body.title.trim() : null;
  const derivedTitle = derived.title ?? null;
  const finalTitle = overrideTitle
    ? (derivedTitle ?? userTitle ?? def.label)
    : (userTitle ?? derivedTitle ?? def.label);
  return {
    ...body,
    attributes: attrs,
    title: finalTitle,
    day_date: (overrideTime && derived.day_date) || body.day_date,
    start_time: overrideTime
      ? (derived.start_time ?? body.start_time ?? null)
      : (body.start_time ?? derived.start_time ?? null),
    end_time: overrideTime
      ? (derived.end_time ?? body.end_time ?? null)
      : (body.end_time ?? derived.end_time ?? null),
    location: overrideLocation
      ? (derived.location ?? body.location ?? null)
      : (body.location ?? derived.location ?? null),
    hours: body.hours ?? derived.hours ?? null,
    cost: body.cost ?? derived.cost ?? null,
    tz: body.tz ?? derived.tz ?? null,
    end_tz: body.end_tz ?? derived.end_tz ?? null,
    // Migrate confirmation stored in attrs (old schema) to the base column.
    confirmation: body.confirmation ?? derived.confirmation ?? null,
  };
}

export function createItem(
  db: DB,
  tripId: number,
  body: ItemBodyT,
  userId: number,
): ItemRow {
  const merged = applyDerivation(body);
  const now = new Date().toISOString();
  const tx = db.transaction((): ItemRow => {
    const info = db
      .prepare(
        `INSERT INTO items (trip_id, day_date, kind, title, start_time, end_time, location, url, confirmation, hours, cost, notes, sort_order, created_by, source_doc_id, tz, end_tz, attributes_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        tripId,
        merged.day_date,
        merged.kind,
        merged.title,
        merged.start_time ?? null,
        merged.end_time ?? null,
        merged.location ?? null,
        merged.url ?? null,
        merged.confirmation ?? null,
        merged.hours ?? null,
        merged.cost ?? null,
        merged.notes ?? null,
        merged.sort_order ?? 0,
        userId,
        merged.source_doc_id ?? null,
        merged.tz ?? null,
        merged.end_tz ?? null,
        JSON.stringify(merged.attributes ?? {}),
        now,
        now,
      );
    const id = Number(info.lastInsertRowid);
    const row = db.prepare<[number], ItemRow>('SELECT * FROM items WHERE id = ?').get(id)!;
    writeAudit(db, {
      user_id: userId,
      entity: 'item',
      entity_id: id,
      action: 'create',
      diff: { after: row },
    });
    return row;
  });
  return tx();
}

export function updateItem(
  db: DB,
  id: number,
  patch: Partial<ItemBodyT>,
  userId: number,
  before: ItemRow,
): ItemRow {
  const tx = db.transaction((): ItemRow => {
    const next: ItemRow = {
      ...before,
      ...(patch as Partial<ItemRow>),
      updated_at: new Date().toISOString(),
    };
    // For PATCH, derive only when attributes were touched — otherwise
    // the user's pre-existing top-level fields would get clobbered.
    let attrsJson = before.attributes_json;
    if (patch.attributes !== undefined) {
      const merged = applyDerivation({
        ...next as unknown as ItemBodyT,
        attributes: patch.attributes,
      });
      attrsJson = JSON.stringify(merged.attributes ?? {});
      const def = defForKind(next.kind as ItemKind);
      // For kinds where the structured form is canonical (derivesTitle /
      // derivesLocation / ownsTime), the derived value wins on attribute
      // edits — that's the whole point of those flags. Otherwise fall
      // back to the existing "fill the hole" behavior.
      next.title = def.derivesTitle ? merged.title ?? next.title : next.title;
      next.start_time = def.ownsTime
        ? (merged.start_time ?? null)
        : (next.start_time ?? merged.start_time ?? null);
      next.end_time = def.ownsTime
        ? (merged.end_time ?? next.end_time ?? null)
        : (next.end_time ?? merged.end_time ?? null);
      next.day_date = def.ownsTime ? (merged.day_date ?? next.day_date) : next.day_date;
      next.location = def.derivesLocation
        ? (merged.location ?? next.location ?? null)
        : (next.location ?? merged.location ?? null);
      next.hours = next.hours ?? merged.hours ?? null;
      next.cost = next.cost ?? merged.cost ?? null;
      next.tz = next.tz ?? merged.tz ?? null;
      next.end_tz = next.end_tz ?? merged.end_tz ?? null;
    }
    db.prepare(
      `UPDATE items SET day_date = ?, kind = ?, title = ?, start_time = ?, end_time = ?, location = ?, url = ?, confirmation = ?, hours = ?, cost = ?, notes = ?, sort_order = ?, tz = ?, end_tz = ?, attributes_json = ?, updated_at = ? WHERE id = ?`,
    ).run(
      next.day_date,
      next.kind,
      next.title,
      next.start_time,
      next.end_time,
      next.location,
      next.url,
      next.confirmation,
      next.hours,
      next.cost,
      next.notes,
      next.sort_order,
      next.tz,
      next.end_tz,
      attrsJson,
      next.updated_at,
      id,
    );
    const after = db.prepare<[number], ItemRow>('SELECT * FROM items WHERE id = ?').get(id)!;
    writeAudit(db, {
      user_id: userId,
      entity: 'item',
      entity_id: id,
      action: 'update',
      diff: { before, after },
    });
    return after;
  });
  return tx();
}
