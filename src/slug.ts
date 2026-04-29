import { randomBytes } from 'node:crypto';
import type { DB } from './db/index.js';

/**
 * Crockford-base32 alphabet — no I/L/O/U so a slug read aloud or jotted
 * down can't be mis-transcribed. 32 chars × 6 positions = 2^30 ≈ 1B
 * possible slugs; collision-resistant for any solo-host operator's
 * lifetime even at 1k trips.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function makeSlug(): string {
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[bytes[i] % 32];
  return out;
}

/**
 * Generate a slug not currently in use. The collision-check loop is
 * defensive — at 1B slug space and a small trip count it almost never
 * iterates more than once, but it's cheap insurance.
 */
export function generateUniqueTripSlug(db: DB): string {
  const exists = db.prepare<[string], { id: number }>('SELECT id FROM trips WHERE slug = ?');
  for (let i = 0; i < 12; i++) {
    const s = makeSlug();
    if (!exists.get(s)) return s;
  }
  // Fall back to a longer slug if we somehow hit 12 collisions.
  return makeSlug() + makeSlug();
}

/** True for the URL-safe shape we generate; used to disambiguate `:id` route params. */
export function looksLikeSlug(s: string): boolean {
  return /^[0-9A-HJ-NP-Z]{6,12}$/.test(s);
}
