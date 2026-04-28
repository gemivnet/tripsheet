/**
 * Server-side HTML template for trip PDF export.
 * Produces a complete standalone HTML document that Puppeteer renders
 * to PDF. Mirrors the PreviewTab component's output but has no React
 * dependency — just string interpolation over the trip data.
 */

export type PdfMode = 'per-day' | 'condensed';

interface TripLike {
  name: string;
  start_date: string;
  end_date: string;
  destination: string | null;
  goals: string | null;
}

interface ItemLike {
  id: number;
  kind: string;
  title: string;
  day_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  hours: string | null;
  cost: string | null;
  notes: string | null;
  confirmation: string | null;
  attributes_json: string;
  sort_order: number;
}

interface DayData {
  date: string;
  items: ItemLike[];
}

export function buildPdfHtml(trip: TripLike, items: ItemLike[], mode: PdfMode): string {
  const days = groupByDay(trip, items);
  const pageBreak = mode === 'per-day' ? 'break-after: page;' : '';

  const daysHtml = days.map((day, i) => {
    const dateObj = new Date(day.date + 'T12:00:00');
    const dateLabel = dateObj.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });
    const itemsHtml = day.items.length === 0
      ? `<div class="empty-day">(open day)</div>`
      : day.items.map((item) => renderItem(item)).join('');

    return `
      <section class="day" style="${pageBreak}">
        <div class="day-header">
          <span class="day-num">Day ${i + 1}</span>
          <span class="day-date">${esc(dateLabel)}</span>
          <span class="day-count">${day.items.length} ${day.items.length === 1 ? 'item' : 'items'}</span>
        </div>
        <div class="items">${itemsHtml}</div>
      </section>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(trip.name)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px; color: #1a1a1a; line-height: 1.5;
    padding: 48px 52px; max-width: 760px; margin: 0 auto;
  }
  h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.1; }
  .trip-meta { margin-top: 6px; color: #666; font-size: 13px; }
  .goals {
    margin-top: 12px; padding: 10px 14px; border-radius: 6px;
    background: #faf8f4; font-style: italic; color: #333; font-size: 13px;
    border: 1px solid #e8e4dc;
  }
  .day { margin-top: 32px; }
  .day-header {
    display: flex; align-items: baseline; gap: 12px;
    padding-bottom: 6px; border-bottom: 2px solid #1a1a1a; margin-bottom: 14px;
  }
  .day-num { font-size: 18px; font-weight: 700; letter-spacing: -0.02em; }
  .day-date { font-size: 13px; color: #666; flex: 1; }
  .day-count { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 0.06em; }
  .items { display: grid; gap: 8px; }
  .item { display: grid; grid-template-columns: 84px 1fr; gap: 12px; padding: 5px 0; align-items: baseline; }
  .item-time { font-size: 11.5px; color: #666; font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
  .item-title { font-size: 13.5px; font-weight: 600; line-height: 1.3; }
  .item-detail { font-size: 12px; color: #666; margin-top: 2px; line-height: 1.4; }
  .item-notes { font-size: 11.5px; color: #888; margin-top: 3px; font-style: italic; line-height: 1.4; }
  .empty-day { font-size: 12px; color: #aaa; font-style: italic; }
  @page { margin: 0; }
</style>
</head>
<body>
  <header>
    <h1>${esc(trip.name)}</h1>
    <div class="trip-meta">
      ${esc(trip.start_date)} → ${esc(trip.end_date)}${trip.destination ? ` · ${esc(trip.destination)}` : ''}
    </div>
    ${trip.goals ? `<div class="goals">${esc(trip.goals)}</div>` : ''}
  </header>
  ${daysHtml}
</body>
</html>`;
}

function renderItem(item: ItemLike): string {
  const time = formatTime(item);
  const { primary, detail } = formatDetail(item);
  return `
    <div class="item">
      <div class="item-time">${esc(time)}</div>
      <div>
        <div class="item-title">${esc(primary)}</div>
        ${detail ? `<div class="item-detail">${esc(detail)}</div>` : ''}
        ${item.notes ? `<div class="item-notes">${esc(item.notes)}</div>` : ''}
      </div>
    </div>`;
}

function formatTime(item: ItemLike): string {
  if (!item.start_time) return '—';
  if (item.kind === 'checkin') return `from ${item.start_time}`;
  if (item.kind === 'checkout') return `by ${item.start_time}`;
  if (item.end_time && item.end_time !== item.start_time) {
    return `${item.start_time}–${item.end_time}`;
  }
  return item.start_time;
}

function formatDetail(item: ItemLike): { primary: string; detail: string | null } {
  let attrs: Record<string, unknown> = {};
  try { attrs = JSON.parse(item.attributes_json) as Record<string, unknown>; } catch { /* ok */ }
  const get = (k: string): string | null => {
    const v = attrs[k]; return v == null || v === '' ? null : String(v);
  };

  if (item.kind === 'transit') {
    const airline = get('airline');
    const flight = get('flight_number');
    const dep = get('departure_airport');
    const arr = get('arrival_airport');
    const seat = get('seat');
    const primary = [airline, flight].filter(Boolean).join(' ') || item.title;
    const tail = [
      dep && arr ? `${dep} → ${arr}` : null,
      get('cabin'),
      seat ? `seat ${seat}` : null,
      item.confirmation ? `conf ${item.confirmation}` : null,
    ].filter(Boolean).join(' · ');
    return { primary, detail: tail || item.location };
  }

  if (item.kind === 'checkin' || item.kind === 'checkout') {
    const property = get('property_name');
    return {
      primary: property
        ? `${item.kind === 'checkin' ? 'Check-in' : 'Check-out'} · ${property}`
        : item.title,
      detail: [
        get('address'), get('room_type'),
        item.confirmation ? `conf ${item.confirmation}` : null,
      ].filter(Boolean).join(' · ') || item.location,
    };
  }

  if (item.kind === 'reservation') {
    const venue = get('venue_name');
    const party = get('party_size');
    return {
      primary: venue ?? item.title,
      detail: [
        get('category'), party ? `party of ${party}` : null,
        item.confirmation ? `res # ${item.confirmation}` : null,
        get('address'),
      ].filter(Boolean).join(' · ') || item.location,
    };
  }

  if (item.kind === 'activity') {
    return {
      primary: get('venue_name') ?? item.title,
      detail: [get('address'), item.hours, get('price')].filter(Boolean).join(' · ') || item.location,
    };
  }

  return { primary: item.title, detail: item.location };
}

function groupByDay(trip: TripLike, items: ItemLike[]): DayData[] {
  const start = new Date(trip.start_date + 'T12:00:00Z');
  const end = new Date(trip.end_date + 'T12:00:00Z');
  const dates: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  // Also include any item dates outside the trip range.
  const extraDates = new Set(items.map((it) => it.day_date).filter((d) => !dates.includes(d)));
  const allDates = [...dates, ...extraDates].sort();

  const byDate = new Map<string, ItemLike[]>();
  for (const it of items) {
    if (!byDate.has(it.day_date)) byDate.set(it.day_date, []);
    byDate.get(it.day_date)!.push(it);
  }
  for (const [, dayItems] of byDate) {
    dayItems.sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      const ta = a.start_time ?? '~~~';
      const tb = b.start_time ?? '~~~';
      return ta !== tb ? ta.localeCompare(tb) : a.id - b.id;
    });
  }

  return allDates.map((date) => ({ date, items: byDate.get(date) ?? [] }));
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
