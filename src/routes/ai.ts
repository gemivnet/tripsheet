import { Router } from 'express';
import type { DB } from '../db/index.js';
import type { Config } from '../config.js';
import type { ReferenceDocRow } from '../types.js';
import { requireAuth } from '../auth/middleware.js';
import { hasAnthropicKey } from '../ai/client.js';
import { runSuggest } from '../ai/suggest.js';
import { runChat, parseChatRequest } from '../ai/chat.js';
import { queueParse } from '../ai/parsePdf.js';
import { deriveTimezone } from '../ai/deriveTz.js';
import type { ItemRow } from '../types.js';

export function aiRouter(db: DB, config: Config, uploadDir: string): Router {
  const router = Router();
  router.use(requireAuth(db));

  router.post('/trips/:id/suggest', async (req, res) => {
    if (!hasAnthropicKey()) {
      res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured' });
      return;
    }
    const tripId = Number(req.params.id);
    try {
      const suggestions = await runSuggest(db, config, tripId);
      res.json({ suggestions });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/trips/:id/chat', async (req, res) => {
    if (!hasAnthropicKey()) {
      res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured' });
      return;
    }
    const parsed = parseChatRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const tripId = Number(req.params.id);
    try {
      const result = await runChat(db, config, tripId, parsed.data.messages);
      res.json(result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Log the full stack so a "NetworkError" from the client lines up
      // against a concrete server-side failure when we go to debug.
      console.error('[chat]', e);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/items/:id/derive-tz', async (req, res) => {
    if (!hasAnthropicKey()) {
      res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured' });
      return;
    }
    const id = Number(req.params.id);
    const item = db
      .prepare<[number], ItemRow>('SELECT * FROM items WHERE id = ?')
      .get(id);
    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    if (!item.location) {
      res.status(400).json({ error: 'Item has no location to derive timezone from' });
      return;
    }
    try {
      const { tz, end_tz } = await deriveTimezone(item.location, item.kind);
      if (tz) {
        db.prepare('UPDATE items SET tz = ?, end_tz = ?, updated_at = ? WHERE id = ?').run(
          tz,
          end_tz ?? item.end_tz,
          new Date().toISOString(),
          id,
        );
      }
      res.json({ tz, end_tz });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/docs/:id/reparse', (req, res) => {
    const id = Number(req.params.id);
    const doc = db
      .prepare<[number], ReferenceDocRow>('SELECT * FROM reference_docs WHERE id = ?')
      .get(id);
    if (!doc) {
      res.status(404).json({ error: 'Doc not found' });
      return;
    }
    queueParse(db, doc, uploadDir);
    res.json({ ok: true, status: 'queued' });
  });

  return router;
}
