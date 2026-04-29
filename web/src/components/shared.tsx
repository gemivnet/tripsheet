import type { CSSProperties } from 'react';
import type { Item, ItemKind } from '../api.js';
import { checkinOpensAt } from '../airlineCheckin.js';

// ─── Palette: item.kind → hue + human label ──────────────────────────────────
//
// The timeline colors are derived from kind via OKLCH hue rotation so each
// pill/dot pair stays harmonious with the terracotta accent. Label is what
// the user sees on pills.
export const KIND_META: Record<ItemKind, { label: string; hue: number; icon: string }> = {
  meal:        { label: 'Meal',        hue: 15,  icon: '✦' },
  reservation: { label: 'Reservation', hue: 30,  icon: '◉' },
  checkin:     { label: 'Check-in',    hue: 45,  icon: '⌂' },
  checkout:    { label: 'Check-out',   hue: 45,  icon: '⌂' },
  activity:    { label: 'Activity',    hue: 160, icon: '◈' },
  package:     { label: 'Package',     hue: 100, icon: '⛺' },
  option:      { label: 'Option',      hue: 280, icon: '○' },
  note:        { label: 'Note',        hue: 0,   icon: '✎' },
  transit:     { label: 'Transit',     hue: 220, icon: '↗' },
};

export const KIND_LIST: ItemKind[] = [
  'meal', 'activity', 'reservation', 'package', 'checkin', 'checkout', 'transit', 'option', 'note',
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
  /**
   * If a multi-day package (tour, cruise, retreat) covers this day
   * (start_date < day < end_date), this is that item. The day shows
   * a "package continues" indicator.
   */
  package_over: Item | null;
  /**
   * Where the user is sleeping at the end of this day, if it can be
   * determined from the trip's items. Either a `checkin` (whose stay
   * hasn't been ended by a later `checkout`) or a `package` whose
   * `includes_lodging` is yes and whose date range covers this day.
   * Null when no lodging is recorded for the night.
   */
  lodging: Item | null;
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
        // Don't inherit sort_order from the departure day — that index has
        // no meaning on the arrival day. Reset to 0 so the start_time
        // tiebreaker places the shadow at its real chronological position
        // among the day's other items.
        sort_order: 0,
        _arrivalShadow: true,
      };
      if (!byDate.has(arrDate)) byDate.set(arrDate, []);
      byDate.get(arrDate)!.push(shadow);
    } catch { /* skip */ }
  }

  // Synthesize "online check-in opens" markers. Group flights that share a
  // booking confirmation — typically connecting flights on one PNR open
  // for check-in together — and only surface the first leg's marker so
  // the timeline doesn't show three identical "online check-in opens"
  // pills for a one-stop itinerary. Flights with no confirmation fall
  // through and each get their own marker.
  const flights = items.filter((it) => it.kind === 'transit' && (it.start_time || it._arrivalShadow !== true));
  const seenBookings = new Set<string>();
  // Sort by chronological departure so the FIRST leg of each booking
  // is the one that emits the marker.
  const sortedFlights = flights.slice().sort((a, b) =>
    a.day_date.localeCompare(b.day_date) || (a.start_time ?? '').localeCompare(b.start_time ?? ''),
  );
  for (const it of sortedFlights) {
    let attrs: { airline?: string; departure_date?: string; departure_time?: string } = {};
    try { attrs = JSON.parse(it.attributes_json) as typeof attrs; } catch { continue; }
    const depDate = attrs.departure_date ?? it.day_date;
    const depTime = attrs.departure_time ?? it.start_time ?? null;
    if (!depTime) continue;
    const conf = it.confirmation?.trim();
    if (conf) {
      if (seenBookings.has(conf)) continue;
      seenBookings.add(conf);
    }
    const opens = checkinOpensAt(depDate, depTime, attrs.airline ?? null);
    if (!opens) continue;
    const synthetic: Item = {
      ...it,
      day_date: opens.date,
      start_time: opens.time,
      end_time: null,
      sort_order: 0,
      _checkInOpen: true,
      _parentItemId: it.id,
    };
    if (!byDate.has(opens.date)) byDate.set(opens.date, []);
    byDate.get(opens.date)!.push(synthetic);
  }

  const dates = enumerateDates(trip.start_date, trip.end_date);
  for (const d of byDate.keys()) if (!dates.includes(d)) dates.push(d);
  dates.sort();

  return dates.map((date) => {
    // Sort policy:
    //  - sort_order is primary so manual drag-reorder always sticks for
    //    every item kind (a user can pin an untimed market visit
    //    between two timed flights if that's what their day looks like).
    //  - start_time is the tiebreaker — when items share the same
    //    sort_order (the default '0' for newly created items), timed
    //    items naturally fall into chronological order and untimed
    //    items drift to the end. So you get "automatic chronology
    //    when you haven't reordered anything" without locking the
    //    untimed group below the timed group permanently.
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
      package_over: findCoveringPackage(items, date),
      lodging: findActiveLodging(items, date),
    };
  });
}

/**
 * A package "covers" any day strictly between its start_date and end_date.
 * Start and end days have their own item / shadow rendered, so the banner
 * fills the in-between days where there's no explicit entry.
 */
function findCoveringPackage(allItems: Item[], date: string): Item | null {
  for (const it of allItems) {
    if (it.kind !== 'package') continue;
    let endDate: string | null = null;
    try {
      const a = JSON.parse(it.attributes_json) as { end_date?: string };
      endDate = a.end_date ?? null;
    } catch { /* skip */ }
    if (!endDate) continue;
    if (date > it.day_date && date < endDate) return it;
  }
  return null;
}

/**
 * "Where am I sleeping at the end of this day?" Walks the trip's
 * lodging-style items chronologically and tracks whether a stay is
 * currently active on the given date.
 *
 * Two sources count as lodging:
 *   - a `checkin` item, whose stay continues until a later `checkout` —
 *     either at the same property (matched by location) or any checkout
 *     after the checkin if no property name is set.
 *   - a `package` item with `includes_lodging: 'yes'`, whose date range
 *     (day_date through attributes.end_date) covers the night in question.
 *
 * Packages take precedence over standalone checkins because the user
 * explicitly modeled the multi-day stay.
 */
function findActiveLodging(allItems: Item[], date: string): Item | null {
  // 1) Packages with lodging that cover this night.
  for (const it of allItems) {
    if (it.kind !== 'package') continue;
    let endDate: string | null = null;
    let includesLodging = false;
    try {
      const a = JSON.parse(it.attributes_json) as { end_date?: string; includes_lodging?: string };
      endDate = a.end_date ?? null;
      includesLodging = a.includes_lodging === 'yes';
    } catch { /* skip */ }
    if (!includesLodging || !endDate) continue;
    // Lodging applies to nights spent during the package, i.e. start day
    // through the day BEFORE end_date (you sleep there each night until
    // the morning you leave). Last night is end_date - 1.
    if (date >= it.day_date && date < endDate) return it;
  }
  // 2) Most recent checkin that hasn't been closed by a checkout on or before this date.
  const lodgingItems = allItems
    .filter((i) => i.kind === 'checkin' || i.kind === 'checkout')
    .filter((i) => i.day_date <= date)
    .slice()
    .sort((a, b) => a.day_date.localeCompare(b.day_date) || a.id - b.id);
  let active: Item | null = null;
  for (const it of lodgingItems) {
    if (it.kind === 'checkin') {
      active = it;
    } else if (it.kind === 'checkout') {
      // A checkout on the same date as the night counts as ending the stay
      // for the night BEFORE — you're not sleeping there that night.
      // (E.g. checkout on May 16 means May 15 is the last night.)
      if (it.day_date === date) active = null;
      else if (active && it.day_date > active.day_date) active = null;
    }
  }
  return active;
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

/**
 * tz-aware end-to-end minutes for a transit item, used by the warning
 * detector to spot impossible flight times. Returns 0 (i.e. no warning)
 * when we don't have enough info to judge — a tz-less fallback would
 * give bogus positives.
 */
function transitDurationMinutes(item: Item): number {
  if (!item.tz || !item.end_tz || !item.start_time || !item.end_time || !item.day_date) return 0;
  let extraDays = 0;
  try {
    const a = JSON.parse(item.attributes_json) as { departure_date?: string; arrival_date?: string };
    if (a.departure_date && a.arrival_date) {
      const dep = new Date(a.departure_date + 'T12:00:00Z').getTime();
      const arr = new Date(a.arrival_date + 'T12:00:00Z').getTime();
      extraDays = Math.max(0, Math.round((arr - dep) / 86_400_000));
    }
  } catch { /* keep 0 */ }
  const startUtc = wallClockToUtc(item.day_date, item.start_time, item.tz);
  const endIso = (() => {
    const d = new Date(item.day_date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + extraDays);
    return d.toISOString().slice(0, 10);
  })();
  const endUtc = wallClockToUtc(endIso, item.end_time, item.end_tz);
  return Math.round((endUtc - startUtc) / 60000);
}

function utcOffsetMinutes(date: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - date.getTime()) / 60000);
}

function wallClockToUtc(date: string, time: string, tz: string): number {
  const naive = new Date(`${date}T${time}:00Z`).getTime();
  let off = utcOffsetMinutes(new Date(naive), tz);
  const utc = naive - off * 60000;
  off = utcOffsetMinutes(new Date(utc), tz);
  return naive - off * 60000;
}

export function detectWarnings(items: Item[]): string[] {
  const out: string[] = [];
  // Arrival shadows are display-only — they shouldn't trigger warnings
  // (the underlying transit item already lives on its departure day).
  const real = items.filter((i) => !i._arrivalShadow && !i._checkInOpen);
  const kinds = new Set(real.map((i) => i.kind));
  const hasMealTitle = real.some((i) =>
    /\b(breakfast|brunch|lunch|dinner|drinks|snack|meal)\b/i.test(i.title),
  );
  // A package with meals included counts as covered — no warning.
  const packageCoversMeals = real.some((i) => {
    if (i.kind !== 'package') return false;
    try {
      const a = JSON.parse(i.attributes_json) as { includes_meals?: string };
      return a.includes_meals === 'yes' || a.includes_meals === 'some';
    } catch { return false; }
  });
  // Skip the "no meal plans" warning on days where flying eats most of
  // the waking hours — adding a meal would mean eating an airline meal
  // mid-flight, which doesn't really need to be planned. Threshold: a
  // transit on the day with computed duration ≥ 6h, OR multiple transits
  // totaling ≥ 8h.
  const flightMins = real.reduce((sum, i) => {
    if (i.kind !== 'transit') return sum;
    const d = transitDurationMinutes(i);
    return sum + (d > 0 ? d : 0);
  }, 0);
  const flightDominates = flightMins >= 6 * 60;
  if (real.length > 0 && !flightDominates && !kinds.has('meal') && !kinds.has('reservation') && !hasMealTitle && !packageCoversMeals) {
    out.push('No meal plans yet — consider adding breakfast, lunch, or dinner.');
  }

  // Flag flights whose stored times can't possibly add up — usually a
  // PDF-parse miss where arrival_date is +1d when it should be +2d, or
  // an arrival_time written for the wrong leg. Surface it so the user
  // can fix the source data instead of staring at "−270 min."
  for (const it of real) {
    if (it.kind !== 'transit' || !it.start_time || !it.end_time) continue;
    if (transitDurationMinutes(it) < 0) {
      out.push(`"${it.title}" lands before it leaves — check the arrival date/time.`);
    }
  }

  // Checkin = earliest possible; flag any timed item before it.
  // Checkout = latest possible; flag any timed item after it.
  //
  // Skip these warnings entirely on travel days (any transit on the day):
  // a morning errand before flying out is naturally before the destination
  // hotel's check-in time; that's not a planning mistake.
  const checkin = real.find((i) => i.kind === 'checkin' && i.start_time);
  const checkout = real.find((i) => i.kind === 'checkout' && i.start_time);
  const hasTransit = real.some((i) => i.kind === 'transit');
  if (checkin && !hasTransit) {
    for (const it of real) {
      if (it === checkin || !it.start_time || it.kind === 'checkout' || it.kind === 'transit') continue;
      if (it.start_time < (checkin.start_time as string)) {
        out.push(`"${it.title}" at ${it.start_time} is before check-in (${checkin.start_time}).`);
      }
    }
  }
  if (checkout && !hasTransit) {
    for (const it of real) {
      if (it === checkout || !it.start_time || it.kind === 'checkin' || it.kind === 'transit') continue;
      if (it.start_time > (checkout.start_time as string)) {
        out.push(`"${it.title}" at ${it.start_time} is after check-out (${checkout.start_time}).`);
      }
    }
  }
  // Gap math: use end_time when present (so a 2h activity at 09:00 doesn't
  // trigger a "5h gap" against a 14:00 next item — actual gap is 3h).
  // Exclude check-in/check-out from gap calc — they're soft boundaries
  // (earliest arrival / latest departure), not scheduled events. A 14:00
  // check-in followed by a 19:00 flight isn't a "5h gap" of empty time;
  // the user is just at the hotel.
  const sorted = real
    .filter((i) => !!i.start_time && i.kind !== 'checkin' && i.kind !== 'checkout')
    .slice()
    .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''));
  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted[i];
    const next = sorted[i + 1];
    const prevEnd = prev.end_time ?? prev.start_time ?? '00:00';
    const [h1, m1] = prevEnd.split(':').map(Number);
    const [h2, m2] = (next.start_time ?? '00:00').split(':').map(Number);
    const gap = h2 * 60 + m2 - (h1 * 60 + m1);
    if (gap > 300) out.push(`${Math.round(gap / 60)}h gap after "${prev.title}".`);
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
