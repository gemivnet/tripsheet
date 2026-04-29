import { useEffect, useRef, useState } from 'react';
import { api, type AiEvent, type AiJob, type DevState, type ExchangeFull } from '../api.js';

const MODELS = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-haiku-4-5-20251001',
];

/**
 * Footer dev toolbar. Polls /api/dev/state on a 1s tick (slows to 5s
 * after a minute of inactivity) and merges new events into a rolling
 * client-side log. Hides itself silently in production builds where
 * /api/dev/* isn't mounted.
 */
export function DevToolbar(): JSX.Element | null {
  const [state, setState] = useState<DevState | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'queue' | 'log' | 'exchanges'>('queue');
  const [pickedExchangeId, setPickedExchangeId] = useState<number | string | null>(null);
  const [pickedExchange, setPickedExchange] = useState<ExchangeFull | null>(null);
  const [confirmNuke, setConfirmNuke] = useState(false);

  const sinceRef = useRef(0);
  const eventsRef = useRef<AiEvent[]>([]);
  const [, forceTick] = useState(0);
  const lastActivityRef = useRef(Date.now());

  const refresh = async (): Promise<void> => {
    try {
      const s = await api.devState(sinceRef.current);
      // accumulate events client-side so the feed survives across polls
      if (s.events.length > 0) {
        eventsRef.current = [...eventsRef.current, ...s.events].slice(-300);
        sinceRef.current = s.events[s.events.length - 1].id;
        lastActivityRef.current = Date.now();
      }
      if (s.jobs.length > 0) lastActivityRef.current = Date.now();
      setState(s);
      setAvailable(true);
      forceTick((t) => t + 1);
    } catch {
      setAvailable(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (!available) return;
    let interval = 1000;
    const id = setInterval(() => {
      // Slow to 5s if nothing's happened for 60s; speed back up on activity.
      const idle = Date.now() - lastActivityRef.current;
      const target = idle > 60_000 ? 5_000 : 1_000;
      if (target !== interval) {
        interval = target;
        clearInterval(id);
        return;
      }
      void refresh();
    }, interval);
    return () => clearInterval(id);
  }, [available, open]);

  if (available === false) return null;
  if (!state) return null;

  const totalTokens = state.usage.input_tokens + state.usage.output_tokens;
  const activeJobs = state.jobs;
  const events = eventsRef.current;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        background: 'oklch(20% 0.02 65)',
        color: '#fff',
        fontSize: 11,
        borderTop: '1px solid oklch(35% 0.02 65)',
        fontFamily: 'ui-monospace, SF Mono, monospace',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 10px' }}>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            background: 'none',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 11,
            fontFamily: 'inherit',
          }}
        >
          dev {open ? '▾' : '▸'}
        </button>

        <span
          style={{
            color: state.ai_paused ? 'oklch(72% 0.16 25)' : 'oklch(72% 0.14 150)',
            fontWeight: 600,
          }}
        >
          ai: {state.ai_paused ? 'PAUSED' : 'live'}
        </span>
        <span style={{ color: 'oklch(70% 0.04 65)' }}>{state.model}</span>
        <span style={{ color: 'oklch(70% 0.04 65)' }}>conc: {state.concurrency}</span>

        {activeJobs.length > 0 &&
          (() => {
            const running = activeJobs.filter((j) => j.status !== 'queued').length;
            const queued = activeJobs.length - running;
            const streamed = activeJobs.reduce((s, j) => s + (j.output_tokens ?? 0), 0);
            return (
              <span style={{ color: 'oklch(82% 0.12 200)' }}>
                ⏵ {running} running{queued > 0 ? `, ${queued} queued` : ''}
                {streamed > 0 && (
                  <span style={{ marginLeft: 4 }}>· {streamed.toLocaleString()}t streamed</span>
                )}
              </span>
            );
          })()}

        <span style={{ color: 'oklch(70% 0.04 65)' }}>
          tokens: {state.usage.requests} req · {totalTokens.toLocaleString()}
        </span>
        <div style={{ flex: 1 }} />
      </div>

      {open && (
        <>
          <div
            style={{
              padding: '8px 10px',
              borderTop: '1px solid oklch(28% 0.02 65)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <button onClick={() => void api.devPauseAi(!state.ai_paused).then(refresh)} style={btn}>
              {state.ai_paused ? '▶ resume ai' : '⏸ pause ai'}
            </button>
            <select
              value={state.model}
              onChange={(e) => void api.devSetModel(e.target.value || null).then(refresh)}
              style={{ ...btn, padding: '3px 6px' }}
            >
              {[state.model, ...MODELS.filter((m) => m !== state.model)].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'oklch(70% 0.04 65)' }}
            >
              concurrency
              <input
                type="number"
                min={1}
                max={8}
                value={state.concurrency}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) void api.devSetConcurrency(n).then(refresh);
                }}
                style={{ ...btn, width: 40, padding: '3px 6px' }}
              />
            </label>
            <button onClick={() => void api.devReparseAll().then(refresh)} style={btn}>
              reparse all docs
            </button>
            <button onClick={() => void api.devResetUsage().then(refresh)} style={btn}>
              reset meter
            </button>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', gap: 4 }}>
              {(['queue', 'log', 'exchanges'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  style={{
                    ...btn,
                    background: view === v ? 'oklch(40% 0.02 65)' : 'oklch(28% 0.02 65)',
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
            {confirmNuke ? (
              <>
                <span style={{ color: 'oklch(78% 0.16 25)' }}>nuke db?</span>
                <button
                  onClick={() =>
                    void api.devNuke().then(() => {
                      setConfirmNuke(false);
                      void refresh();
                      window.location.reload();
                    })
                  }
                  style={{ ...btn, color: 'oklch(78% 0.16 25)' }}
                >
                  yes, wipe
                </button>
                <button onClick={() => setConfirmNuke(false)} style={btn}>
                  cancel
                </button>
              </>
            ) : (
              <button onClick={() => setConfirmNuke(true)} style={btn}>
                💥 nuke
              </button>
            )}
          </div>

          <div
            style={{
              borderTop: '1px solid oklch(28% 0.02 65)',
              background: 'oklch(15% 0.02 65)',
              maxHeight: 220,
              overflow: 'auto',
              padding: '6px 10px',
              fontSize: 10.5,
              lineHeight: 1.5,
            }}
          >
            {view === 'queue' && <QueuePanel jobs={activeJobs} />}
            {view === 'log' && <LogPanel events={events} />}
            {view === 'exchanges' && (
              <ExchangesPanel
                summaries={state.exchanges}
                pickedId={pickedExchangeId}
                pickedFull={pickedExchange}
                onPick={async (id) => {
                  setPickedExchangeId(id);
                  if (id == null) {
                    setPickedExchange(null);
                    return;
                  }
                  try {
                    const r = await api.devGetExchange(id);
                    setPickedExchange(r.exchange);
                  } catch {
                    setPickedExchange(null);
                  }
                }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function QueuePanel({ jobs }: { jobs: AiJob[] }): JSX.Element {
  if (jobs.length === 0) {
    return <div style={{ color: 'oklch(60% 0.04 65)' }}>queue empty — no AI calls in flight</div>;
  }
  const now = Date.now();
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {jobs.map((j) => {
        const queuedFor = ((now - new Date(j.queued_at).getTime()) / 1000).toFixed(1);
        const runningFor = j.started_at
          ? ((now - new Date(j.started_at).getTime()) / 1000).toFixed(1)
          : null;
        return (
          <div key={j.id} style={{ display: 'flex', gap: 10 }}>
            <span style={{ color: statusColor(j.status), fontWeight: 600, width: 76 }}>
              {j.status}
            </span>
            <span style={{ width: 70 }}>{j.caller}</span>
            <span style={{ color: 'oklch(70% 0.04 65)', width: 110 }}>
              {runningFor != null ? `running ${runningFor}s` : `queued ${queuedFor}s`}
            </span>
            <span style={{ color: 'oklch(70% 0.04 65)' }}>
              {j.output_tokens != null ? `${j.output_tokens.toLocaleString()} tok streamed` : ''}
              {j.attempt > 1 ? `  · attempt ${j.attempt}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LogPanel({ events }: { events: AiEvent[] }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events.length]);
  if (events.length === 0) {
    return <div style={{ color: 'oklch(60% 0.04 65)' }}>log empty</div>;
  }
  return (
    <div ref={ref} style={{ display: 'grid', gap: 2 }}>
      {events.slice(-200).map((e) => (
        <div
          key={e.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '70px 90px 90px 1fr',
            gap: 10,
            color: eventColor(e.kind),
          }}
        >
          <span style={{ color: 'oklch(60% 0.04 65)' }}>{e.at.slice(11, 19)}</span>
          <span style={{ fontWeight: 600 }}>{e.kind}</span>
          <span style={{ color: 'oklch(78% 0.04 65)' }}>{e.caller}</span>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {e.message ?? ''}
            {e.output_tokens != null ? ` · ${e.output_tokens.toLocaleString()} tok` : ''}
            {e.delay_ms != null ? ` · backoff ${e.delay_ms}ms` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

function ExchangesPanel({
  summaries,
  pickedId,
  pickedFull,
  onPick,
}: {
  summaries: DevState['exchanges'];
  pickedId: number | string | null;
  pickedFull: ExchangeFull | null;
  onPick: (id: number | string | null) => void | Promise<void>;
}): JSX.Element {
  // Auto-select latest when nothing picked yet, or when the picked id is
  // no longer present (e.g. a live: entry just completed and was replaced
  // by its numeric counterpart at the top of the list).
  useEffect(() => {
    if (summaries.length === 0) return;
    const stillThere = pickedId != null && summaries.some((s) => s.id === pickedId);
    if (!stillThere) void onPick(summaries[0].id);
  }, [summaries.length === 0 ? null : summaries[0]?.id]);

  // While an in-flight exchange is selected, re-fetch it so partial_text
  // grows live in the response pane.
  useEffect(() => {
    if (pickedId == null) return;
    if (typeof pickedId !== 'string' || !pickedId.startsWith('live:')) return;
    const t = setInterval(() => {
      void onPick(pickedId);
    }, 750);
    return () => clearInterval(t);
  }, [pickedId]);

  if (summaries.length === 0) {
    return <div style={{ color: 'oklch(60% 0.04 65)' }}>no AI calls yet</div>;
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <select
          value={pickedId ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) {
              void onPick(null);
              return;
            }
            void onPick(v.startsWith('live:') ? v : Number(v));
          }}
          style={{ ...btn, padding: '3px 6px', fontSize: 11 }}
        >
          {summaries.map((s) => (
            <option key={String(s.id)} value={String(s.id)}>
              {s.at.slice(11, 19)} · {s.caller} · in {s.input_tokens ?? '?'} / out{' '}
              {s.output_tokens ?? '?'}
              {s.in_flight ? ' · streaming…' : ''}
              {s.error ? ' · ERROR' : ''}
            </option>
          ))}
        </select>
        <span style={{ color: 'oklch(60% 0.04 65)' }}>
          {summaries.length} of last {summaries.length} kept in memory
        </span>
      </div>
      {pickedFull ? (
        <div>
          {pickedFull.error && (
            <div
              style={{
                padding: 8,
                background: 'oklch(28% 0.06 25)',
                borderRadius: 4,
                color: 'oklch(85% 0.1 25)',
                marginBottom: 6,
              }}
            >
              {pickedFull.error}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 3, color: 'oklch(80% 0.04 65)' }}>
                request
              </div>
              <pre style={preStyle}>{JSON.stringify(pickedFull.request, null, 2)}</pre>
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 3, color: 'oklch(80% 0.04 65)' }}>
                response{pickedFull.in_flight ? ' · streaming…' : ''}
              </div>
              <pre style={preStyle}>
                {pickedFull.in_flight
                  ? (pickedFull.partial_text ?? '')
                  : JSON.stringify(pickedFull.response, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ color: 'oklch(60% 0.04 65)' }}>loading…</div>
      )}
    </div>
  );
}

function statusColor(s: AiJob['status']): string {
  if (s === 'streaming') return 'oklch(82% 0.12 200)';
  if (s === 'running') return 'oklch(78% 0.14 150)';
  return 'oklch(78% 0.12 70)';
}
function eventColor(k: AiEvent['kind']): string {
  if (k === 'completed') return 'oklch(78% 0.14 150)';
  if (k === 'error') return 'oklch(78% 0.16 25)';
  if (k === 'retry') return 'oklch(78% 0.14 70)';
  if (k === 'streaming') return 'oklch(82% 0.12 200)';
  if (k === 'started') return 'oklch(85% 0.04 65)';
  return 'oklch(70% 0.04 65)';
}

const btn: React.CSSProperties = {
  background: 'oklch(28% 0.02 65)',
  color: '#fff',
  border: '1px solid oklch(40% 0.02 65)',
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: 11,
  fontFamily: 'inherit',
  cursor: 'pointer',
};
const preStyle: React.CSSProperties = {
  background: 'oklch(10% 0.02 65)',
  padding: 6,
  borderRadius: 4,
  overflow: 'auto',
  maxHeight: 180,
  fontSize: 10,
  lineHeight: 1.4,
  margin: 0,
};
