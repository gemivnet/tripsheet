import { useEffect, useState } from 'react';
import { api, type ReferenceDoc, type Trip } from '../api.js';
import { inputStyle, labelStyle } from '../components/shared.js';
import { UploadDrawer } from '../components/RightPane.js';

export function TripsPage({ onOpen }: { onOpen: (id: number) => void }): JSX.Element {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [docs, setDocs] = useState<ReferenceDoc[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);

  const refreshTrips = async (): Promise<void> => {
    const r = await api.listTrips();
    setTrips(r.trips);
  };
  const refreshDocs = async (): Promise<void> => {
    const r = await api.listDocs({ library: true });
    setDocs(r.docs);
  };

  useEffect(() => {
    void refreshTrips().finally(() => setLoading(false));
    void refreshDocs();
  }, []);

  // Poll while any doc is still parsing. When a parse completes that
  // built a new trip (derived_trip_id), refresh the trips list too so
  // the new trip card appears without a manual reload.
  useEffect(() => {
    if (!docs.some((d) => d.parse_status === 'pending' || d.parse_status === 'running')) return;
    const t = setInterval(() => {
      void (async () => {
        const before = docs;
        await refreshDocs();
        const r = await api.listDocs({ library: true });
        const newlyDerived = r.docs.some(
          (d) =>
            d.derived_trip_id != null &&
            !before.find((b) => b.id === d.id && b.derived_trip_id != null),
        );
        if (newlyDerived) await refreshTrips();
      })();
    }, 2500);
    return () => clearInterval(t);
  }, [docs]);

  return (
    <div className="trips-page">
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: 20,
      }}>
        <h2>Your trips</h2>
        {!creating && trips.length > 0 && (
          <button className="primary" onClick={() => setCreating(true)} style={primaryBtnStyle}>
            + New trip
          </button>
        )}
      </div>

      {loading ? (
        <div className="empty" style={emptyStyle}>Loading…</div>
      ) : trips.length === 0 && !creating ? (
        <div className="empty" style={{ ...emptyStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '48px 24px' }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600,
            letterSpacing: '-0.02em', color: 'var(--text)',
          }}>No trips yet.</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Start with a name, dates, and where you're headed.
          </div>
          <button className="primary" onClick={() => setCreating(true)} style={primaryBtnStyle}>
            + Plan your first trip
          </button>
        </div>
      ) : (
        <div className="trips-list">
          {trips.map((t) => (
            <TripCard key={t.id} trip={t} onOpen={() => onOpen(t.id)} onDeleted={refreshTrips} />
          ))}
        </div>
      )}

      {creating && (
        <div style={{ marginTop: 24 }}>
          <NewTripForm
            onCancel={() => setCreating(false)}
            onCreated={(t) => {
              setTrips((prev) => [t, ...prev]);
              setCreating(false);
              onOpen(t.id);
            }}
          />
        </div>
      )}

      <div style={{ marginTop: 48 }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          marginBottom: 16,
        }}>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700,
            letterSpacing: '-0.02em',
          }}>
            Reference library
          </h2>
          <button onClick={() => setUploadOpen(true)} style={primaryBtnStyle}>
            + Upload PDF
          </button>
        </div>

        {docs.length === 0 ? (
          <div style={{ ...emptyStyle, padding: '28px 24px', fontSize: 13 }}>
            Upload past itineraries or travel journals — the AI will use them as priors
            for suggestions on every trip.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {docs.map((d) => (
              <DocRow key={d.id} doc={d} onReparsed={refreshDocs} onOpenTrip={onOpen} />
            ))}
          </div>
        )}
      </div>

      {uploadOpen && (
        <UploadDrawer
          tripId={null}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            setUploadOpen(false);
            void refreshDocs();
          }}
        />
      )}
    </div>
  );
}

function TripCard({
  trip, onOpen, onDeleted,
}: { trip: Trip; onOpen: () => void; onDeleted: () => Promise<void> }): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="trip-card" onClick={() => !confirming && onOpen()} style={{ position: 'relative' }}>
      <h3>{trip.name}</h3>
      <div className="meta">
        {trip.start_date} → {trip.end_date}
        {trip.destination ? ` · ${trip.destination}` : ''}
      </div>
      <button
        title={confirming ? 'Click again to confirm — trip & all items will be deleted' : 'Delete this trip'}
        onClick={async (e) => {
          e.stopPropagation();
          if (!confirming) { setConfirming(true); setTimeout(() => setConfirming(false), 3000); return; }
          setBusy(true);
          try { await api.deleteTrip(trip.id); await onDeleted(); }
          finally { setBusy(false); setConfirming(false); }
        }}
        disabled={busy}
        style={{
          position: 'absolute', top: 8, right: 8,
          background: confirming ? 'oklch(58% 0.16 25)' : 'transparent',
          color: confirming ? '#fff' : 'var(--text-muted)',
          border: '1.5px solid', borderColor: confirming ? 'oklch(58% 0.16 25)' : 'var(--border)',
          borderRadius: 6, width: 22, height: 22, padding: 0,
          fontSize: 13, lineHeight: 1, cursor: 'pointer', fontWeight: 600,
        }}
      >×</button>
    </div>
  );
}

function DocRow({
  doc,
  onReparsed,
  onOpenTrip,
}: {
  doc: ReferenceDoc;
  onReparsed: () => Promise<void>;
  onOpenTrip?: (id: number) => void;
}): JSX.Element {
  const [reparsing, setReparsing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busyDel, setBusyDel] = useState(false);
  const canReparse = doc.parse_status !== 'running' || isStale(doc.uploaded_at);

  const onDelete = async (): Promise<void> => {
    if (!confirmDel) {
      setConfirmDel(true);
      setTimeout(() => setConfirmDel(false), 3000);
      return;
    }
    setBusyDel(true);
    try { await api.deleteDoc(doc.id); await onReparsed(); }
    finally { setBusyDel(false); setConfirmDel(false); }
  };

  const reparse = async (): Promise<void> => {
    setReparsing(true);
    try {
      await api.reparseDoc(doc.id);
      await onReparsed();
    } catch {
      // Keep UI state clean on failure; status will show via badge once
      // the next poll comes in.
    } finally {
      setReparsing(false);
    }
  };

  return (
    <div style={{
      background: 'var(--surface)', padding: '12px 16px', borderRadius: 10,
      border: '1.5px solid var(--border)',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600,
          letterSpacing: '-0.01em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{doc.title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
          {kindLabel(doc.kind)} · {new Date(doc.uploaded_at).toLocaleDateString()}
          {doc.parsed_summary ? ` · ${truncate(doc.parsed_summary, 90)}` : ''}
        </div>
        {doc.derived_trip_id != null && onOpenTrip && (
          <button
            onClick={() => onOpenTrip(doc.derived_trip_id!)}
            style={{
              marginTop: 6, background: 'none', border: 'none', padding: 0,
              color: 'var(--accent)', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', textAlign: 'left',
            }}
          >
            → Open the trip built from this PDF
          </button>
        )}
        {doc.parse_status === 'error' && doc.parse_error && (
          <div style={{ fontSize: 11, color: 'oklch(45% 0.15 25)', marginTop: 4 }}>
            {truncate(doc.parse_error, 180)}
          </div>
        )}
      </div>
      <DocStatusBadge status={doc.parse_status} />
      {canReparse && (
        <button
          onClick={() => void reparse()}
          disabled={reparsing}
          title={doc.parse_status === 'complete' ? 'Reparse this PDF' : 'Retry parsing'}
          style={{
            background: 'none', border: '1.5px solid var(--border)',
            color: 'var(--text-muted)', fontSize: 11, fontWeight: 600,
            padding: '5px 10px', borderRadius: 6, cursor: reparsing ? 'default' : 'pointer',
            flexShrink: 0,
          }}
        >
          {reparsing ? '…' : doc.parse_status === 'complete' ? 'Reparse' : 'Retry'}
        </button>
      )}
      <button
        onClick={() => void onDelete()}
        disabled={busyDel}
        title={confirmDel
          ? 'Click again to confirm — PDF, parsed items, and any pending suggestions will be removed'
          : 'Delete this PDF'}
        style={{
          background: confirmDel ? 'oklch(58% 0.16 25)' : 'transparent',
          color: confirmDel ? '#fff' : 'var(--text-muted)',
          border: '1.5px solid', borderColor: confirmDel ? 'oklch(58% 0.16 25)' : 'var(--border)',
          width: 26, height: 26, padding: 0, borderRadius: 6,
          fontSize: 14, lineHeight: 1, cursor: busyDel ? 'default' : 'pointer',
          flexShrink: 0, fontWeight: 600,
        }}
      >×</button>
    </div>
  );
}

// A doc stuck in `running` for >5 min is almost certainly a crashed
// parse from a previous server session. Let the user retry.
function isStale(uploadedAt: string): boolean {
  return Date.now() - new Date(uploadedAt).getTime() > 5 * 60 * 1000;
}

function DocStatusBadge({ status }: { status: ReferenceDoc['parse_status'] }): JSX.Element {
  const style: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
    padding: '3px 8px', borderRadius: 6, flexShrink: 0,
  };
  if (status === 'complete') {
    return <span style={{ ...style, background: 'oklch(94% 0.05 150)', color: 'oklch(40% 0.12 150)' }}>parsed</span>;
  }
  if (status === 'error') {
    return <span style={{ ...style, background: 'oklch(93% 0.06 25)', color: 'oklch(45% 0.15 25)' }}>error</span>;
  }
  return <span style={{ ...style, background: 'oklch(94% 0.04 75)', color: 'oklch(50% 0.08 75)' }}>parsing…</span>;
}

function kindLabel(kind: string): string {
  if (kind === 'past_itinerary') return 'Past itinerary';
  if (kind === 'journal') return 'Travel journal';
  if (kind === 'external_itinerary') return 'External itinerary';
  if (kind === 'confirmation') return 'Confirmation';
  if (kind === 'other') return 'Reference';
  return 'Reference';
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function NewTripForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (trip: Trip) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [destination, setDestination] = useState('');
  const [goals, setGoals] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.createTrip({
        name,
        start_date: startDate,
        end_date: endDate,
        destination: destination || null,
        goals: goals || null,
      });
      onCreated(res.trip);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      style={{
        background: 'var(--surface)',
        border: '1.5px solid var(--border)',
        borderRadius: 12,
        padding: 22,
        display: 'grid',
        gap: 14,
        boxShadow: '0 4px 16px oklch(20% 0.04 65 / 0.04)',
      }}
    >
      <div style={{
        fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600,
        letterSpacing: '-0.02em', marginBottom: 4,
      }}>
        New trip
      </div>

      <div>
        <label style={labelStyle}>Name</label>
        <input
          type="text"
          placeholder="e.g. Springfield spring break"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          style={inputStyle}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={labelStyle}>Start date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>End date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
            style={inputStyle}
          />
        </div>
      </div>

      <div>
        <label style={labelStyle}>Destination</label>
        <input
          type="text"
          placeholder="Where are you headed?"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          style={inputStyle}
        />
      </div>

      <div>
        <label style={labelStyle}>Goals</label>
        <textarea
          placeholder="What do you want out of this trip? (helps the AI tailor suggestions)"
          value={goals}
          onChange={(e) => setGoals(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', minHeight: 64 }}
        />
      </div>

      {error && (
        <div style={{
          color: 'oklch(52% 0.18 25)', fontSize: 13,
          background: 'oklch(96% 0.04 25)', padding: '8px 12px', borderRadius: 6,
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button type="button" onClick={onCancel} style={secondaryBtnStyle}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy} style={primaryBtnStyle}>
          {busy ? '…' : 'Create trip'}
        </button>
      </div>
    </form>
  );
}

const primaryBtnStyle: React.CSSProperties = {
  padding: '9px 16px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  fontWeight: 700,
  fontSize: 13.5,
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '9px 16px',
  borderRadius: 8,
  border: '1.5px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-muted)',
  fontWeight: 600,
  fontSize: 13.5,
  cursor: 'pointer',
};

const emptyStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1.5px dashed var(--border)',
  borderRadius: 12,
  padding: 32,
  textAlign: 'center',
  color: 'var(--text-muted)',
};
