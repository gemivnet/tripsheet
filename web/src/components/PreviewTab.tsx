import { useState } from 'react';
import type { Item } from '../api.js';
import type { Day } from './shared.js';
import type { EditorState } from './editor-state.js';

type PrintMode = 'condensed' | 'per-day';

/**
 * Pretty-print preview of the trip — what it'd look like as a printable
 * itinerary for sharing or carrying around. Two layouts:
 *  - condensed: one running list, all days on the same page
 *  - per-day:   each day gets its own page break (`page-break-after`)
 *
 * Print is invoked via window.print() after applying a `data-mode`
 * attribute that the @media print rules in styles.css key off of.
 */
export function PreviewTab({ state }: { state: EditorState }): JSX.Element {
  const { trip, days } = state;
  const [mode, setMode] = useState<PrintMode>('per-day');

  const print = (): void => {
    window.open(`/api/trips/${trip.id}/export/pdf?mode=${mode}`, '_blank');
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'oklch(98% 0.01 75)' }}>
      <div className="preview-toolbar no-print" style={{
        display: 'flex', gap: 8, alignItems: 'center', padding: '12px 18px',
        borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        position: 'sticky', top: 0, zIndex: 5,
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Layout:</span>
        {(['per-day', 'condensed'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
              border: '1.5px solid', borderColor: mode === m ? 'var(--accent)' : 'var(--border)',
              background: mode === m ? 'oklch(97% 0.02 75)' : 'transparent',
              color: mode === m ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >{m === 'per-day' ? '📄 Per-day pages' : '📋 Condensed'}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={print}
          style={{
            padding: '6px 14px', borderRadius: 8, border: 'none',
            background: 'var(--accent)', color: '#fff',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >🖨 Print</button>
      </div>

      <div className="preview-page" data-mode={mode} style={{ padding: '24px 36px', maxWidth: 760, margin: '0 auto' }}>
        <header style={{ marginBottom: 28 }}>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700,
            letterSpacing: '-0.03em', margin: 0, lineHeight: 1.1,
          }}>{trip.name}</h1>
          <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 13.5 }}>
            {trip.start_date} → {trip.end_date}
            {trip.destination && <> · {trip.destination}</>}
          </div>
          {trip.goals && (
            <div style={{
              marginTop: 12, padding: '10px 14px', borderRadius: 8,
              background: 'oklch(96% 0.02 75)', fontSize: 13, lineHeight: 1.5,
              fontStyle: 'italic', color: 'var(--text)',
            }}>{trip.goals}</div>
          )}
        </header>

        {days.map((day, i) => (
          <DaySection key={day.date} day={day} dayIndex={i} mode={mode} />
        ))}
      </div>
    </div>
  );
}

function DaySection({ day, dayIndex, mode }: { day: Day; dayIndex: number; mode: PrintMode }): JSX.Element {
  const dateObj = new Date(day.date + 'T12:00:00');
  return (
    <section
      className="preview-day"
      data-mode={mode}
      style={{
        marginBottom: 28,
        // per-day mode forces a page break after each day on print
        breakAfter: mode === 'per-day' ? 'page' : undefined,
      } as React.CSSProperties}
    >
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12,
        paddingBottom: 8, borderBottom: '2px solid var(--text)',
      }}>
        <span style={{
          fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700,
          letterSpacing: '-0.02em',
        }}>Day {dayIndex + 1}</span>
        <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          {dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {day.items.length} {day.items.length === 1 ? 'item' : 'items'}
        </span>
      </div>

      {day.items.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          (open day)
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {day.items.map((item) => <PreviewItem key={item.id} item={item} />)}
        </div>
      )}
    </section>
  );
}

function PreviewItem({ item }: { item: Item }): JSX.Element {
  const time = formatTime(item);
  const detail = formatDetail(item);
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '90px 1fr', gap: 14,
      padding: '6px 0', alignItems: 'baseline',
    }}>
      <div style={{
        fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums',
        fontWeight: 600, whiteSpace: 'nowrap',
      }}>{time}</div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>
          {detail.primary}
        </div>
        {detail.secondary && (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
            {detail.secondary}
          </div>
        )}
        {item.notes && (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic', lineHeight: 1.4 }}>
            {item.notes}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(item: Item): string {
  if (!item.start_time) return '—';
  if (item.kind === 'checkin') return `from ${item.start_time}`;
  if (item.kind === 'checkout') return `by ${item.start_time}`;
  if (item.end_time && item.end_time !== item.start_time) {
    return `${item.start_time}–${item.end_time}`;
  }
  return item.start_time;
}

function formatDetail(item: Item): { primary: string; secondary: string | null } {
  let attrs: Record<string, unknown> = {};
  try { attrs = JSON.parse(item.attributes_json) as Record<string, unknown>; } catch { /* ok */ }
  const get = (k: string): string | null => {
    const v = attrs[k];
    return v == null || v === '' ? null : String(v);
  };

  if (item.kind === 'transit') {
    const airline = get('airline');
    const flight = get('flight_number');
    const dep = get('departure_airport');
    const arr = get('arrival_airport');
    const seat = get('seat');
    const conf = get('confirmation');
    const primary = [airline, flight].filter(Boolean).join(' ') || item.title;
    const tail = [
      dep && arr ? `${dep} → ${arr}` : null,
      get('cabin'),
      seat ? `seat ${seat}` : null,
      conf ? `conf ${conf}` : null,
    ].filter(Boolean).join(' · ');
    return { primary, secondary: tail || item.location };
  }
  if (item.kind === 'checkin' || item.kind === 'checkout') {
    const property = get('property_name');
    const room = get('room_type');
    const conf = get('confirmation');
    return {
      primary: property
        ? `${item.kind === 'checkin' ? 'Check-in' : 'Check-out'} · ${property}`
        : item.title,
      secondary: [get('address'), room, conf ? `conf ${conf}` : null].filter(Boolean).join(' · ') || item.location,
    };
  }
  if (item.kind === 'reservation') {
    const venue = get('venue_name');
    const party = get('party_size');
    const resvNum = get('reservation_number');
    return {
      primary: venue ?? item.title,
      secondary: [
        get('category'),
        party ? `party of ${party}` : null,
        resvNum ? `res # ${resvNum}` : null,
        get('address'),
      ].filter(Boolean).join(' · ') || item.location,
    };
  }
  if (item.kind === 'activity') {
    return {
      primary: get('venue_name') ?? item.title,
      secondary: [get('address'), item.hours, get('price')].filter(Boolean).join(' · ') || item.location,
    };
  }
  return { primary: item.title, secondary: item.location };
}
