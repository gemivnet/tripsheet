import { useEffect, useRef, useState } from 'react';
import type { Item, Participant } from '../api.js';
import { Avatar, KIND_META, TypeDot, TypePill, type Day } from './shared.js';
import type { EditorState } from './editor-state.js';
import { useToast } from './Toast.js';

export function Timeline({ state }: { state: EditorState }): JSX.Element {
  const { days, scrollTargetId, addDay } = state;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollTargetId || !containerRef.current) return;
    const el = containerRef.current.querySelector(`[data-item-id="${scrollTargetId}"]`);
    if (!(el instanceof HTMLElement)) return;
    const mid = containerRef.current.clientHeight / 2;
    containerRef.current.scrollTop = el.offsetTop - mid + el.clientHeight / 2;
  }, [scrollTargetId]);

  return (
    <div ref={containerRef} style={{
      height: '100%', overflowY: 'auto', padding: '16px 20px 80px',
      boxSizing: 'border-box', position: 'relative',
    }}>
      {days.map((d, i) => <DaySection key={d.date} day={d} dayIndex={i} state={state} />)}
      <div style={{ textAlign: 'center', paddingTop: 4 }}>
        <button
          onClick={addDay}
          style={{
            padding: '8px 20px', borderRadius: 16,
            border: '2px dashed var(--border)', background: 'transparent',
            color: 'var(--text-muted)', fontSize: 12.5, cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          + Add Day
        </button>
      </div>
      <DuplicateOverlay state={state} />
    </div>
  );
}

function DaySection({
  day, dayIndex, state,
}: { day: Day; dayIndex: number; state: EditorState }): JSX.Element {
  const { openAdd, setRightTab, reorderItemsInDay, moveItemToDay, deleteDay } = state;
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dragState, setDragState] = useState<{ draggingId: number | null; overId: number | null }>({
    draggingId: null, overId: null,
  });

  const handleDragStart = (itemId: number) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('itemId', String(itemId));
    e.dataTransfer.setData('fromDate', day.date);
    setTimeout(() => setDragState((p) => ({ ...p, draggingId: itemId })), 0);
  };
  const handleDragEnd = (): void => setDragState({ draggingId: null, overId: null });
  const handleDragOver = (e: React.DragEvent, overId: number): void => {
    e.preventDefault();
    setDragState((p) => ({ ...p, overId }));
  };
  const handleDrop = (e: React.DragEvent, toIndex: number): void => {
    e.preventDefault();
    const itemId = Number(e.dataTransfer.getData('itemId'));
    const fromDate = e.dataTransfer.getData('fromDate');
    setDragState({ draggingId: null, overId: null });
    // Arrival shadows are display-only; don't include them in reorder math.
    const realItems = day.items.filter((it) => !it._arrivalShadow);
    if (fromDate === day.date) {
      const fromIdx = realItems.findIndex((it) => it.id === itemId);
      if (fromIdx !== -1 && fromIdx !== toIndex) {
        if (wouldBreakOrder(realItems, fromIdx, toIndex)) {
          toast.error('Can\'t reorder — that would put a timed item out of chronological order.');
          return;
        }
        reorderItemsInDay(day.date, fromIdx, toIndex);
      }
    } else {
      moveItemToDay(itemId, day.date, toIndex);
    }
  };

  const dateObj = new Date(day.date + 'T12:00:00');

  return (
    <div style={{ marginBottom: 28 }} data-day-date={day.date}>
      {/* Sticky day header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border)',
        position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10, paddingTop: 6,
      }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          width: 44, height: 44, background: 'var(--accent)', borderRadius: 10,
          justifyContent: 'center', flexShrink: 0,
        }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: '#fff', lineHeight: 1 }}>{dateObj.getDate()}</span>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.75)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{dateObj.toLocaleDateString('en-US', { month: 'short' })}</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em', display: 'flex', alignItems: 'baseline', gap: 8 }}>
            {dateObj.toLocaleDateString('en-US', { weekday: 'long' })}
            {day.dominant_tz && (
              <span title={day.dominant_tz} style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                padding: '2px 7px', borderRadius: 10, background: 'oklch(95% 0.04 220)',
                color: 'oklch(40% 0.1 220)',
              }}>{shortTz(day.dominant_tz)}</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
            {(() => {
              const real = day.items.filter((it) => !it._arrivalShadow);
              return `Day ${dayIndex + 1} · ${real.length} ${real.length === 1 ? 'item' : 'items'}`;
            })()}
          </div>
        </div>
        <button
          onClick={() => { openAdd(day.date); setRightTab('event'); }}
          style={{
            padding: '5px 12px', borderRadius: 16,
            border: '1.5px solid var(--border)', background: 'transparent',
            fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer',
            fontWeight: 500, transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          + Add
        </button>
        <button
          onClick={() => setConfirmDelete(true)}
          title="Delete this day"
          style={{
            padding: '5px 9px', borderRadius: 16,
            border: '1.5px solid var(--border)', background: 'transparent',
            fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer',
          }}
        >×</button>
      </div>
      {confirmDelete && (
        <DeleteDayPrompt
          day={day}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async (mode) => {
            setConfirmDelete(false);
            await deleteDay(day.date, mode);
          }}
        />
      )}

      <WarningBanner warnings={day.warnings} />

      <div style={{ position: 'relative' }}>
        {day.items.length === 0 && day.transit_over ? (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDrop(e, 0)}
            style={{
              padding: '16px 18px', borderRadius: 10,
              background: `oklch(96% 0.04 ${KIND_META.transit.hue})`,
              border: `1.5px dashed oklch(72% 0.10 ${KIND_META.transit.hue})`,
              color: `oklch(38% 0.12 ${KIND_META.transit.hue})`,
              fontSize: 13, display: 'flex', alignItems: 'center', gap: 10,
            }}
          >
            <span style={{ fontSize: 18 }}>✈</span>
            <span><strong>In transit</strong> — {day.transit_over.title} continues through this day.</span>
          </div>
        ) : day.items.length === 0 && day.package_over ? (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDrop(e, 0)}
            style={{
              padding: '16px 18px', borderRadius: 10,
              background: `oklch(96% 0.04 ${KIND_META.package.hue})`,
              border: `1.5px dashed oklch(72% 0.10 ${KIND_META.package.hue})`,
              color: `oklch(38% 0.12 ${KIND_META.package.hue})`,
              fontSize: 13, display: 'flex', alignItems: 'center', gap: 10,
            }}
          >
            <span style={{ fontSize: 18 }}>{KIND_META.package.icon}</span>
            <span><strong>{day.package_over.title}</strong> — continues through this day.</span>
          </div>
        ) : day.items.length === 0 ? (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDrop(e, 0)}
            style={{
              padding: 16, border: '2px dashed var(--border)', borderRadius: 10,
              textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5,
            }}
          >
            Drop items here or add one
          </div>
        ) : (() => {
          // Group items into rows. Items whose participant sets don't
          // overlap can go side-by-side in the same row.
          const rows = groupIntoParallelRows(day.items);
          return rows.map((row, rowIdx) => {
            // For gap/anytime divider: compare against last item in prev row
            const prevRowLastItem = rowIdx > 0 ? rows[rowIdx - 1][rows[rowIdx - 1].length - 1] : null;
            const firstItem = row[0];
            const showAnytimeDivider = !!prevRowLastItem && !!prevRowLastItem.start_time && !firstItem?.start_time;
            const gap = prevRowLastItem && firstItem?.start_time && (prevRowLastItem.end_time || prevRowLastItem.start_time)
              ? gapMinutes(prevRowLastItem, firstItem)
              : null;
            const isParallel = row.length > 1;
            return (
              <div key={row.map((it) => it.id).join('-')}>
                {showAnytimeDivider && <AnytimeDivider />}
                {gap != null && gap >= 30 && (
                  <GapPill minutes={gap} label={`${prevRowLastItem!.title} → ${firstItem.title}`} />
                )}
                {isParallel ? (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'stretch' }}>
                    {row.map((item) => {
                      const idx = day.items.findIndex((it) => it.id === item.id);
                      return (
                        <div
                          key={item.id}
                          style={{ flex: 1, minWidth: 0, position: 'relative' }}
                          onDragOver={(e) => handleDragOver(e, item.id)}
                          onDrop={(e) => handleDrop(e, idx)}
                        >
                          {dragState.overId === item.id && dragState.draggingId !== item.id && (
                            <div style={{ height: 3, background: 'var(--accent)', borderRadius: 2, marginBottom: 6, opacity: 0.7 }} />
                          )}
                          <ItemCard
                            item={item}
                            dayTz={day.dominant_tz}
                            state={state}
                            isDragging={dragState.draggingId === item.id}
                            dragHandlers={{ onDragStart: handleDragStart(item.id), onDragEnd: handleDragEnd }}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  row.map((item) => {
                    const idx = day.items.findIndex((it) => it.id === item.id);
                    return (
                      <div
                        key={item.id}
                        style={{ position: 'relative', marginBottom: 8 }}
                        onDragOver={(e) => handleDragOver(e, item.id)}
                        onDrop={(e) => handleDrop(e, idx)}
                      >
                        {dragState.overId === item.id && dragState.draggingId !== item.id && (
                          <div style={{ height: 3, background: 'var(--accent)', borderRadius: 2, marginBottom: 6, opacity: 0.7 }} />
                        )}
                        <ItemCard
                          item={item}
                          dayTz={day.dominant_tz}
                          state={state}
                          isDragging={dragState.draggingId === item.id}
                          dragHandlers={{ onDragStart: handleDragStart(item.id), onDragEnd: handleDragEnd }}
                        />
                      </div>
                    );
                  })
                )}
              </div>
            );
          });
        })()}
      </div>
      {day.lodging && <LodgingFooter lodging={day.lodging} onClick={() => state.selectItem(day.lodging!.id)} />}
    </div>
  );
}

/**
 * Soft footer shown at the bottom of each day indicating where the user
 * is sleeping that night. Reads from `day.lodging` which is computed
 * from active checkin/checkout pairs and packages-with-lodging across
 * the whole trip — so the user doesn't have to repeat themselves on
 * every day.
 */
function LodgingFooter({ lodging, onClick }: { lodging: Item; onClick: () => void }): JSX.Element {
  let attrs: Record<string, unknown> = {};
  try { attrs = JSON.parse(lodging.attributes_json) as Record<string, unknown>; } catch { /* ok */ }
  const property = (attrs.property_name as string | undefined)
    ?? (attrs.operator as string | undefined)
    ?? lodging.location
    ?? lodging.title;
  return (
    <div
      onClick={onClick}
      style={{
        marginTop: 8, padding: '8px 14px', borderRadius: 8,
        display: 'flex', alignItems: 'center', gap: 10,
        cursor: 'pointer', fontSize: 12,
        color: 'var(--text-muted)', background: 'oklch(98% 0.01 250)',
        border: '1px solid var(--border)',
        fontStyle: 'italic',
      }}
    >
      <span style={{ fontSize: 14, fontStyle: 'normal' }}>🌙</span>
      <span><span style={{ fontWeight: 600, fontStyle: 'normal' }}>Tonight</span> · {property}</span>
    </div>
  );
}

function DeleteDayPrompt({
  day, onCancel, onConfirm,
}: {
  day: Day;
  onCancel: () => void;
  onConfirm: (mode: 'shift' | 'leave') => void | Promise<void>;
}): JSX.Element {
  return (
    <div style={{
      margin: '0 0 10px 0', background: 'oklch(98% 0.04 25)',
      border: '1px solid oklch(86% 0.06 25)', borderLeft: '3px solid oklch(58% 0.16 25)',
      borderRadius: 8, padding: '10px 12px',
    }}>
      <div style={{ fontSize: 13, color: 'oklch(35% 0.12 25)', marginBottom: 8 }}>
        {(() => {
          const realCount = day.items.filter((it) => !it._arrivalShadow).length;
          return `Delete this day?${realCount > 0 ? ` ${realCount} item${realCount === 1 ? '' : 's'} will be removed.` : ''}`;
        })()}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          onClick={() => void onConfirm('shift')}
          style={{
            padding: '5px 10px', borderRadius: 6, border: 'none',
            background: 'oklch(58% 0.16 25)', color: '#fff', fontSize: 12,
            fontWeight: 600, cursor: 'pointer',
          }}
        >Delete & shift later days back</button>
        <button
          onClick={() => void onConfirm('leave')}
          style={{
            padding: '5px 10px', borderRadius: 6, border: '1.5px solid var(--border)',
            background: 'transparent', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer',
          }}
        >Delete, leave gap</button>
        <div style={{ flex: 1 }} />
        <button
          onClick={onCancel}
          style={{
            padding: '5px 10px', borderRadius: 6, border: 'none',
            background: 'transparent', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer',
          }}
        >Cancel</button>
      </div>
    </div>
  );
}

/**
 * Checkin/checkout times are flexible boundaries, not appointments.
 * checkin = "earliest you can arrive" (from); checkout = "latest you
 * can leave" (by). Render the time with a leading prefix so the
 * boundary semantic is visible at a glance.
 */
/**
 * A transit (or any item) spans into the next day if its attributes
 * include `arrival_day_offset > 0`, OR if its end_time is earlier than
 * its start_time (a wrap-around clock value typical for overnight
 * flights).
 */
function shortTz(tz: string): string {
  // Strip the IANA region prefix and tidy underscores: "Australia/Sydney" → "Sydney".
  const slash = tz.lastIndexOf('/');
  return (slash >= 0 ? tz.slice(slash + 1) : tz).replace(/_/g, ' ');
}

/**
 * Groups a flat list of items into display rows. Two items go in the
 * same row when they both have explicit participant subsets that don't
 * overlap — this surfaces "Joe flies while the rest do X" as parallel
 * columns rather than sequential blocks.
 *
 * Items without participant restrictions (participant_ids empty / null)
 * always get their own row.
 */
function groupIntoParallelRows(items: Item[]): Item[][] {
  const rows: Item[][] = [];
  for (const item of items) {
    const ids = item.participant_ids;
    const hasRestriction = ids && ids.length > 0;
    if (!hasRestriction) {
      rows.push([item]);
      continue;
    }
    // Find the last row that only has restricted items with non-overlapping sets
    const lastRow = rows[rows.length - 1];
    if (
      lastRow &&
      lastRow.every((it) => {
        const otherIds = it.participant_ids;
        if (!otherIds || otherIds.length === 0) return false;
        return !otherIds.some((id) => ids.includes(id));
      })
    ) {
      lastRow.push(item);
    } else {
      rows.push([item]);
    }
  }
  return rows;
}

/**
 * Returns true if moving day.items[fromIdx] to toIdx would violate time order.
 * Only timed items are constrained — untimed items can go anywhere.
 */
function wouldBreakOrder(items: Item[], fromIdx: number, toIdx: number): boolean {
  const reordered = items.slice();
  const [moved] = reordered.splice(fromIdx, 1);
  reordered.splice(toIdx, 0, moved);
  // Check that all consecutive timed items are non-decreasing.
  let lastTime: string | null = null;
  for (const it of reordered) {
    if (!it.start_time) continue;
    if (lastTime && it.start_time < lastTime) return true;
    lastTime = it.start_time;
  }
  return false;
}

function spansNextDay(item: Item): boolean {
  if (item.start_time && item.end_time && item.end_time < item.start_time) return true;
  try {
    const a = JSON.parse(item.attributes_json) as {
      departure_date?: string;
      arrival_date?: string;
      arrival_day_offset?: number;
    };
    if (a.departure_date && a.arrival_date) return a.arrival_date > a.departure_date;
    return (a.arrival_day_offset ?? 0) > 0;
  } catch { return false; }
}

/**
 * Minutes the item is expected to occupy. Counts wrap-around as +24h.
 * For multi-day items, adds 24h × arrival_day_offset.
 */
/**
 * Smart per-kind display: derive a primary label + secondary line from
 * the item's structured attributes when present. Falls back to title /
 * location when attributes are empty so older items still render.
 */
function smartDisplay(item: Item): { primary: string; secondary: string | null } {
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
    const cabin = get('cabin');
    if (item._arrivalShadow) {
      // Arrival shadow: show the landing side of the flight.
      const primary = `Arrives · ${[airline, flight].filter(Boolean).join(' ') || item.title}`;
      const tail = [arr ? `into ${arr}` : null, cabin].filter(Boolean).join(' · ');
      return { primary, secondary: tail || item.location };
    }
    const primary = [airline, flight].filter(Boolean).join(' ') || item.title;
    const route = dep && arr ? `${dep} → ${arr}` : null;
    const tail = [route, cabin, seat ? `seat ${seat}` : null].filter(Boolean).join(' · ');
    return { primary, secondary: tail || item.location };
  }

  if (item.kind === 'checkin' || item.kind === 'checkout') {
    const property = get('property_name');
    const room = get('room_type');
    const party = get('party_size');
    const primary = property
      ? `${item.kind === 'checkin' ? 'Check-in' : 'Check-out'} · ${property}`
      : item.title;
    const tail = [room, party ? `party of ${party}` : null].filter(Boolean).join(' · ');
    return { primary, secondary: tail || get('address') || item.location };
  }

  if (item.kind === 'meal') {
    const mealType = get('meal_type');
    const venue = get('venue_name');
    const cuisine = get('cuisine');
    const party = get('party_size');
    const price = get('price_level');
    const mealLabel = mealType ? mealType[0].toUpperCase() + mealType.slice(1) : 'Meal';
    const primary = venue ? `${mealLabel} · ${venue}` : mealLabel;
    const tail = [cuisine, party ? `party of ${party}` : null, price].filter(Boolean).join(' · ');
    return { primary, secondary: tail || get('address') || item.location };
  }

  if (item.kind === 'reservation') {
    const venue = get('venue_name');
    const party = get('party_size');
    const cat = get('category');
    const price = get('price_level');
    const primary = venue ?? item.title;
    const tail = [cat, party ? `party of ${party}` : null, price].filter(Boolean).join(' · ');
    return { primary, secondary: tail || get('address') || item.location };
  }

  if (item.kind === 'package') {
    const operator = get('operator');
    const includesLodging = get('includes_lodging') === 'yes';
    const includesMeals = get('includes_meals');
    const endDate = get('end_date');
    const primary = item.title;
    const tail = [
      operator,
      endDate ? `through ${endDate}` : null,
      includesLodging ? '🛏 lodging' : null,
      includesMeals === 'yes' ? '🍽 all meals' : includesMeals === 'some' ? '🍽 some meals' : null,
    ].filter(Boolean).join(' · ');
    return { primary, secondary: tail || item.location };
  }

  if (item.kind === 'activity') {
    const venue = get('venue_name');
    const ticket = get('ticket_required');
    const price = get('price');
    const dur = get('duration_min');
    const primary = venue ?? item.title;
    const tail = [
      ticket === 'yes' ? '🎟 ticket' : null,
      price,
      dur ? `${dur} min` : null,
    ].filter(Boolean).join(' · ');
    return { primary, secondary: tail || get('address') || item.location };
  }

  return { primary: item.title, secondary: item.location };
}

function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
  }
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function durationMinutes(item: Item): number | null {
  if (!item.start_time || !item.end_time) return null;
  let extraDays = 0;
  try {
    const a = JSON.parse(item.attributes_json) as {
      departure_date?: string;
      arrival_date?: string;
      arrival_day_offset?: number;
    };
    if (a.departure_date && a.arrival_date) {
      const dep = new Date(a.departure_date + 'T12:00:00Z').getTime();
      const arr = new Date(a.arrival_date + 'T12:00:00Z').getTime();
      extraDays = Math.max(0, Math.round((arr - dep) / 86_400_000));
    } else {
      extraDays = Math.max(0, a.arrival_day_offset ?? 0);
    }
  } catch { /* keep 0 */ }

  // tz-aware: treat departure clock in `tz`, arrival clock in `end_tz`,
  // converting both to UTC instants. Required for any cross-zone flight
  // (a 16:30 CT → 19:03 PT flight is 4h33m elapsed, NOT 2h33m).
  if (item.tz && item.end_tz && item.day_date) {
    const startUtc = wallClockToUtc(item.day_date, item.start_time, item.tz);
    const endDate = addDaysIso(item.day_date, extraDays);
    const endUtc = wallClockToUtc(endDate, item.end_time, item.end_tz);
    let diff = Math.round((endUtc - startUtc) / 60000);
    if (diff < 0 && extraDays === 0) diff += 24 * 60;
    return diff;
  }

  // tz-less fallback: clock subtraction with wraparound.
  const [h1, m1] = item.start_time.split(':').map(Number);
  const [h2, m2] = item.end_time.split(':').map(Number);
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60;
  return mins + extraDays * 24 * 60;
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
  let utc = naive - off * 60000;
  off = utcOffsetMinutes(new Date(utc), tz);
  return naive - off * 60000;
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function flexPrefix(item: Item): string {
  if (!item.start_time) return '';
  if (item.kind === 'checkin') return 'from ';
  if (item.kind === 'checkout') return 'by ';
  return '';
}
function flexLabel(item: Item): string | null {
  if (item.kind === 'checkin') return 'Earliest possible arrival';
  if (item.kind === 'checkout') return 'Latest possible departure';
  return null;
}

function minutesBetween(a: string, b: string): number {
  const [h1, m1] = a.split(':').map(Number);
  const [h2, m2] = b.split(':').map(Number);
  return (h2 * 60 + m2) - (h1 * 60 + m1);
}

/**
 * Gap from `prev`'s end (or its start if it's an instant event) to
 * `next`'s start. Honors time zones when both items declare them — a
 * flight that lands at DXB 06:00 (Asia/Dubai) followed by a SYD lunch
 * at 13:00 (Australia/Sydney) shouldn't read as "7h between" if the
 * Dubai arrival was actually closer to the lunch in real elapsed time.
 */
function gapMinutes(prev: Item, next: Item): number {
  const prevEndTime = prev.end_time ?? prev.start_time!;
  const prevEndTz = (prev.end_time ? prev.end_tz : prev.tz) ?? prev.tz ?? null;
  const prevEndDate = prev.end_time && prev.end_time < (prev.start_time ?? '')
    ? addDaysIso(prev.day_date, 1)
    : prev.day_date;
  if (prevEndTz && next.tz) {
    const a = wallClockToUtc(prevEndDate, prevEndTime, prevEndTz);
    const b = wallClockToUtc(next.day_date, next.start_time!, next.tz);
    return Math.round((b - a) / 60000);
  }
  return minutesBetween(prevEndTime, next.start_time!);
}

function GapPill({ minutes, label }: { minutes: number; label: string }): JSX.Element {
  const text = minutes >= 60
    ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`
    : `${minutes}m`;
  return (
    <div
      title={label}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '2px 0 6px 14px', color: 'var(--text-muted)', fontSize: 10.5,
        fontWeight: 500, letterSpacing: '0.04em',
      }}
    >
      <div style={{ width: 1, height: 12, background: 'var(--border)' }} />
      <span>{text} between</span>
    </div>
  );
}

function AnytimeDivider(): JSX.Element {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 8px',
      color: 'var(--text-muted)', fontSize: 10.5, fontWeight: 700,
      letterSpacing: '0.08em', textTransform: 'uppercase',
    }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span>Anytime</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

function WarningBanner({ warnings }: { warnings: string[] }): JSX.Element | null {
  const [dismissed, setDismissed] = useState(false);
  if (warnings.length === 0 || dismissed) return null;
  return (
    <div style={{
      margin: '0 0 10px 0',
      background: 'oklch(98% 0.04 72)',
      border: '1px solid oklch(84% 0.08 68)',
      borderLeft: '3px solid oklch(62% 0.13 62)',
      borderRadius: 8, padding: '9px 12px 9px 14px',
      display: 'flex', gap: 10, alignItems: 'flex-start',
    }}>
      <div style={{ flex: 1 }}>
        {warnings.map((w, i) => (
          <div key={i} style={{ fontSize: 12, color: 'oklch(40% 0.1 62)', lineHeight: 1.5 }}>
            {i === 0 ? '' : '· '}{w}
          </div>
        ))}
      </div>
      <button
        onClick={() => setDismissed(true)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'oklch(65% 0.08 65)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
      >×</button>
    </div>
  );
}

function ItemCard({
  item, dayTz, state, isDragging, dragHandlers,
}: {
  item: Item;
  dayTz: string | null;
  state: EditorState;
  isDragging: boolean;
  dragHandlers: { onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void };
}): JSX.Element {
  // Arrival shadows are read-only markers — clicking opens the original item.
  if (item._arrivalShadow) {
    const { hue } = KIND_META[item.kind];
    const { primary, secondary } = smartDisplay(item);
    return (
      <div
        onClick={() => state.selectItem(item.id)}
        style={{
          borderRadius: 10, padding: '8px 14px',
          background: `oklch(97% 0.02 ${hue})`,
          border: `1.5px dashed oklch(68% 0.1 ${hue})`,
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', minWidth: 44, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
            {item.start_time ?? '—'}
            {item.tz && item.tz !== dayTz && (
              <span style={{ display: 'block', fontSize: 9, color: 'oklch(40% 0.1 220)', fontWeight: 700 }}>{shortTz(item.tz)}</span>
            )}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <TypeDot kind={item.kind} size={7} />
              <span style={{ fontSize: 13.5, fontWeight: 600, color: `oklch(40% 0.12 ${hue})`, letterSpacing: '-0.02em' }}>{primary}</span>
            </div>
            {secondary && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, paddingLeft: 15 }}>{secondary}</div>}
          </div>
        </div>
      </div>
    );
  }

  const {
    selectedItemId, selectItem, updateItem, deleteItem, duplicateItem,
    duplicatingId, flyingItemId, commentCounts, participants,
  } = state;
  const isSelected = selectedItemId === item.id;
  const isFlying = flyingItemId === item.id;
  const isDimTarget = duplicatingId === item.id;
  const { hue } = KIND_META[item.kind];
  const commentCount = commentCounts[item.id] ?? 0;
  const confirmed = !!item.confirmation;
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const duration = durationMinutes(item);
  // Card height grows ~6px per 15 minutes of duration, capped so an
  // overnight flight doesn't dominate the day. Untimed/instant items
  // stay at the base height.
  const heightBoost = duration ? Math.min(160, Math.round(duration / 15) * 6) : 0;

  return (
    <div
      data-item-id={item.id}
      draggable
      {...dragHandlers}
      onClick={() => selectItem(isSelected ? null : item.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuPos({ x: e.clientX, y: e.clientY });
      }}
      style={{
        background: isSelected
          ? `oklch(99% 0.015 ${hue})`
          : isDimTarget ? `oklch(99% 0.02 ${hue})` : 'var(--surface)',
        border: `1.5px solid ${isSelected ? `oklch(72% 0.1 ${hue})` : isDimTarget ? `oklch(68% 0.14 ${hue})` : 'var(--border)'}`,
        borderLeft: duration ? `4px solid oklch(70% 0.12 ${hue})` : undefined,
        borderRadius: 10, padding: '11px 14px',
        minHeight: 44 + heightBoost,
        cursor: 'grab', userSelect: 'none',
        opacity: isDragging ? 0.3 : 1,
        transform: isFlying ? 'translateX(12px) scale(1.02)' : 'none',
        boxShadow: isDimTarget
          ? `0 0 0 3px oklch(72% 0.14 ${hue} / 0.3), 0 6px 24px oklch(20% 0.04 65 / 0.12)`
          : isSelected ? `0 2px 12px oklch(60% 0.1 ${hue} / 0.1)` : '0 1px 3px oklch(20% 0.02 65 / 0.05)',
        transition: 'all 0.18s ease', position: 'relative',
        animation: isFlying ? 'fly-in 0.6s ease' : undefined,
        display: 'flex', flexDirection: 'column',
      }}
    >
      {isDimTarget && (
        <div style={{
          position: 'absolute', top: -10, right: 10,
          background: `oklch(58% 0.14 ${hue})`, color: '#fff',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
          textTransform: 'uppercase', padding: '2px 8px', borderRadius: 4,
        }}>
          Move me
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          flexShrink: 0, paddingTop: 2,
        }}>
          <span
            title={[flexLabel(item), item.tz].filter(Boolean).join(' · ') || undefined}
            style={{
              fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
              letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap', textAlign: 'center',
            }}
          >
            {flexPrefix(item)}{item.start_time ?? '—'}
            {item.tz && item.tz !== dayTz && (
              <span style={{ display: 'block', fontSize: 9, color: 'oklch(40% 0.1 220)', fontWeight: 700 }}>
                {shortTz(item.tz)}
              </span>
            )}
            {item.end_time && item.end_time !== item.start_time && (
              <span style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', opacity: 0.75 }}>
                –{item.end_time}{spansNextDay(item) ? ' +1d' : ''}
                {item.end_tz && item.end_tz !== item.tz && (
                  <span style={{ display: 'block', fontSize: 9, color: 'oklch(40% 0.1 220)', fontWeight: 700 }}>
                    {shortTz(item.end_tz)}
                  </span>
                )}
              </span>
            )}
          </span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {(() => {
            const { primary, secondary } = smartDisplay(item);
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TypeDot kind={item.kind} size={7} />
                  <span style={{
                    fontSize: 14, fontWeight: 600, color: 'var(--text)',
                    letterSpacing: '-0.02em', lineHeight: 1.3,
                    flex: 1, minWidth: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{primary}</span>
                </div>
                {secondary && (
                  <div style={{
                    fontSize: 12, color: 'var(--text-muted)', marginTop: 3, paddingLeft: 15,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{secondary}</div>
                )}
              </>
            );
          })()}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
          {!confirmed && (
            <div
              title="Unconfirmed"
              style={{ width: 6, height: 6, borderRadius: '50%', background: 'oklch(68% 0.14 65)' }}
            />
          )}
          {commentCount > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
              {commentCount}
            </span>
          )}
          {item.source_doc_id != null && (
            <a
              href={`/api/uploads/${item.source_doc_id}/file`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Open the source PDF this item came from"
              style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </a>
          )}
          <Avatar name={item.created_by_name} userId={item.created_by} size={24} />
        </div>
      </div>

      {(duration != null || (item.participant_ids && item.participant_ids.length > 0)) && (
        <div style={{
          marginTop: 'auto', paddingTop: 6, paddingLeft: 56,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {duration != null && (
            <div style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.05em',
              color: `oklch(48% 0.12 ${hue})`, textTransform: 'uppercase',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span>{formatDuration(duration)}</span>
              {item.end_time && (
                <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                  · ends {item.end_time}{spansNextDay(item) ? ' (+1d)' : ''}
                </span>
              )}
            </div>
          )}
          <ParticipantDots item={item} participants={participants} />
        </div>
      )}

      {isSelected && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)',
        }}>
          <TypePill kind={item.kind} small />
          <div style={{ flex: 1 }} />
          <button
            onClick={(e) => { e.stopPropagation(); updateItem(item.id, { confirmation: confirmed ? null : 'confirmed' }); }}
            title={confirmed ? 'Mark unconfirmed' : 'Mark confirmed'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
              color: confirmed ? 'oklch(48% 0.12 160)' : 'var(--text-muted)',
              fontSize: 11.5, padding: '3px 6px', borderRadius: 5,
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill={confirmed ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            {confirmed ? 'Confirmed' : 'Unconfirmed'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); duplicateItem(item.id); }}
            title="Duplicate"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: '3px 6px', borderRadius: 5,
              display: 'flex', alignItems: 'center', transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); if (window.confirm('Delete this item?')) deleteItem(item.id); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: '3px 6px', borderRadius: 5,
              display: 'flex', alignItems: 'center', transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'oklch(97% 0.04 15)'; e.currentTarget.style.color = 'oklch(52% 0.18 15)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
          </button>
        </div>
      )}

      {menuPos && (
        <ItemContextMenu
          x={menuPos.x} y={menuPos.y}
          onClose={() => setMenuPos(null)}
          onCopy={() => {
            void navigator.clipboard.writeText(itemAsText(item));
            setMenuPos(null);
          }}
          onDelete={() => {
            void deleteItem(item.id);
            setMenuPos(null);
          }}
        />
      )}
    </div>
  );
}

/** Small colored name-initial dots for the subset of participants on this item. */
function ParticipantDots({
  item, participants,
}: { item: Item; participants: Participant[] }): JSX.Element | null {
  const ids = item.participant_ids;
  if (!ids || ids.length === 0) return null;
  const attending = participants.filter((p) => ids.includes(p.id));
  if (attending.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {attending.map((p) => {
        const hue = p.color_hue ?? 200;
        const initials = p.display_name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
        return (
          <div
            key={p.id}
            title={p.display_name}
            style={{
              width: 18, height: 18, borderRadius: '50%',
              background: `oklch(60% 0.14 ${hue})`,
              color: '#fff', fontSize: 8, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              letterSpacing: '-0.02em', flexShrink: 0,
            }}
          >{initials}</div>
        );
      })}
    </div>
  );
}

function ItemContextMenu({
  x, y, onClose, onCopy, onDelete,
}: {
  x: number; y: number;
  onClose: () => void;
  onCopy: () => void;
  onDelete: () => void;
}): JSX.Element {
  const [confirmingDel, setConfirmingDel] = useState(false);
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 500 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        position: 'fixed', top: y, left: x, zIndex: 501,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 4, minWidth: 160,
        boxShadow: '0 8px 24px oklch(20% 0.04 65 / 0.18)',
        fontSize: 13,
      }}>
        <button onClick={onCopy} style={menuBtn}>📋 Copy as text</button>
        <button
          onClick={confirmingDel ? onDelete : () => setConfirmingDel(true)}
          style={{
            ...menuBtn,
            color: confirmingDel ? 'oklch(52% 0.18 25)' : 'var(--text)',
            fontWeight: confirmingDel ? 700 : 500,
          }}
        >
          {confirmingDel ? '🗑 Click again to delete' : '🗑 Delete'}
        </button>
      </div>
    </div>
  );
}

function itemAsText(item: Item): string {
  const lines: string[] = [];
  const time = item.start_time
    ? (item.end_time && item.end_time !== item.start_time
        ? `${item.start_time}–${item.end_time}`
        : item.start_time)
    : '';
  lines.push(`${time ? time + ' · ' : ''}${item.title}`);
  if (item.location) lines.push(`  ${item.location}`);
  let attrs: Record<string, unknown> = {};
  try { attrs = JSON.parse(item.attributes_json) as Record<string, unknown>; } catch { /* ok */ }
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === '') continue;
    lines.push(`  ${k}: ${String(v)}`);
  }
  if (item.confirmation) lines.push(`  confirmation: ${item.confirmation}`);
  if (item.url) lines.push(`  ${item.url}`);
  if (item.notes) lines.push(`  notes: ${item.notes}`);
  return lines.join('\n');
}

const menuBtn: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  background: 'none', border: 'none', cursor: 'pointer',
  padding: '7px 10px', borderRadius: 5, fontSize: 13,
  color: 'var(--text)',
};

function DuplicateOverlay({ state }: { state: EditorState }): JSX.Element | null {
  const { duplicatingId, confirmDuplicate, cancelDuplicate } = state;
  if (!duplicatingId) return null;
  return (
    <>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'oklch(15% 0.02 65 / 0.38)', zIndex: 20,
        backdropFilter: 'blur(1px)', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: 24, left: '50%',
        transform: 'translateX(-50%)', zIndex: 30,
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'var(--surface)', border: '1.5px solid var(--border)',
        borderRadius: 24, padding: '10px 18px',
        boxShadow: '0 8px 32px oklch(20% 0.04 65 / 0.18)', whiteSpace: 'nowrap',
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Drag to reposition, then</span>
        <button
          onClick={confirmDuplicate}
          style={{ padding: '6px 16px', borderRadius: 16, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >Confirm</button>
        <button
          onClick={cancelDuplicate}
          style={{ padding: '6px 12px', borderRadius: 16, border: '1.5px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }}
        >Cancel</button>
      </div>
    </>
  );
}
