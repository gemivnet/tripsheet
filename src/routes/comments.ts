import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.js';
import type { CommentRow } from '../types.js';
import { requireAuth, authed } from '../auth/middleware.js';
import { writeAudit } from '../audit.js';

const CommentBody = z.object({
  body: z.string().min(1).max(4000),
});

interface CommentWithAuthor extends CommentRow {
  author_name: string;
}

export function commentsRouter(db: DB): Router {
  const router = Router();
  router.use(requireAuth(db));

  router.get('/items/:itemId/comments', (req, res) => {
    const itemId = Number(req.params.itemId);
    const rows = db
      .prepare<[number], CommentWithAuthor>(
        `SELECT c.*, u.display_name AS author_name
           FROM comments c
           JOIN users u ON u.id = c.user_id
          WHERE c.item_id = ?
          ORDER BY c.created_at ASC`,
      )
      .all(itemId);
    res.json({ comments: rows });
  });

  router.post('/items/:itemId/comments', (req, res) => {
    const itemId = Number(req.params.itemId);
    const parsed = CommentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid comment payload' });
      return;
    }
    const exists = db
      .prepare<[number], { id: number }>('SELECT id FROM items WHERE id = ?')
      .get(itemId);
    if (!exists) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    const userId = authed(req).user.id;
    const now = new Date().toISOString();
    const tx = db.transaction((): CommentRow => {
      const info = db
        .prepare('INSERT INTO comments (item_id, user_id, body, created_at) VALUES (?, ?, ?, ?)')
        .run(itemId, userId, parsed.data.body, now);
      const id = Number(info.lastInsertRowid);
      const row = db
        .prepare<[number], CommentRow>('SELECT * FROM comments WHERE id = ?')
        .get(id)!;
      writeAudit(db, {
        user_id: userId,
        entity: 'comment',
        entity_id: id,
        action: 'create',
        diff: { after: row },
      });
      return row;
    });
    res.status(201).json({ comment: tx() });
  });

  return router;
}
