import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type Comment, type Item, type ItemKind, type ReferenceDoc, type Suggestion } from '../api.js';
import type { EditorState, RightTab } from './editor-state.js';
import {
  Avatar, KIND_META, KIND_LIST, TypeDot, TypePill,
  inputStyle, labelStyle,
} from './shared.js';
import { KindAttributes } from './KindAttributes.js';
import { PreviewTab } from './PreviewTab.js';

const TABS: Array<{ id: RightTab; icon: string }> = [
  { id: 'event',    icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z' },
  { id: 'comments', icon: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z' },
  { id: 'ai',       icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
  { id: 'preview',  icon: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 100 6 3 3 0 000-6z' },
  { id: 'pdf',      icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M16 13H8M16 17H8' },
];

export function RightPane({ state }: { state: EditorState }): JSX.Element {
  const { rightTab, setRightTab, selectedItemId, addForDate } = state;
  const labelFor = (id: RightTab): string => {
    if (id === 'event') {
      if (selectedItemId) return 'Edit';
      if (addForDate) return 'Add';
      return 'Event';
    }
    if (id === 'comments') return 'Comments';
    if (id === 'ai') return 'AI';
    if (id === 'preview') return 'Preview';
    return 'PDFs';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', borderBottom: '1.5px solid var(--border)',
        padding: '0 14px', flexShrink: 0, background: 'var(--surface)',
      }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setRightTab(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '12px 13px', border: 'none', background: 'transparent',
              fontSize: 13, fontWeight: rightTab === t.id ? 700 : 500,
              cursor: 'pointer', transition: 'all 0.15s',
              color: rightTab === t.id ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: rightTab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1.5, whiteSpace: 'nowrap',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={t.icon} />
            </svg>
            {labelFor(t.id)}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {rightTab === 'event'    && <EventTab state={state} />}
        {rightTab === 'comments' && <CommentsTab state={state} />}
        {rightTab === 'ai'       && <AiTab state={state} />}
        {rightTab === 'preview'  && <PreviewTab state={state} />}
        {rightTab === 'pdf'      && <PdfTab state={state} />}
      </div>
    </div>
  );
}

/**
 * Kinds whose dedicated form fields supersede the generic top-level
 * "Time" input. Mirrors `ownsTime: true` on the server's ItemKindDef
 * registry — duplicated here so we don't need to await the kinds API
 * before deciding to render the field.
 */
function kindOwnsTime(kind: ItemKind): boolean {
  // transit: departure_time drives start_time
  // checkin/checkout: policy_time drives start_time
  return kind === 'transit' || kind === 'checkin' || kind === 'checkout';
}

// ─── Event tab (edit / add) ──────────────────────────────────────────────────

interface FormState {
  start_time: string;
  title: string;
  location: string;
  kind: ItemKind;
  notes: string;
  confirmed: boolean;
}

function blankForm(): FormState {
  return { start_time: '12:00', title: '', location: '', kind: 'activity', notes: '', confirmed: false };
}

function formFromItem(item: Item): FormState {
  return {
    start_time: item.start_time ?? '',
    title: item.title,
    location: item.location ?? '',
    kind: item.kind,
    notes: item.notes ?? '',
    confirmed: !!item.confirmation,
  };
}

function EventTab({ state }: { state: EditorState }): JSX.Element {
  const { days, items, selectedItemId, selectItem, updateItem, createItem, addForDate, closeAdd } = state;
  const selected = useMemo(
    () => items.find((it) => it.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );
  const isAdding = !selected && !!addForDate;
  const isEditing = !!selected;

  const [form, setForm] = useState<FormState>(blankForm);
  const [addDate, setAddDate] = useState<string>(addForDate ?? days[0]?.date ?? '');

  useEffect(() => {
    if (selected) setForm(formFromItem(selected));
  }, [selectedItemId]);

  useEffect(() => {
    if (addForDate) {
      setAddDate(addForDate);
      setForm(blankForm());
    }
  }, [addForDate]);

  function set<K extends keyof FormState>(k: K, v: FormState[K]): void {
    setForm((p) => ({ ...p, [k]: v }));
    if (isEditing && selected) {
      if (k === 'confirmed') {
        void updateItem(selected.id, { confirmation: v ? 'confirmed' : null });
      } else if (k === 'start_time') {
        void updateItem(selected.id, { start_time: (v as string) || null });
      } else {
        void updateItem(selected.id, { [k]: v } as Partial<Item>);
      }
    }
  }

  async function saveNew(): Promise<void> {
    if (!form.title.trim() || !addDate) return;
    const created = await createItem({
      day_date: addDate,
      title: form.title.trim(),
      kind: form.kind,
      start_time: form.start_time || null,
      location: form.location || null,
      notes: form.notes || null,
      confirmation: form.confirmed ? 'confirmed' : null,
    });
    if (created) selectItem(created.id);
    closeAdd();
  }

  if (!isAdding && !isEditing) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', gap: 16, padding: 32,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          background: 'var(--bg)', border: '1.5px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
            No item selected
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Click a timeline item to edit it, or use "+ Add" on any day.
          </div>
        </div>
        {days.length > 0 && (
          <button
            onClick={() => { state.openAdd(days[0].date); }}
            style={{
              padding: '8px 20px', borderRadius: 20,
              border: '1.5px solid var(--accent)', background: 'transparent',
              color: 'var(--accent)', fontSize: 13, cursor: 'pointer', fontWeight: 600,
            }}
          >+ New Item</button>
        )}
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            {isAdding ? 'New Item' : 'Edit Item'}
          </div>
          {isEditing && selected && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
              {days.find((d) => d.date === selected.day_date)?.label ?? selected.day_date}
            </div>
          )}
        </div>
        {isEditing && (
          <button
            onClick={() => selectItem(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 20, lineHeight: 1, padding: 4 }}
          >×</button>
        )}
      </div>

      {isAdding && (
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Day</label>
          <select value={addDate} onChange={(e) => setAddDate(e.target.value)} style={inputStyle}>
            {days.map((d) => <option key={d.date} value={d.date}>{d.label}</option>)}
          </select>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
        {!kindOwnsTime(form.kind) && (
          <div style={{ flex: '0 0 120px' }}>
            <label style={labelStyle}>Time</label>
            <input type="time" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} style={inputStyle} />
          </div>
        )}
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Status</label>
          <div style={{ display: 'flex', gap: 8, marginTop: 1 }}>
            {[true, false].map((c) => (
              <button
                key={String(c)}
                onClick={() => set('confirmed', c)}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 8,
                  border: '1.5px solid',
                  fontSize: 12.5, cursor: 'pointer', fontWeight: 600,
                  transition: 'all 0.15s',
                  borderColor: form.confirmed === c ? (c ? 'oklch(48% 0.12 160)' : 'oklch(62% 0.13 62)') : 'var(--border)',
                  background: form.confirmed === c ? (c ? 'oklch(95% 0.05 160)' : 'oklch(97% 0.04 65)') : 'transparent',
                  color: form.confirmed === c ? (c ? 'oklch(38% 0.12 160)' : 'oklch(45% 0.12 62)') : 'var(--text-muted)',
                }}
              >
                {c ? '✓ Confirmed' : '○ Unconfirmed'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Title</label>
        <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Item name…"
          style={{ ...inputStyle, fontSize: 15, fontWeight: 600 }} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Location</label>
        <input value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Where?" style={inputStyle} />
      </div>

      {isEditing && selected && (
        <TimezoneRow item={selected} updateItem={updateItem} />
      )}

      {isEditing && selected && (
        <KindAttributes item={selected} updateItem={updateItem as (id: number, patch: Partial<Item> & { attributes?: Record<string, unknown> }) => Promise<unknown>} />
      )}

      {isEditing && selected && state.participants.length > 0 && (
        <ParticipantPicker
          participants={state.participants}
          attended={selected.participant_ids ?? []}
          onChange={(ids) => void state.setItemParticipants(selected.id, ids)}
        />
      )}

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Type</label>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 1 }}>
          {KIND_LIST.map((k) => (
            <button
              key={k}
              onClick={() => set('kind', k)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 20,
                border: '1.5px solid', fontSize: 12, cursor: 'pointer', fontWeight: 600,
                transition: 'all 0.15s',
                borderColor: form.kind === k ? `oklch(60% 0.12 ${KIND_META[k].hue})` : 'var(--border)',
                background: form.kind === k ? `oklch(95% 0.05 ${KIND_META[k].hue})` : 'transparent',
                color: form.kind === k ? `oklch(38% 0.12 ${KIND_META[k].hue})` : 'var(--text-muted)',
              }}
            >
              <TypeDot kind={k} size={6} />
              {KIND_META[k].icon} {KIND_META[k].label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 22 }}>
        <label style={labelStyle}>Notes</label>
        <textarea
          value={form.notes} onChange={(e) => set('notes', e.target.value)}
          placeholder="Any details, confirmation numbers, tips…" rows={3}
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5, minHeight: 72 }}
        />
      </div>

      {isAdding && (
        <button
          onClick={() => void saveNew()}
          disabled={!form.title.trim()}
          style={{
            width: '100%', padding: 12, borderRadius: 10, border: 'none',
            background: form.title.trim() ? 'var(--accent)' : 'var(--border)',
            color: '#fff', fontSize: 14,
            cursor: form.title.trim() ? 'pointer' : 'default',
            fontWeight: 700, transition: 'all 0.15s',
          }}
        >
          Add to Timeline
        </button>
      )}
    </div>
  );
}

function TimezoneRow({
  item,
  updateItem,
}: {
  item: Item;
  updateItem: (id: number, patch: Partial<Item>) => Promise<unknown>;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [tz, setTz] = useState(item.tz ?? '');
  const [endTz, setEndTz] = useState(item.end_tz ?? '');
  const isTransit = item.kind === 'transit';

  useEffect(() => {
    setTz(item.tz ?? '');
    setEndTz(item.end_tz ?? '');
  }, [item.id, item.tz, item.end_tz]);

  const derive = async (): Promise<void> => {
    if (!item.location) return;
    setBusy(true);
    try {
      const r = await api.deriveItemTz(item.id);
      if (r.tz) {
        setTz(r.tz);
        await updateItem(item.id, { tz: r.tz, end_tz: r.end_tz });
        if (r.end_tz) setEndTz(r.end_tz);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>Time zone{isTransit ? ' (origin → destination)' : ''}</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          onBlur={() => { void updateItem(item.id, { tz: tz || null }); }}
          placeholder="e.g. Australia/Sydney"
          style={{ ...inputStyle, flex: 1 }}
        />
        {isTransit && (
          <input
            value={endTz}
            onChange={(e) => setEndTz(e.target.value)}
            onBlur={() => { void updateItem(item.id, { end_tz: endTz || null }); }}
            placeholder="e.g. Asia/Tokyo"
            style={{ ...inputStyle, flex: 1 }}
          />
        )}
        <button
          onClick={() => void derive()}
          disabled={busy || !item.location}
          title={item.location ? 'Derive from location' : 'Add a location first'}
          style={{
            padding: '0 10px', borderRadius: 6, border: '1.5px solid var(--border)',
            background: 'transparent', fontSize: 12, cursor: busy ? 'default' : 'pointer',
            color: 'var(--text-muted)', flexShrink: 0,
          }}
        >{busy ? '…' : '✨'}</button>
      </div>
    </div>
  );
}

function ParticipantPicker({
  participants, attended, onChange,
}: {
  participants: Array<{ id: number; display_name: string; color_hue: number | null }>;
  attended: number[];
  onChange: (ids: number[]) => void;
}): JSX.Element {
  const isAll = attended.length === 0;
  const toggle = (pid: number): void => {
    const set = new Set(attended);
    if (set.has(pid)) set.delete(pid);
    else set.add(pid);
    // If user re-selects everyone, collapse back to "all" (empty array)
    onChange(set.size === participants.length ? [] : Array.from(set));
  };
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={labelStyle}>Who's attending?</label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
        <button
          onClick={() => onChange([])}
          style={{
            padding: '4px 10px', borderRadius: 14, fontSize: 11.5, fontWeight: 600,
            border: '1.5px solid', borderColor: isAll ? 'var(--accent)' : 'var(--border)',
            background: isAll ? 'oklch(97% 0.02 75)' : 'transparent',
            color: isAll ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer',
          }}
        >Everyone</button>
        {participants.map((p) => {
          const on = attended.includes(p.id);
          const hue = p.color_hue ?? 200;
          return (
            <button
              key={p.id}
              onClick={() => toggle(p.id)}
              style={{
                padding: '4px 10px', borderRadius: 14, fontSize: 11.5, fontWeight: 600,
                border: '1.5px solid',
                borderColor: on ? `oklch(58% 0.14 ${hue})` : 'var(--border)',
                background: on ? `oklch(95% 0.05 ${hue})` : 'transparent',
                color: on ? `oklch(35% 0.14 ${hue})` : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >{p.display_name}</button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Comments tab ────────────────────────────────────────────────────────────

function CommentsTab({ state }: { state: EditorState }): JSX.Element {
  const { items, selectedItemId, selectItem, scrollToItem, commentCounts, refreshComments } = state;
  const [commentsByItem, setCommentsByItem] = useState<Record<number, Comment[]>>({});
  const [replies, setReplies] = useState<Record<number, string>>({});

  useEffect(() => {
    // Fetch comments for every item that has any.
    const ids = items.filter((it) => (commentCounts[it.id] ?? 0) > 0).map((it) => it.id);
    if (selectedItemId && !ids.includes(selectedItemId)) ids.push(selectedItemId);
    ids.forEach((id) => {
      api.listComments(id).then((r) => {
        setCommentsByItem((prev) => ({ ...prev, [id]: r.comments }));
      }).catch(() => {/* ignore */});
    });
  }, [items, selectedItemId, commentCounts]);

  async function postReply(itemId: number): Promise<void> {
    const text = (replies[itemId] ?? '').trim();
    if (!text) return;
    await api.postComment(itemId, text);
    setReplies((p) => ({ ...p, [itemId]: '' }));
    await refreshComments(itemId);
    const r = await api.listComments(itemId);
    setCommentsByItem((p) => ({ ...p, [itemId]: r.comments }));
  }

  const visible = items.filter((it) => (commentCounts[it.id] ?? 0) > 0 || it.id === selectedItemId);

  if (visible.length === 0) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--text-muted)', fontSize: 13,
      }}>
        No comments yet — select an item to start a thread.
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px 20px' }}>
      {visible.map((item) => {
        const comments = commentsByItem[item.id] ?? [];
        return (
          <div key={item.id} style={{ marginBottom: 24 }}>
            <button
              onClick={() => { selectItem(item.id); scrollToItem(item.id); }}
              title="Jump to item in timeline"
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '4px 0', marginBottom: 10, textAlign: 'left', width: '100%',
              }}
            >
              <TypeDot kind={item.kind} size={7} />
              <span style={{
                fontSize: 12.5, fontWeight: 700,
                color: item.id === selectedItemId ? 'var(--accent)' : 'var(--text)',
                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {item.title}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                {item.start_time ?? ''} · {item.day_date}
              </span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>

            {comments.map((c) => (
              <div key={c.id} style={{ display: 'flex', gap: 9, marginBottom: 10 }}>
                <Avatar name={c.author_name} userId={c.user_id} size={28} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 3 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{c.author_name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{relativeTime(c.created_at)}</span>
                  </div>
                  <div style={{
                    fontSize: 13, color: 'var(--text)', lineHeight: 1.5,
                    background: 'oklch(96.5% 0.008 75)',
                    border: '1px solid var(--border)',
                    borderRadius: '4px 10px 10px 10px',
                    padding: '7px 11px',
                  }}>
                    {c.body}
                  </div>
                </div>
              </div>
            ))}

            <div style={{ display: 'flex', gap: 8, paddingLeft: 37, marginTop: 6 }}>
              <input
                value={replies[item.id] ?? ''}
                onChange={(e) => setReplies((p) => ({ ...p, [item.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') void postReply(item.id); }}
                placeholder="Reply…"
                style={{
                  flex: 1, border: '1.5px solid var(--border)', borderRadius: 20,
                  padding: '6px 12px', fontSize: 12.5, background: 'var(--bg)',
                  color: 'var(--text)', outline: 'none',
                }}
              />
              <button
                onClick={() => void postReply(item.id)}
                style={{
                  padding: '6px 12px', borderRadius: 20, border: 'none',
                  background: 'var(--accent)', color: '#fff', fontSize: 12,
                  cursor: 'pointer', fontWeight: 600,
                }}
              >
                Post
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── AI tab ──────────────────────────────────────────────────────────────────

function AiTab({ state }: { state: EditorState }): JSX.Element {
  const { aiMessages, aiSuggestions, aiLoading, sendAiMessage, acceptSuggestion, rejectSuggestion } = state;
  const [input, setInput] = useState('');
  const [modifying, setModifying] = useState<Suggestion | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [aiMessages.length, aiLoading, aiSuggestions.length]);

  const send = (): void => {
    if (!input.trim() || aiLoading) return;
    void sendAiMessage(input.trim());
    setInput('');
  };

  const starters = [
    'What are we missing?',
    'Suggest a meal we should add',
    'Find a half-day activity for the gap',
    'Any closures we should worry about?',
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {aiMessages.length === 0 && aiSuggestions.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%', background: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--text)', marginBottom: 6 }}>
              Tripsheet AI
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              Accepted suggestions fly straight into your timeline.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {starters.map((s) => (
                <button
                  key={s} onClick={() => setInput(s)}
                  style={{
                    padding: '9px 14px', borderRadius: 8,
                    border: '1.5px solid var(--border)', background: 'var(--surface)',
                    color: 'var(--text)', fontSize: 12.5, cursor: 'pointer',
                    textAlign: 'left', transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                >{s}</button>
              ))}
            </div>
          </div>
        )}

        {aiMessages.map((m, i) => (
          <div key={i} style={{
            marginBottom: 12, display: 'flex',
            justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', gap: 8,
          }}>
            {m.role === 'assistant' && (
              <div style={{
                width: 26, height: 26, borderRadius: '50%', background: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, marginTop: 2,
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
              </div>
            )}
            <div style={{
              maxWidth: '82%', padding: '9px 13px',
              borderRadius: m.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
              background: m.role === 'user' ? 'var(--accent)' : 'oklch(96.5% 0.008 75)',
              color: m.role === 'user' ? '#fff' : 'var(--text)',
              fontSize: 13, lineHeight: 1.55,
              border: m.role === 'user' ? 'none' : '1px solid var(--border)',
              whiteSpace: 'pre-wrap',
            }}>
              {m.content}
            </div>
          </div>
        ))}

        {aiLoading && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%', background: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <div style={{
              padding: '9px 14px', borderRadius: '12px 12px 12px 3px',
              background: 'oklch(96.5% 0.008 75)', border: '1px solid var(--border)',
              display: 'flex', gap: 5, alignItems: 'center',
            }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)',
                  animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
          </div>
        )}

        {aiSuggestions.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{
              fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--text-muted)',
              marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              {aiSuggestions.length} suggestion{aiSuggestions.length !== 1 ? 's' : ''}
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>
            {aiSuggestions.map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                items={state.items}
                days={state.days}
                onAccept={(sugg) => void acceptSuggestion(sugg)}
                onModify={setModifying}
                onReject={(id) => void rejectSuggestion(id)}
              />
            ))}
          </div>
        )}

        <div ref={endRef} />
      </div>

      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
            placeholder="Ask about your trip…"
            style={{
              flex: 1, border: '1.5px solid var(--border)', borderRadius: 10,
              padding: '9px 13px', fontSize: 13, background: 'var(--bg)',
              color: 'var(--text)', outline: 'none', transition: 'border-color 0.15s',
            }}
            onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; }}
            onBlur={(e) => { e.target.style.borderColor = 'var(--border)'; }}
          />
          <button
            onClick={send}
            disabled={aiLoading || !input.trim()}
            style={{
              padding: '9px 14px', borderRadius: 10, border: 'none',
              background: input.trim() && !aiLoading ? 'var(--accent)' : 'var(--border)',
              color: input.trim() && !aiLoading ? '#fff' : 'var(--text-muted)',
              cursor: input.trim() && !aiLoading ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', transition: 'all 0.15s',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
      </div>

      {modifying && (
        <ModifyModal
          state={state}
          suggestion={modifying}
          onClose={() => setModifying(null)}
          onSave={async (payload) => {
            await state.patchSuggestion(modifying.id, { payload });
            await state.acceptSuggestion({ ...modifying, payload_json: JSON.stringify(payload) });
            setModifying(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Suggestion cards + modify modal ─────────────────────────────────────────

function parsePayload(s: Suggestion): Record<string, unknown> {
  try { return JSON.parse(s.payload_json) as Record<string, unknown>; } catch { return {}; }
}

const KIND_LABEL: Record<Suggestion['kind'], { label: string; hue: number; verb: string }> = {
  add_item:    { label: 'Add',    hue: 160, verb: 'Add' },
  modify_item: { label: 'Edit',   hue: 45,  verb: 'Apply' },
  remove_item: { label: 'Remove', hue: 15,  verb: 'Remove' },
  move_item:   { label: 'Move',   hue: 260, verb: 'Move' },
  note:        { label: 'Note',   hue: 75,  verb: 'Dismiss' },
};

function SuggestionCard({
  suggestion, items, days, onAccept, onModify, onReject,
}: {
  suggestion: Suggestion;
  items: Item[];
  days: Array<{ date: string; label: string }>;
  onAccept: (s: Suggestion) => void;
  onModify: (s: Suggestion) => void;
  onReject: (id: number) => void;
}): JSX.Element {
  const payload = parsePayload(suggestion);
  const target = suggestion.target_item_id
    ? items.find((it) => it.id === suggestion.target_item_id) ?? null
    : null;
  const meta = KIND_LABEL[suggestion.kind];
  const [flying, setFlying] = useState<'idle' | 'accept' | 'reject'>('idle');

  const accept = (): void => {
    setFlying('accept');
    setTimeout(() => onAccept(suggestion), 280);
  };
  const reject = (): void => {
    setFlying('reject');
    setTimeout(() => onReject(suggestion.id), 240);
  };

  const acceptable = suggestion.kind === 'add_item'
    || suggestion.kind === 'note'
    || (!!target && suggestion.kind !== 'add_item');
  const modifiable = suggestion.kind === 'add_item' || suggestion.kind === 'modify_item' || suggestion.kind === 'move_item';

  return (
    <div style={{
      background: 'var(--surface)', border: '1.5px solid var(--border)',
      borderLeft: `3px solid oklch(60% 0.13 ${meta.hue})`,
      borderRadius: 12, padding: '14px 16px', marginBottom: 10,
      transform: flying === 'accept' ? 'translateX(50px) scale(0.95)'
        : flying === 'reject' ? 'translateX(-50px) scale(0.95)' : 'none',
      opacity: flying === 'idle' ? 1 : 0,
      transition: 'all 0.28s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: `oklch(40% 0.12 ${meta.hue})`,
          background: `oklch(95% 0.05 ${meta.hue})`,
          padding: '2px 8px', borderRadius: 4,
        }}>
          {meta.label}
        </span>
        {suggestion.kind === 'add_item' && typeof payload.kind === 'string' && payload.kind in KIND_META && (
          <TypePill kind={payload.kind as ItemKind} small />
        )}
        {target && <TypePill kind={target.kind} small />}
      </div>

      <SuggestionBody kind={suggestion.kind} payload={payload} target={target} days={days} />

      <div style={{
        fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5,
        margin: '10px 0', padding: '7px 10px', background: 'var(--bg)', borderRadius: 7,
      }}>
        {suggestion.rationale}
      </div>

      <div style={{ display: 'flex', gap: 7 }}>
        <button onClick={reject} style={suggBtn('reject')}>✕ Skip</button>
        {modifiable && <button onClick={() => onModify(suggestion)} style={suggBtn('modify')}>✎ Edit</button>}
        <button onClick={accept} disabled={!acceptable} style={suggBtn('accept')}>
          {suggestion.kind === 'remove_item' ? '🗑 Remove'
            : suggestion.kind === 'move_item' ? '→ Move'
            : suggestion.kind === 'modify_item' ? '✓ Apply'
            : suggestion.kind === 'note' ? '✓ Got it'
            : '+ Add'}
        </button>
      </div>
    </div>
  );
}

function SuggestionBody({
  kind, payload, target, days,
}: {
  kind: Suggestion['kind'];
  payload: Record<string, unknown>;
  target: Item | null;
  days: Array<{ date: string; label: string }>;
}): JSX.Element {
  const str = (k: string): string => (typeof payload[k] === 'string' ? (payload[k] as string) : '');

  if (kind === 'add_item') {
    const title = String(payload.title ?? '(untitled)');
    return (
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>{title}</div>
        {str('location') && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{str('location')}</div>}
        {(str('start_time') || str('day_date')) && (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>
            {dayLabel(str('day_date'), days)}{str('start_time') ? ` · ${str('start_time')}` : ''}
          </div>
        )}
        {str('notes') && <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 6, fontStyle: 'italic' }}>{str('notes')}</div>}
      </div>
    );
  }

  if (kind === 'note') {
    return (
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
        {str('title') || 'Note'}
      </div>
    );
  }

  if (!target) {
    return <div style={{ fontSize: 12.5, color: 'oklch(50% 0.14 25)' }}>
      Target item not found (id {payload.target_item_id ? String(payload.target_item_id) : '?'}).
    </div>;
  }

  if (kind === 'remove_item') {
    return (
      <div>
        <div style={{
          fontSize: 14, fontWeight: 600, color: 'var(--text-muted)',
          textDecoration: 'line-through', textDecorationColor: 'oklch(55% 0.15 25)',
        }}>{target.title}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>
          {target.day_date}{target.start_time ? ` · ${target.start_time}` : ''}{target.location ? ` · ${target.location}` : ''}
        </div>
      </div>
    );
  }

  if (kind === 'move_item') {
    const toDay = str('day_date') || target.day_date;
    const toTime = str('start_time') || target.start_time || '';
    return (
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{target.title}</div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginTop: 6,
          fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums',
        }}>
          <span>{target.day_date}{target.start_time ? ` · ${target.start_time}` : ''}</span>
          <span style={{ color: 'var(--accent)' }}>→</span>
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>
            {toDay}{toTime ? ` · ${toTime}` : ''}
          </span>
        </div>
      </div>
    );
  }

  // modify_item — show a tiny diff of changed fields.
  const diffKeys = Object.keys(payload).filter(
    (k) => k in target && (target as unknown as Record<string, unknown>)[k] !== payload[k],
  );
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{target.title}</div>
      <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6 }}>
        {diffKeys.length === 0 ? (
          <span style={{ color: 'var(--text-muted)' }}>(no visible changes)</span>
        ) : (
          diffKeys.map((k) => (
            <div key={k}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{k}: </span>
              <span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>
                {formatVal((target as unknown as Record<string, unknown>)[k])}
              </span>
              <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>→</span>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{formatVal(payload[k])}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

function dayLabel(date: string, days: Array<{ date: string; label: string }>): string {
  if (!date) return '';
  return days.find((d) => d.date === date)?.label ?? date;
}

function suggBtn(variant: 'accept' | 'modify' | 'reject'): React.CSSProperties {
  const base: React.CSSProperties = {
    flex: 1, padding: '7px 0', borderRadius: 7,
    fontSize: 12.5, cursor: 'pointer', fontWeight: 700,
    border: '1.5px solid', transition: 'all 0.15s',
  };
  if (variant === 'accept') return { ...base, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', flex: 1.3 };
  return { ...base, background: 'transparent', color: 'var(--text-muted)', borderColor: 'var(--border)' };
}

function ModifyModal({
  state, suggestion, onSave, onClose,
}: {
  state: EditorState;
  suggestion: Suggestion;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const { days } = state;
  const [payload, setPayload] = useState<Record<string, unknown>>(() => parsePayload(suggestion));
  const set = (k: string, v: string): void => setPayload((p) => ({ ...p, [k]: v }));
  const dayDate = (typeof payload.day_date === 'string' && payload.day_date) || days[0]?.date || '';
  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'oklch(15% 0.02 65 / 0.4)', zIndex: 300,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 14, padding: 26,
        width: 380, boxShadow: '0 20px 50px oklch(15% 0.04 65 / 0.2)',
        border: '1px solid var(--border)',
      }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, marginBottom: 18 }}>
          Edit before adding
        </div>
        {(['title', 'location', 'start_time', 'notes'] as const).map((k) => (
          <div key={k} style={{ marginBottom: 12 }}>
            <label style={labelStyle}>{k === 'start_time' ? 'Time' : k[0].toUpperCase() + k.slice(1)}</label>
            <input
              value={(payload[k] as string) ?? ''}
              onChange={(e) => set(k, e.target.value)}
              type={k === 'start_time' ? 'time' : 'text'}
              style={inputStyle}
            />
          </div>
        ))}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Add to Day</label>
          <select
            value={dayDate}
            onChange={(e) => set('day_date', e.target.value)}
            style={inputStyle}
          >
            {days.map((d) => <option key={d.date} value={d.date}>{d.label}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '9px 16px', borderRadius: 8,
              border: '1.5px solid var(--border)', background: 'transparent',
              fontSize: 13, cursor: 'pointer', color: 'var(--text-muted)',
            }}
          >Cancel</button>
          <button
            onClick={() => void onSave({ ...payload, day_date: dayDate })}
            style={{
              padding: '9px 16px', borderRadius: 8, border: 'none',
              background: 'var(--accent)', color: '#fff', fontSize: 13,
              cursor: 'pointer', fontWeight: 700,
            }}
          >Add</button>
        </div>
      </div>
    </div>
  );
}

// ─── PDF preview tab ─────────────────────────────────────────────────────────

function PdfTab({ state }: { state: EditorState }): JSX.Element {
  const { docs, refreshDocs } = state;
  const [selected, setSelected] = useState<ReferenceDoc | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  useEffect(() => {
    if (docs.length === 0) {
      setSelected(null);
      return;
    }
    if (!selected || !docs.some((d) => d.id === selected.id)) {
      const firstComplete = docs.find((d) => d.parse_status === 'complete') ?? docs[0];
      setSelected(firstComplete);
    } else {
      // Keep the selected doc's parse_status fresh.
      const updated = docs.find((d) => d.id === selected.id);
      if (updated && updated !== selected) setSelected(updated);
    }
  }, [docs]);

  // Poll docs that are still parsing, until they flip to complete/error.
  useEffect(() => {
    if (!docs.some((d) => d.parse_status === 'pending' || d.parse_status === 'running')) return;
    const t = setInterval(() => { void refreshDocs(); }, 2500);
    return () => clearInterval(t);
  }, [docs, refreshDocs]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', gap: 6, padding: '10px 16px', alignItems: 'center',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', flex: 1 }}>
          {docs.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelected(d)}
              title={d.parse_status === 'error' && d.parse_error ? d.parse_error : d.title}
              style={{
                padding: '6px 12px', borderRadius: 16,
                border: `1.5px solid ${selected?.id === d.id ? 'var(--accent)' : 'var(--border)'}`,
                background: selected?.id === d.id ? 'oklch(97% 0.02 75)' : 'transparent',
                color: selected?.id === d.id ? 'var(--accent)' : 'var(--text-muted)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {d.title}
              <ParseBadge status={d.parse_status} />
            </button>
          ))}
        </div>
        {selected && (
          <DocDeleteButton
            doc={selected}
            onDeleted={() => { setSelected(null); void refreshDocs(); }}
          />
        )}
        <button
          onClick={() => setUploadOpen(true)}
          style={{
            padding: '6px 12px', borderRadius: 16, border: '1.5px solid var(--accent)',
            background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 700,
            cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          + Upload
        </button>
      </div>
      {selected ? (
        selected.parse_status === 'complete' || selected.parse_status === 'running' || selected.parse_status === 'pending' ? (
          <iframe
            key={selected.id}
            src={api.docFileUrl(selected.id)}
            title={selected.title}
            style={{ flex: 1, border: 'none', background: '#fff' }}
          />
        ) : (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 32, color: 'oklch(45% 0.12 25)', fontSize: 13, textAlign: 'center',
          }}>
            Parse failed: {selected.parse_error ?? 'unknown error'}
          </div>
        )
      ) : (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 32, color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', lineHeight: 1.6,
        }}>
          Upload a past itinerary or travel journal to reference it while planning.
        </div>
      )}
      {uploadOpen && (
        <UploadDrawer
          tripId={state.trip.id}
          onClose={() => setUploadOpen(false)}
          onUploaded={(doc) => {
            setUploadOpen(false);
            setSelected(doc);
            void refreshDocs();
          }}
        />
      )}
    </div>
  );
}

function DocDeleteButton({
  doc, onDeleted,
}: { doc: ReferenceDoc; onDeleted: () => void }): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <button
      title={confirming
        ? 'Click again to confirm — PDF, parsed items, and any pending suggestions will be removed'
        : `Delete "${doc.title}"`}
      disabled={busy}
      onClick={async () => {
        if (!confirming) {
          setConfirming(true);
          setTimeout(() => setConfirming(false), 3000);
          return;
        }
        setBusy(true);
        try { await api.deleteDoc(doc.id); onDeleted(); }
        finally { setBusy(false); setConfirming(false); }
      }}
      style={{
        padding: 0, width: 26, height: 26, borderRadius: 16,
        border: '1.5px solid', borderColor: confirming ? 'oklch(58% 0.16 25)' : 'var(--border)',
        background: confirming ? 'oklch(58% 0.16 25)' : 'transparent',
        color: confirming ? '#fff' : 'var(--text-muted)',
        fontSize: 14, lineHeight: 1, cursor: busy ? 'default' : 'pointer',
        flexShrink: 0, fontWeight: 600,
      }}
    >×</button>
  );
}

function ParseBadge({ status }: { status: ReferenceDoc['parse_status'] }): JSX.Element | null {
  if (status === 'complete') return null;
  const style: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
    padding: '1px 6px', borderRadius: 8,
  };
  if (status === 'error') {
    return <span style={{ ...style, background: 'oklch(93% 0.06 25)', color: 'oklch(45% 0.15 25)' }}>err</span>;
  }
  return <span style={{ ...style, background: 'oklch(94% 0.04 75)', color: 'oklch(50% 0.08 75)' }}>parsing…</span>;
}

export function UploadDrawer({
  tripId, onClose, onUploaded,
}: {
  tripId: number | null;
  onClose: () => void;
  onUploaded: (doc: ReferenceDoc) => void;
}): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!file || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('title', title.trim());
      if (tripId != null) form.set('trip_id', String(tripId));
      const { doc } = await api.uploadDoc(form);
      onUploaded(doc);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'oklch(15% 0.02 65 / 0.4)', zIndex: 300,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 14, padding: 26,
        width: 420, boxShadow: '0 20px 50px oklch(15% 0.04 65 / 0.2)',
        border: '1px solid var(--border)',
      }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, marginBottom: 18 }}>
          Upload reference PDF
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>File</label>
          <input
            type="file" accept="application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.pdf$/i, ''));
            }}
            style={{ fontSize: 13, color: 'var(--text)' }}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Give it a name you'll recognize later" style={inputStyle} />
        </div>

        <div style={{
          fontSize: 12, color: 'var(--text-muted)', marginBottom: 18,
          lineHeight: 1.5, padding: '10px 12px', borderRadius: 8,
          background: 'oklch(97% 0.015 75)', border: '1px dashed var(--border)',
        }}>
          {tripId == null ? (
            <>Drop in any travel document. We'll figure out what it is —
            <strong> itineraries become trips automatically</strong>, journals and notes go into
            your reference library to inform future AI suggestions.</>
          ) : (
            <>Drop in a confirmation, an itinerary, or any travel doc.
            <strong> Confirmations attach to matching items on this trip</strong>; itinerary lines
            you don't already have appear as swipe-deck suggestions.</>
          )}
        </div>

        {error && (
          <div style={{ fontSize: 12, color: 'oklch(45% 0.15 25)', marginBottom: 12 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose} disabled={busy}
            style={{ padding: '9px 16px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'transparent', fontSize: 13, cursor: 'pointer', color: 'var(--text-muted)' }}
          >Cancel</button>
          <button
            onClick={() => void submit()} disabled={busy || !file || !title.trim()}
            style={{
              padding: '9px 16px', borderRadius: 8, border: 'none',
              background: busy || !file || !title.trim() ? 'var(--border)' : 'var(--accent)',
              color: '#fff', fontSize: 13, fontWeight: 700,
              cursor: busy || !file || !title.trim() ? 'default' : 'pointer',
            }}
          >{busy ? 'Uploading…' : 'Upload'}</button>
        </div>
      </div>
    </div>
  );
}
