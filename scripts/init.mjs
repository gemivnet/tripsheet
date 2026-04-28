#!/usr/bin/env node
// One-shot local bootstrap. Creates .env with a generated SESSION_SECRET
// (you still need to paste your ANTHROPIC_API_KEY), copies
// config.example.yaml → config.yaml, and makes sure data/uploads/ exists.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function step(name, fn) {
  try {
    const msg = fn();
    if (msg) console.log(`  ✓ ${name}: ${msg}`);
    else console.log(`  • ${name}: already present, skipping`);
  } catch (e) {
    console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

console.log('tripsheet local init');

step('.env', () => {
  const envPath = join(root, '.env');
  if (existsSync(envPath)) return null;
  const example = readFileSync(join(root, '.env.example'), 'utf-8');
  const secret = randomBytes(48).toString('base64');
  const seeded = example.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`);
  writeFileSync(envPath, seeded, 'utf-8');
  return 'created (paste your ANTHROPIC_API_KEY to enable the AI panel)';
});

step('config.yaml', () => {
  const cfgPath = join(root, 'config.yaml');
  if (existsSync(cfgPath)) return null;
  const example = readFileSync(join(root, 'config.example.yaml'), 'utf-8');
  writeFileSync(cfgPath, example, 'utf-8');
  return 'copied from config.example.yaml (edit allowed_emails to your login)';
});

step('data/uploads', () => {
  const dir = join(root, 'data', 'uploads');
  if (existsSync(dir)) return null;
  mkdirSync(dir, { recursive: true });
  return 'created (SQLite + PDFs will live here; git-ignored)';
});

console.log('\nnext: yarn dev → serves http://localhost:3000');
