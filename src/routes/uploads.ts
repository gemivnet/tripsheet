import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';
import { z } from 'zod';
import type { DB } from '../db/index.js';
import type { Config } from '../config.js';
import type { ReferenceDocRow, ReferenceItemRow } from '../types.js';
import { requireAuth, authed } from '../auth/middleware.js';
import { writeAudit } from '../audit.js';
import { queueParse } from '../ai/parsePdf.js';

const UploadMeta = z.object({
  title: z.string().min(1).max(200),
  trip_id: z.coerce.number().int().positive().nullable().optional(),
});

export function uploadsRouter(db: DB, config: Config, dataDir: string): Router {
  const uploadDir = join(dataDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase() || '.pdf';
      cb(null, `${randomUUID()}${ext}`);
    },
  });
  const upload = multer({
    storage,
    limits: { fileSize: config.uploads.max_bytes },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype !== 'application/pdf') {
        cb(new Error('Only PDF uploads are accepted'));
        return;
      }
      cb(null, true);
    },
  });

  const router = Router();
  router.use(requireAuth(db));

  // `scope=library` → only trip_id IS NULL
  // `scope=trip&trip_id=N` → only trip_id = N
  // no params → every doc
  router.get('/', (req, res) => {
    const scope = typeof req.query.scope === 'string' ? req.query.scope : null;
    if (scope === 'library') {
      const docs = db
        .prepare<[], ReferenceDocRow>(
          `SELECT * FROM reference_docs WHERE trip_id IS NULL ORDER BY uploaded_at DESC`,
        )
        .all();
      res.json({ docs });
      return;
    }
    if (scope === 'trip') {
      const tripId = Number(req.query.trip_id);
      if (!Number.isFinite(tripId) || tripId <= 0) {
        res.status(400).json({ error: 'trip_id query param required when scope=trip' });
        return;
      }
      const docs = db
        .prepare<[number], ReferenceDocRow>(
          `SELECT * FROM reference_docs WHERE trip_id = ? ORDER BY uploaded_at DESC`,
        )
        .all(tripId);
      res.json({ docs });
      return;
    }
    const docs = db
      .prepare<[], ReferenceDocRow>('SELECT * FROM reference_docs ORDER BY uploaded_at DESC')
      .all();
    res.json({ docs });
  });

  router.get('/:id/file', (req, res) => {
    const id = Number(req.params.id);
    const doc = db
      .prepare<[number], ReferenceDocRow>('SELECT * FROM reference_docs WHERE id = ?')
      .get(id);
    if (!doc) {
      res.status(404).json({ error: 'Doc not found' });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.source_filename)}"`);
    res.sendFile(join(uploadDir, doc.stored_filename));
  });

  router.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    const doc = db
      .prepare<[number], ReferenceDocRow>('SELECT * FROM reference_docs WHERE id = ?')
      .get(id);
    if (!doc) {
      res.status(404).json({ error: 'Doc not found' });
      return;
    }
    const items = db
      .prepare<[number], ReferenceItemRow>('SELECT * FROM reference_items WHERE doc_id = ? ORDER BY day_offset, id')
      .all(id);
    res.json({ doc, items });
  });

  router.post('/', upload.single('file'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    const parsed = UploadMeta.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid upload metadata', issues: parsed.error.issues });
      return;
    }
    const userId = authed(req).user.id;
    const now = new Date().toISOString();
    const doc = db.transaction((): ReferenceDocRow => {
      const info = db
        .prepare(
          `INSERT INTO reference_docs (trip_id, title, kind, source_filename, stored_filename, parse_status, uploaded_by, uploaded_at)
           VALUES (?, ?, 'other', ?, ?, 'pending', ?, ?)`,
        )
        .run(
          parsed.data.trip_id ?? null,
          parsed.data.title,
          req.file!.originalname,
          req.file!.filename,
          userId,
          now,
        );
      const id = Number(info.lastInsertRowid);
      const row = db
        .prepare<[number], ReferenceDocRow>('SELECT * FROM reference_docs WHERE id = ?')
        .get(id)!;
      writeAudit(db, {
        user_id: userId,
        entity: 'doc',
        entity_id: id,
        action: 'create',
        diff: { after: { id: row.id, title: row.title, trip_id: row.trip_id } },
      });
      return row;
    })();

    queueParse(db, doc, uploadDir);
    res.status(201).json({ doc });
  });

  /**
   * Hard-delete a reference doc: drop its parsed_items, unlink any
   * items that pointed at it (set source_doc_id = NULL), drop the
   * suggestions still in the swipe deck, remove the row, and rm the
   * file from disk. If a parse is still running, the worker's eventual
   * UPDATE will silently no-op once the row is gone.
   */
  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    const doc = db
      .prepare<[number], ReferenceDocRow>('SELECT * FROM reference_docs WHERE id = ?')
      .get(id);
    if (!doc) {
      res.status(404).json({ error: 'Doc not found' });
      return;
    }
    const userId = authed(req).user.id;
    db.transaction(() => {
      db.prepare('DELETE FROM reference_items WHERE doc_id = ?').run(id);
      db.prepare(`UPDATE items SET source_doc_id = NULL WHERE source_doc_id = ?`).run(id);
      db.prepare(
        `DELETE FROM suggestions WHERE status = 'pending' AND payload_json LIKE ?`,
      ).run(`%"source_doc_id":${id}%`);
      db.prepare('DELETE FROM reference_docs WHERE id = ?').run(id);
      writeAudit(db, {
        user_id: userId,
        entity: 'doc',
        entity_id: id,
        action: 'delete',
        diff: { before: { id: doc.id, title: doc.title, trip_id: doc.trip_id } },
      });
    })();
    try { rmSync(join(uploadDir, doc.stored_filename)); } catch { /* already gone */ }
    res.json({ ok: true });
  });

  return router;
}
