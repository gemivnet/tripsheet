import { Router } from 'express';
import { join } from 'node:path';
import { z } from 'zod';
import type { DB } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { requireAuth } from '../auth/middleware.js';
import {
  isAiPaused,
  setAiPaused,
  currentModel,
  setModelOverride,
  getUsage,
  resetUsage,
  getLastExchange,
  getExchanges,
  getInFlightExchanges,
  findExchangeById,
  getJobs,
  getEvents,
  getConcurrency,
  setConcurrency,
} from '../ai/client.js';
import { queueParse } from '../ai/parsePdf.js';
import type { ReferenceDocRow } from '../types.js';

/**
 * Dev-only routes that power the in-app developer toolbar. Mounted only
 * when NODE_ENV !== 'production'. Anything destructive (nuke data,
 * reparse all) writes a warning to stderr so the action is visible in
 * server logs even if the client UI is closed.
 */
export function devRouter(getDb: () => DB, dataDir: string): Router {
  const router = Router();
  const db = getDb();
  router.use(requireAuth(db));

  router.get('/state', (req, res) => {
    const sinceId = Number(req.query.since ?? 0);
    res.json({
      ai_paused: isAiPaused(),
      model: currentModel(),
      concurrency: getConcurrency(),
      usage: getUsage(),
      jobs: getJobs(),
      events: getEvents(Number.isFinite(sinceId) ? sinceId : 0),
      last_exchange: getLastExchange(),
      exchanges: [...getInFlightExchanges(), ...getExchanges()].map((e) => ({
        id: e.id,
        at: e.at,
        caller: e.caller,
        model: e.model,
        input_tokens: e.input_tokens,
        output_tokens: e.output_tokens,
        error: e.error,
        in_flight: e.in_flight,
      })),
    });
  });

  router.get('/exchanges/:id', (req, res) => {
    const raw = req.params.id;
    const id: number | string = raw.startsWith('live:') ? raw : Number(raw);
    const ex = findExchangeById(id);
    if (!ex) {
      res.status(404).json({ error: 'Exchange not found' });
      return;
    }
    res.json({ exchange: ex });
  });

  router.post('/ai/concurrency', (req, res) => {
    const body = z.object({ n: z.number().int().min(1).max(8) }).parse(req.body);
    setConcurrency(body.n);
    res.json({ ok: true, concurrency: getConcurrency() });
  });

  router.post('/ai/pause', (req, res) => {
    const body = z.object({ paused: z.boolean() }).parse(req.body);
    setAiPaused(body.paused);
    res.json({ ok: true, paused: isAiPaused() });
  });

  router.post('/ai/model', (req, res) => {
    const body = z.object({ model: z.string().nullable() }).parse(req.body);
    setModelOverride(body.model);
    res.json({ ok: true, model: currentModel() });
  });

  router.post('/ai/usage/reset', (_req, res) => {
    resetUsage();
    res.json({ ok: true });
  });

  router.post('/reparse-all', (_req, res) => {
    const docs = db
      .prepare<[], ReferenceDocRow>('SELECT * FROM reference_docs ORDER BY id')
      .all();
    const uploadDir = join(dataDir, 'uploads');
    for (const doc of docs) queueParse(db, doc, uploadDir);
    res.json({ ok: true, queued: docs.length });
  });

  /**
   * Wipe all user data without closing the SQLite handle (closing would
   * orphan every router's captured DB reference). We drop user tables
   * + the migration log inside one transaction, then re-run migrations
   * against the same connection so the schema is rebuilt fresh.
   */
  router.post('/nuke-data', (_req, res) => {
    console.warn('[dev] /api/dev/nuke-data invoked — wiping all tables');
    const tables = db
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
      )
      .all()
      .map((r) => r.name);
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      for (const t of tables) db.exec(`DROP TABLE IF EXISTS "${t}"`);
    })();
    db.pragma('foreign_keys = ON');
    migrate(db);
    res.json({ ok: true });
  });

  return router;
}
