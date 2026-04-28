import { Router } from 'express';
import type { DB } from '../db/index.js';
import { requireAuth } from '../auth/middleware.js';

interface ActivityRow {
  kind: 'audit' | 'comment';
  id: number;
  user_id: number;
  author_name: string;
  created_at: string;
  entity: string | null;
  entity_id: number | null;
  action: string | null;
  diff_json: string | null;
  item_id: number | null;
  body: string | null;
}

export function activityRouter(db: DB): Router {
  const router = Router();
  router.use(requireAuth(db));

  router.get('/', (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const rows = db
      .prepare<[number], ActivityRow>(
        `SELECT 'audit' AS kind, a.id, a.user_id, u.display_name AS author_name,
                a.created_at, a.entity, a.entity_id, a.action, a.diff_json,
                NULL AS item_id, NULL AS body
           FROM audit_log a JOIN users u ON u.id = a.user_id
         UNION ALL
         SELECT 'comment' AS kind, c.id, c.user_id, u.display_name AS author_name,
                c.created_at, NULL AS entity, NULL AS entity_id, NULL AS action, NULL AS diff_json,
                c.item_id, c.body
           FROM comments c JOIN users u ON u.id = c.user_id
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit);
    res.json({ activity: rows });
  });

  return router;
}
