import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { DB } from '../db/index.js';
import type { SessionUser, UserRow } from '../types.js';

export type AuthedRequest = Request & { user: SessionUser };

/**
 * Narrow a Request to AuthedRequest after `requireAuth` has run. We go
 * through `unknown` because Express 5's Request is generic on route params
 * and TS can't prove the intersection otherwise; by the time route handlers
 * run the middleware has already installed `.user`.
 */
export function authed(req: Request): AuthedRequest {
  return req as unknown as AuthedRequest;
}

export function requireAuth(db: DB): RequestHandler {
  const stmt = db.prepare<[number], UserRow>('SELECT * FROM users WHERE id = ?');

  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = req.session?.userId;
    if (typeof userId !== 'number') {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const row = stmt.get(userId);
    if (!row) {
      // Session points at a user that no longer exists — clear it.
      req.session = null;
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    (req as AuthedRequest).user = {
      id: row.id,
      email: row.email,
      display_name: row.display_name,
    };
    next();
  };
}
