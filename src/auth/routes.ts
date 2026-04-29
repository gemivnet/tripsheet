import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.js';
import type { Config } from '../config.js';
import type { UserRow } from '../types.js';
import { hashPassword, verifyPassword } from './hash.js';
import { requireAuth, authed } from './middleware.js';

const SignupBody = z.object({
  email: z.string().email(),
  display_name: z.string().min(1).max(64),
  password: z.string().min(8).max(256),
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function authRouter(db: DB, config: Config): Router {
  const router = Router();

  const allowed = new Set(config.allowed_emails.map((e) => e.toLowerCase()));
  const findByEmail = db.prepare<[string], UserRow>('SELECT * FROM users WHERE email = ?');
  const insertUser = db.prepare<[string, string, string, string]>(
    'INSERT INTO users (email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)',
  );

  router.post('/signup', async (req, res) => {
    const parsed = SignupBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid signup payload' });
      return;
    }
    const email = parsed.data.email.toLowerCase();
    if (!allowed.has(email)) {
      res.status(403).json({ error: 'This email is not allowed to sign up' });
      return;
    }
    if (findByEmail.get(email)) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const hash = await hashPassword(parsed.data.password);
    const now = new Date().toISOString();
    const info = insertUser.run(email, parsed.data.display_name, hash, now);
    const userId = Number(info.lastInsertRowid);

    req.session = { userId };
    res.status(201).json({
      user: { id: userId, email, display_name: parsed.data.display_name },
    });
  });

  router.post('/login', async (req, res) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid login payload' });
      return;
    }
    const email = parsed.data.email.toLowerCase();
    const row = findByEmail.get(email);
    if (!row) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    const ok = await verifyPassword(row.password_hash, parsed.data.password);
    if (!ok) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    req.session = { userId: row.id };
    res.json({
      user: { id: row.id, email: row.email, display_name: row.display_name },
    });
  });

  router.post('/logout', (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  router.get('/me', requireAuth(db), (req, res) => {
    res.json({ user: authed(req).user });
  });

  return router;
}
