import express, { type Express } from 'express';
import cookieSession from 'cookie-session';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { DB } from './db/index.js';
import type { Config } from './config.js';
import { authRouter } from './auth/routes.js';
import { tripsRouter } from './routes/trips.js';
import { commentsRouter } from './routes/comments.js';
import { suggestionsRouter } from './routes/suggestions.js';
import { uploadsRouter } from './routes/uploads.js';
import { aiRouter } from './routes/ai.js';
import { activityRouter } from './routes/activity.js';
import { participantsRouter } from './routes/participants.js';
import { devRouter } from './routes/dev.js';

export interface ServerOptions {
  db: DB;
  config: Config;
  dataDir: string;
  webDir?: string;
  sessionSecret: string;
}

export function buildServer(opts: ServerOptions): Express {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(
    cookieSession({
      name: 'tripsheet_session',
      keys: [opts.sessionSecret],
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      sameSite: 'lax',
      httpOnly: true,
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRouter(opts.db, opts.config));
  app.use('/api/trips', tripsRouter(opts.db));
  app.use('/api', commentsRouter(opts.db));
  app.use('/api/suggestions', suggestionsRouter(opts.db));
  app.use('/api/uploads', uploadsRouter(opts.db, opts.config, opts.dataDir));
  app.use('/api/ai', aiRouter(opts.db, opts.config, join(opts.dataDir, 'uploads')));
  app.use('/api/activity', activityRouter(opts.db));
  app.use('/api/participants', participantsRouter(opts.db));

  if (process.env.NODE_ENV !== 'production') {
    app.use('/api/dev', devRouter(() => opts.db, opts.dataDir));
  }

  const webDir = opts.webDir ?? 'web/dist';
  if (existsSync(webDir)) {
    app.use(express.static(webDir));
    // SPA fallback: anything not matched by /api/* or a static file serves index.html.
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(join(process.cwd(), webDir, 'index.html'));
    });
  }

  return app;
}
