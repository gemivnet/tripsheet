import type { CSSProperties } from 'react';
import type { Item, ItemKind } from '../api.js';

// ─── Palette: item.kind → hue + human label ──────────────────────────────────
//
// The timeline colors are derived from kind via OKLCH hue rotation so each
// pill/dot pair stays harmonious with the terracotta accent. Label is what
// the user sees on pills.
export const KIND_META: Record<ItemKind, { label: string; hue: number; icon: string }> = {
  reservation: { label: 'Reservation', hue: 30,  icon: '◉' },
  checkin:     { label: 'Check-in',    hue: 45,  icon: '⌂' },
  checkout:    { label: 'Check-out',   hue: 45,  icon: '⌂' },
  activity:    { label: 'Activity',    hue: 160, icon: '◈' },
  option:      { label: 'Option',      hue: 280, icon: '○' },
  note:        { label: 'Note',        hue: 0,   icon: '✎' },
  transit:     { label: 'Transit',     hue: 220, icon: '↗' },
};

export const KIND_LIST: ItemKind[] = [
  'activity', 'reservation', 'checkin', 'checkout', 'transit', 'option', 'note',
];

// ─── Avatar (initials disc) ──────────────────────────────────────────────────

export function initialsOf(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Stable hue from a name so two users don't collide.
export function hueOf(key: string | number | null | undefined): number {
  const s = String(key ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function Avatar({
  name, size = 28, userId,
}: { name: string | null | undefined; size?: number; userId?: number | null }): JSX.Element {
  const hue = hueOf(userId ?? name ?? 0);
  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%',
        background: `oklch(54% 0.13 ${hue})`,
        color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.36, fontWeight: 700,
        flexShrink: 0, letterSpacing: '-0.01em',
      }}
    >
      {initialsOf(name)}
    </div>
  );
}

// ─── Type pills / dots ───────────────────────────────────────────────────────

export function TypeDot({ kind, size = 8 }: { kind: ItemKind; size?: number }): JSX.Element {
  const hue = KIND_META[kind].hue;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `oklch(58% 0.12 ${hue})`, flexShrink: 0,
    }} />
  );
}

export function TypePill({ kind, small }: { kind: ItemKind; small?: boolean }): JSX.Element {
  const { label, hue } = KIND_META[kind];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: small ? 10 : 11, fontWeight: 600,
      letterSpacing: '0.05em', textTransform: 'uppercase',
      color: `oklch(42% 0.12 ${hue})`, background: `oklch(95% 0.04 ${hue})`,
      padding: small ? '2px 7px' : '3px 9px', borderRadius: 4,
    }}>
      <TypeDot kind={kind} size={5} />
      {label}
    </span>
  );
}

// ─── Day grouping + warnings ─────────────────────────────────────────────────

export interface Day {
  date: string;            // ISO date
  label: string;           // "Friday, May 15"
  items: Item[];
  warnings: string[];
  /**
   * If every timed item on the day shares one IANA time zone, that zone.
   * Null when items disagree (you're crossing a zone mid-day) or when no
   * timed item carries a tz at all. The header renders this as a tag;
   * items that disagree with the day's tz render their own tz next to
   * the time.
   */
  dominant_tz: string | null;
  /**
   * If a multi-day item from an earlier day fully covers this day
   * (e.g. an overnight flight from day N to day N+2), this is that
   * item. The day shows an "in transit" indicator instead of the
   * empty-state.
   */
  transit_over: Item | null;
}

export function buildDays(trip: { start_date: string; end_date: string }, items: Item[]): Day[] {
  const byDate = new Map<string, Item[]>();
  for (const it of items) {
    if (!byDate.has(it.day_date)) byDate.set(it.day_date, []);
    byDate.get(it.day_date)!.push(it);
  }

  // For multi-day transit items (flights that land on a different date),
  // synthesize a shadow arrival entry on the landing day so the itinerary
  // shows both departure and arrival explicitly.
  for (const it of items) {
    if (it.kind !== 'transit') continue;
    try {
      const a = JSON.parse(it.attributes_json) as {
        departure_date?: string;
        arrival_date?: string;
        arrival_time?: string;
      };
      const depDate = a.departure_date ?? it.day_date;
      const arrDate = a.arrival_date;
      if (!arrDate || arrDate === depDate) continue;
      const shadow: Item = {
        ...it,
        day_date: arrDate,
        start_time: a.arrival_time ?? it.end_time,
        end_time: null,
        tz: it.end_tz,
        _arrivalShadow: true,
      };
      if (!byDate.has(arrDate)) byDate.set(arrDate, []);
      byDate.get(arrDate)!.push(shadow);
    } catch { /* skip */ }
  }

  const dates = enumerateDates(trip.start_date, trip.end_date);
  for (const d of byDate.keys()) if (!dates.includes(d)) dates.push(d);
  dates.sort();

  return dates.map((date) => {
    // Manual drag wins: sort by sort_order primarily so the user can
    // park an 08:35 flight before an "anytime" item if they want.
    // start_time is the tiebreaker — when sort_order is identical
    // (default 0 for new items) we still bucket timed before untimed.
    const dayItems = (byDate.get(date) ?? []).slice().sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      const ta = a.start_time ?? '~~~';
      const tb = b.start_time ?? '~~~';
      if (ta !== tb) return ta.localeCompare(tb);
      return a.id - b.id;
    });
    return {
      date,
      label: formatDayLabel(date),
      items: dayItems,
      warnings: detectWarnings(dayItems),
      dominant_tz: dominantTz(dayItems),
      transit_over: findCoveringTransit(items, date),
    };
  });
}

function findCoveringTransit(allItems: Item[], date: string): Item | null {
  for (const it of allItems) {
    if (it.kind !== 'transit') continue;
    let depDate = it.day_date;
    let arrDate: string | null = null;
    try {
      const a = JSON.parse(it.attributes_json) as {
        departure_date?: string;
        arrival_date?: string;
        arrival_day_offset?: number;
      };
      if (a.departure_date) depDate = a.departure_date;
      if (a.arrival_date) arrDate = a.arrival_date;
      else if (a.arrival_day_offset && a.arrival_day_offset > 0) {
        const end = new Date(depDate + 'T12:00:00Z');
        end.setUTCDate(end.getUTCDate() + a.arrival_day_offset);
        arrDate = end.toISOString().slice(0, 10);
      }
    } catch { /* skip */ }
    if (!arrDate) continue;
    if (date > depDate && date < arrDate) return it;
  }
  return null;
}

function dominantTz(items: Item[]): string | null {
  const zs = items.map((i) => i.tz).filter((z): z is string => !!z);
  if (zs.length === 0) return null;
  const first = zs[0];
  return zs.every((z) => z === first) ? first : null;
}

export function formatDayLabel(date: string): string {
  const d = new Date(date + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

export function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function detectWarnings(items: Item[]): string[] {
  const out: string[] = [];
  const kinds = new Set(items.map((i) => i.kind));
  const hasMeal = items.some((i) => /\b(breakfast|lunch|dinner|meal)\b/i.test(i.title));
  if (items.length > 0 && !kinds.has('reservation') && !hasMeal) {
    out.push('No meal plans yet — consider adding breakfast, lunch, or dinner.');
  }

  // Checkin = earliest possible; flag any timed item before it.
  // Checkout = latest possible; flag any timed item after it.
  const checkin = items.find((i) => i.kind === 'checkin' && i.start_time);
  const checkout = items.find((i) => i.kind === 'checkout' && i.start_time);
  if (checkin) {
    for (const it of items) {
      if (it === checkin || !it.start_time || it.kind === 'checkout') continue;
      if (it.start_time < (checkin.start_time as string)) {
        out.push(`"${it.title}" at ${it.start_time} is before check-in (${checkin.start_time}).`);
      }
    }
  }
  if (checkout) {
    for (const it of items) {
      if (it === checkout || !it.start_time || it.kind === 'checkin') continue;
      if (it.start_time > (checkout.start_time as string)) {
        out.push(`"${it.title}" at ${it.start_time} is after check-out (${checkout.start_time}).`);
      }
    }
  }
  const sorted = items
    .filter((i) => !!i.start_time)
    .slice()
    .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''));
  for (let i = 0; i < sorted.length - 1; i++) {
    const [h1, m1] = (sorted[i].start_time ?? '00:00').split(':').map(Number);
    const [h2, m2] = (sorted[i + 1].start_time ?? '00:00').split(':').map(Number);
    const gap = h2 * 60 + m2 - (h1 * 60 + m1);
    if (gap > 300) out.push(`${Math.round(gap / 60)}h gap after "${sorted[i].title}".`);
  }
  return out;
}

// ─── Shared form styles ──────────────────────────────────────────────────────

export const labelStyle: CSSProperties = {
  display: 'block', fontSize: 10.5, fontWeight: 700,
  letterSpacing: '0.08em', textTransform: 'uppercase',
  color: 'var(--text-muted)', marginBottom: 5,
};

export const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  border: '1.5px solid var(--border)', borderRadius: 8,
  padding: '9px 11px', fontSize: 13.5,
  fontFamily: 'var(--font-body)', background: 'var(--bg)',
  color: 'var(--text)', outline: 'none',
  transition: 'border-color 0.15s',
};

export function formatTime(t: string | null | undefined): string {
  return t ?? '';
}
