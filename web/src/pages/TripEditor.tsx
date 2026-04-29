import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type ChatMessage, type Item, type Participant, type ReferenceDoc, type Suggestion, type Trip, type User } from '../api.js';
import { ParticipantRibbon } from '../components/ParticipantRibbon.js';
import { Timeline } from '../components/Timeline.js';
import { RightPane, UploadDrawer } from '../components/RightPane.js';
import { Avatar, buildDays } from '../components/shared.js';
import type { EditorState, RightTab } from '../components/editor-state.js';
import { useToast } from '../components/Toast.js';

export function TripEditorPage({
  tripIdOrSlug, user, onBack, onLogout,
}: {
  /** Either a numeric trip id (when the user navigated from the trips list)
   *  or a URL-safe slug (when the page was loaded via /t/:slug). The
   *  initial getTrip() call resolves either form to the canonical
   *  numeric id, which then drives every other API call. */
  tripIdOrSlug: number | string;
  user: User;
  onBack: () => void;
  onLogout: () => void;
}): JSX.Element {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [docs, setDocs] = useState<ReferenceDoc[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  // Once the initial getTrip resolves, use the numeric id from trip.id
  // for every subsequent API call. We early-return a Loading placeholder
  // until then, so the 0 default is never observable at runtime — it's
  // a typing convenience for the callbacks captured above the guard.
  const tripId = trip?.id ?? 0;
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [scrollTargetId, setScrollTargetId] = useState<number | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>('event');
  const [addForDate, setAddForDate] = useState<string | null>(null);

  const [duplicatingId, setDuplicatingId] = useState<number | null>(null);
  const [duplicateOrigin, setDuplicateOrigin] = useState<Item | null>(null);
  const [flyingItemId, setFlyingItemId] = useState<number | null>(null);

  const [commentCounts, setCommentCounts] = useState<Record<number, number>>({});
  const toast = useToast();

  const [aiMessages, setAiMessages] = useState<ChatMessage[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<Suggestion[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.getTrip(tripIdOrSlug).then((r) => {
      if (cancelled) return;
      setTrip(r.trip);
      setItems(r.items);
      setParticipants(r.participants);
      // Now we have the numeric id; kick off the supporting fetches.
      void api.listDocs({ tripId: r.trip.id }).then((d) => { if (!cancelled) setDocs(d.docs); });
      void api.listSuggestions(r.trip.id).then((s) => { if (!cancelled) setAiSuggestions(s.suggestions); });
    });
    return () => { cancelled = true; };
  }, [tripIdOrSlug]);

  const refreshParticipants = useCallback(async (): Promise<void> => {
    if (!tripId) return;
const r = await api.listParticipants(tripId);
    setParticipants(r.participants);
  }, [tripId]);

  const setItemParticipants = useCallback(
    async (itemId: number, ids: number[]): Promise<void> => {
      await api.setItemParticipants(itemId, ids);
      setItems((prev) => prev.map((it) => it.id === itemId ? { ...it, participant_ids: ids } : it));
    },
    [],
  );

  const refreshDocs = useCallback(async (): Promise<void> => {
    if (!tripId) return;
const r = await api.listDocs({ tripId });
    setDocs(r.docs);
  }, [tripId]);

  const reloadTrip = useCallback(async (): Promise<void> => {
    if (!tripId) return;
const r = await api.getTrip(tripId);
    setTrip(r.trip);
    setItems(r.items);
    setParticipants(r.participants);
  }, [tripId]);

  const refreshSuggestions = useCallback(async (): Promise<void> => {
    if (!tripId) return;
const r = await api.listSuggestions(tripId);
    setAiSuggestions((prev) => {
      const byId = new Map<number, Suggestion>(prev.map((s) => [s.id, s]));
      for (const s of r.suggestions) byId.set(s.id, s);
      return Array.from(byId.values()).sort((a, b) => b.id - a.id);
    });
  }, [tripId]);

  // While any doc is still parsing, poll docs + suggestions so the swipe
  // deck picks up trip-scoped import cards as soon as the parse finishes.
  useEffect(() => {
    if (!docs.some((d) => d.parse_status === 'pending' || d.parse_status === 'running')) return;
    const t = setInterval(() => {
      void refreshDocs();
      void refreshSuggestions();
    }, 2500);
    return () => clearInterval(t);
  }, [docs, refreshDocs, refreshSuggestions]);

  const days = useMemo(
    () => (trip ? buildDays(trip, items) : []),
    [trip, items],
  );

  const selectItem = useCallback((id: number | null): void => {
    setSelectedItemId(id);
    if (id != null) {
      setAddForDate(null);
      setRightTab('event');
    }
  }, []);

  const scrollToItem = useCallback((id: number): void => {
    setScrollTargetId(id);
    setTimeout(() => setScrollTargetId(null), 800);
  }, []);

  const openAdd = useCallback((date: string): void => {
    setSelectedItemId(null);
    setAddForDate(date);
    setRightTab('event');
  }, []);
  const closeAdd = useCallback((): void => setAddForDate(null), []);

  const createItem = useCallback(
    async (patch: Partial<Item> & { day_date: string; title: string; kind: Item['kind'] }): Promise<Item | null> => {
      try {
        const { item } = await api.createItem(tripId, patch);
        setItems((prev) => [...prev, { ...item, created_by_name: user.display_name }]);
        toast.success('Item added');
        return item;
      } catch {
        toast.error('Failed to save item — check your connection.');
        return null;
      }
    },
    [tripId, user.display_name, toast],
  );

  const updateItem = useCallback(
    async (id: number, patch: Partial<Item> & { attributes?: Record<string, unknown> }): Promise<void> => {
      // Optimistic update. If the patch includes structured attributes,
      // also serialise into attributes_json so any consumer reading the
      // stringified form (smartDisplay, findActiveLodging, …) sees the
      // new values immediately instead of waiting on the API roundtrip.
      setItems((prev) => prev.map((it) => {
        if (it.id !== id) return it;
        const next = { ...it, ...patch } as Item & { attributes?: Record<string, unknown> };
        if (patch.attributes !== undefined) {
          next.attributes_json = JSON.stringify(patch.attributes);
          delete next.attributes;
        }
        return next;
      }));
      try {
        const { item } = await api.updateItem(tripId, id, patch);
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...item, created_by_name: it.created_by_name } : it)));
        toast.success('Saved');
      } catch {
        toast.error('Save failed — changes reverted.');
        const r = await api.getTrip(tripId);
        setItems(r.items);
      }
    },
    [tripId, toast],
  );

  const deleteItem = useCallback(
    async (id: number): Promise<void> => {
      setItems((prev) => prev.filter((it) => it.id !== id));
      if (selectedItemId === id) setSelectedItemId(null);
      try {
        await api.deleteItem(tripId, id);
        toast.info('Item deleted');
      } catch {
        toast.error('Delete failed — item restored.');
        const r = await api.getTrip(tripId);
        setItems(r.items);
      }
    },
    [tripId, selectedItemId, toast],
  );

  const reorderItemsInDay = useCallback(
    (date: string, fromIdx: number, toIdx: number): void => {
      setItems((prev) => {
        const dayItems = prev.filter((it) => it.day_date === date).slice();
        const [moved] = dayItems.splice(fromIdx, 1);
        if (!moved) return prev;
        dayItems.splice(toIdx, 0, moved);
        const bySortOrder = new Map<number, number>();
        dayItems.forEach((it, i) => bySortOrder.set(it.id, i));
        dayItems.forEach((it, i) => {
          void api.updateItem(tripId, it.id, { sort_order: i });
        });
        return prev.map((it) =>
          bySortOrder.has(it.id) ? { ...it, sort_order: bySortOrder.get(it.id)! } : it,
        );
      });
    },
    [tripId],
  );

  const moveItemToDay = useCallback(
    (itemId: number, toDate: string, toIdx: number): void => {
      setItems((prev) => {
        const moved = prev.find((it) => it.id === itemId);
        if (!moved) return prev;
        const others = prev.filter((it) => it.id !== itemId);
        const targetItems = others.filter((it) => it.day_date === toDate).slice();
        targetItems.splice(toIdx, 0, { ...moved, day_date: toDate });
        const sortMap = new Map<number, number>();
        targetItems.forEach((it, i) => sortMap.set(it.id, i));
        targetItems.forEach((it, i) => {
          const patch: Partial<Item> = { sort_order: i };
          if (it.id === itemId) patch.day_date = toDate;
          void api.updateItem(tripId, it.id, patch);
        });
        return prev.map((it) => {
          if (it.id === itemId) return { ...it, day_date: toDate, sort_order: sortMap.get(it.id) ?? 0 };
          if (sortMap.has(it.id)) return { ...it, sort_order: sortMap.get(it.id)! };
          return it;
        });
      });
    },
    [tripId],
  );

  const addDay = useCallback(async (): Promise<void> => {
    if (!trip) return;
    const next = new Date(trip.end_date + 'T12:00:00');
    next.setDate(next.getDate() + 1);
    const nextDate = next.toISOString().slice(0, 10);
    const { trip: updated } = await api.updateTrip(tripId, { end_date: nextDate });
    setTrip(updated);
  }, [trip, tripId]);

  const deleteDay = useCallback(
    async (date: string, mode: 'shift' | 'leave'): Promise<void> => {
      if (!trip) return;
      const r = await api.deleteDay(tripId, date, mode);
      setTrip(r.trip);
      setItems((prev) => {
        let next = prev.filter((it) => it.day_date !== date);
        if (mode === 'shift') {
          next = next.map((it) => {
            if (it.day_date <= date) return it;
            const d = new Date(it.day_date + 'T12:00:00');
            d.setDate(d.getDate() - 1);
            return { ...it, day_date: d.toISOString().slice(0, 10) };
          });
        }
        return next;
      });
    },
    [trip, tripId],
  );

  const duplicateItem = useCallback(
    async (id: number): Promise<void> => {
      const src = items.find((it) => it.id === id);
      if (!src) return;
      const { item } = await api.createItem(tripId, {
        day_date: src.day_date,
        kind: src.kind,
        title: src.title,
        start_time: src.start_time,
        end_time: src.end_time,
        location: src.location,
        url: src.url,
        confirmation: null,
        hours: src.hours,
        cost: src.cost,
        notes: src.notes,
        sort_order: src.sort_order + 1,
      });
      setItems((prev) => [...prev, { ...item, created_by_name: user.display_name }]);
      setDuplicateOrigin(src);
      setDuplicatingId(item.id);
      setSelectedItemId(item.id);
    },
    [items, tripId, user.display_name],
  );

  const confirmDuplicate = useCallback((): void => {
    setDuplicatingId(null);
    setDuplicateOrigin(null);
  }, []);

  const cancelDuplicate = useCallback(async (): Promise<void> => {
    if (!duplicatingId) return;
    const id = duplicatingId;
    setDuplicatingId(null);
    setDuplicateOrigin(null);
    await deleteItem(id);
  }, [duplicatingId, deleteItem]);

  // Suppress unused-variable warning for duplicateOrigin; reserved for a future
  // "revert to source" action during the dim flow.
  void duplicateOrigin;

  const refreshComments = useCallback(async (itemId: number): Promise<void> => {
    try {
      const r = await api.listComments(itemId);
      setCommentCounts((p) => ({ ...p, [itemId]: r.comments.length }));
    } catch { /* ignore */ }
  }, []);

  const sendAiMessage = useCallback(
    async (text: string): Promise<void> => {
      if (!tripId) return;
      const nextHistory: ChatMessage[] = [...aiMessages, { role: 'user', content: text }];
      setAiMessages(nextHistory);
      setAiLoading(true);
      try {
        const r = await api.chatAi(tripId, nextHistory);
        setAiMessages([...nextHistory, { role: 'assistant', content: r.reply }]);
        setAiSuggestions((prev) => [...r.suggestions, ...prev]);
      } catch (err) {
        // Tell the user what actually went wrong so they can fix it
        // instead of staring at a generic "unavailable" string. Three
        // common modes here:
        //   - TypeError ("NetworkError when attempting to fetch …") →
        //     the request never reached the server, usually because
        //     the dev server died/restarted mid-call.
        //   - Error("ANTHROPIC_API_KEY is not configured") (503) →
        //     the API key isn't set on the backend.
        //   - any other Error → an HTTP error from the chat route,
        //     surfaced verbatim via api.ts's request() wrapper.
        const isNetwork = err instanceof TypeError;
        const raw = err instanceof Error ? err.message : String(err);
        const message = isNetwork
          ? "Couldn't reach the server. Is the dev process still running? Check the terminal."
          : raw.includes('ANTHROPIC_API_KEY')
            ? 'The backend has no ANTHROPIC_API_KEY set. Add it to .env and restart the server.'
            : `AI request failed — ${raw}`;
        setAiMessages([
          ...nextHistory,
          { role: 'assistant', content: message },
        ]);
      } finally {
        setAiLoading(false);
      }
    },
    [aiMessages, tripId],
  );

  const acceptSuggestion = useCallback(
    async (s: Suggestion, overrides?: { payload?: Record<string, unknown> }): Promise<void> => {
      if (overrides?.payload) {
        await api.patchSuggestion(s.id, { payload: overrides.payload });
      }
      const r = await api.acceptSuggestion(s.id);
      setAiSuggestions((prev) => prev.filter((x) => x.id !== s.id));
      if (r.removed_item_id) {
        setItems((prev) => prev.filter((it) => it.id !== r.removed_item_id));
        if (selectedItemId === r.removed_item_id) setSelectedItemId(null);
      }
      if (r.item) {
        const returned = r.item;
        const enriched = { ...returned, created_by_name: returned.created_by_name ?? user.display_name };
        setItems((prev) => {
          const exists = prev.some((it) => it.id === returned.id);
          if (exists) {
            return prev.map((it) => (it.id === returned.id ? { ...it, ...enriched } : it));
          }
          return [...prev, enriched];
        });
        setFlyingItemId(returned.id);
        setTimeout(() => setFlyingItemId(null), 700);
        scrollToItem(returned.id);
      }
    },
    [scrollToItem, selectedItemId, user.display_name],
  );

  const rejectSuggestion = useCallback(async (id: number): Promise<void> => {
    await api.rejectSuggestion(id);
    setAiSuggestions((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const patchSuggestion = useCallback(
    async (id: number, patch: { payload?: Record<string, unknown>; rationale?: string }): Promise<void> => {
      const r = await api.patchSuggestion(id, patch);
      setAiSuggestions((prev) => prev.map((x) => (x.id === id ? r.suggestion : x)));
    },
    [],
  );

  const state: EditorState = {
    user,
    trip: trip ?? { id: tripId, name: '…', start_date: '', end_date: '', destination: null, goals: null, notes: null, default_tz: null },
    items,
    days,
    docs,
    refreshDocs,
    reloadTrip,
    participants,
    refreshParticipants,
    setItemParticipants,
    selectedItemId,
    selectItem,
    scrollTargetId,
    scrollToItem,
    rightTab,
    setRightTab,
    addForDate,
    openAdd,
    closeAdd,
    createItem,
    updateItem,
    deleteItem,
    reorderItemsInDay,
    moveItemToDay,
    addDay,
    deleteDay,
    duplicatingId,
    duplicateItem,
    confirmDuplicate,
    cancelDuplicate,
    flyingItemId,
    commentCounts,
    refreshComments,
    aiMessages,
    aiSuggestions,
    aiLoading,
    sendAiMessage,
    acceptSuggestion,
    rejectSuggestion,
    patchSuggestion,
  };

  if (!trip) {
    return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</div>;
  }

  const tripDays = days.length;
  const confirmed = items.filter((it) => !!it.confirmation).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '10px 22px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface)', flexShrink: 0,
      }}>
        <button
          onClick={onBack}
          title="All trips"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', padding: 4, display: 'flex', alignItems: 'center',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8, background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: '#fff',
            letterSpacing: '-0.04em',
          }}>t</div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 600,
            color: 'var(--text)', letterSpacing: '-0.03em',
          }}>
            Tripsheet
          </div>
        </div>

        <div style={{ height: 22, width: 1, background: 'var(--border)' }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600,
            color: 'var(--text)', letterSpacing: '-0.02em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {trip.name}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 1 }}>
            {trip.destination ?? 'No destination set'} · {trip.start_date} → {trip.end_date}
          </div>
        </div>

        <ParticipantRibbon
          tripId={tripId}
          participants={participants}
          onChanged={() => void refreshParticipants()}
        />

        <div style={{ display: 'flex', gap: 7 }}>
          <StatPill label="days" value={tripDays} />
          <StatPill label="items" value={items.length} />
          <StatPill label="confirmed" value={`${confirmed}/${items.length}`} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setImportOpen(true)}
            title="Parse a PDF (confirmation, external itinerary, etc.) into swipeable suggestions"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8,
              border: '1.5px solid var(--accent)', background: 'var(--accent)',
              color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            Import PDF
          </button>
          <Avatar name={user.display_name} userId={user.id} size={30} />
          <button
            onClick={onLogout}
            title="Log out"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: 12, padding: '6px 10px',
              borderRadius: 6,
            }}
          >
            Log out
          </button>
        </div>
      </header>

      {importOpen && (
        <UploadDrawer
          tripId={tripId}
          onClose={() => setImportOpen(false)}
          onUploaded={() => {
            setImportOpen(false);
            void refreshDocs();
            setRightTab('ai');
          }}
        />
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: '0 0 56%', borderRight: '1px solid var(--border)', minHeight: 0 }}>
          <Timeline state={state} />
        </div>
        <div style={{ flex: 1, minHeight: 0, background: 'var(--surface)' }}>
          <RightPane state={state} />
        </div>
      </div>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: number | string }): JSX.Element {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 14,
      background: 'var(--bg)', border: '1px solid var(--border)',
      fontSize: 11.5,
    }}>
      <span style={{ fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      <span style={{ color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: 10 }}>{label}</span>
    </div>
  );
}
