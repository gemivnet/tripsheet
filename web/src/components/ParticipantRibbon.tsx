import { useState } from 'react';
import { api, type Participant } from '../api.js';

/**
 * Trip-level participant manager — a row of colored chips with a "+"
 * to add and a small popover to rename / recolor / delete an existing
 * one. The actual per-item attendance is set in the item editor; this
 * just owns the master list.
 */
export function ParticipantRibbon({
  tripId,
  participants,
  onChanged,
}: {
  tripId: number;
  participants: Participant[];
  onChanged: () => void;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Participant | null>(null);

  const addOne = async (): Promise<void> => {
    if (!name.trim()) {
      setAdding(false);
      return;
    }
    const hue = Math.floor(Math.random() * 360);
    await api.addParticipant(tripId, { display_name: name.trim(), color_hue: hue });
    setName('');
    setAdding(false);
    onChanged();
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, position: 'relative' }}>
      {participants.map((p) => (
        <button
          key={p.id}
          onClick={() => setEditing(p)}
          title={p.display_name}
          style={chipStyle(p.color_hue)}
        >
          {initials(p.display_name)}
        </button>
      ))}
      {adding ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={addOne}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addOne();
            if (e.key === 'Escape') {
              setName('');
              setAdding(false);
            }
          }}
          placeholder="Name"
          style={{
            padding: '5px 10px',
            borderRadius: 14,
            border: '1.5px dashed var(--border)',
            background: 'transparent',
            fontSize: 12,
            width: 90,
          }}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          title="Add a participant"
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            border: '1.5px dashed var(--border)',
            background: 'transparent',
            color: 'var(--text-muted)',
            fontSize: 14,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          +
        </button>
      )}
      {editing && (
        <ParticipantEditPopover
          participant={editing}
          onClose={() => setEditing(null)}
          onChanged={() => {
            onChanged();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ParticipantEditPopover({
  participant,
  onClose,
  onChanged,
}: {
  participant: Participant;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const [name, setName] = useState(participant.display_name);
  const [hue, setHue] = useState(participant.color_hue ?? 200);
  const [confirmDel, setConfirmDel] = useState(false);

  const save = async (): Promise<void> => {
    await api.updateParticipant(participant.id, { display_name: name, color_hue: hue });
    onChanged();
  };
  const remove = async (): Promise<void> => {
    if (!confirmDel) {
      setConfirmDel(true);
      setTimeout(() => setConfirmDel(false), 3000);
      return;
    }
    await api.deleteParticipant(participant.id);
    onChanged();
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 60,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 14,
          width: 260,
          boxShadow: '0 8px 24px oklch(20% 0.04 65 / 0.18)',
          display: 'grid',
          gap: 10,
          fontSize: 12,
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: 13,
            border: '1.5px solid var(--border)',
            background: 'var(--bg)',
          }}
        />
        <input
          type="range"
          min={0}
          max={360}
          step={5}
          value={hue}
          onChange={(e) => setHue(Number(e.target.value))}
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={chipStyle(hue)}>{initials(name)}</div>
          <span style={{ color: 'var(--text-muted)' }}>preview</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => void save()} style={primaryBtn}>
            Save
          </button>
          <button
            onClick={() => void remove()}
            style={{
              ...secondaryBtn,
              color: confirmDel ? 'oklch(52% 0.18 25)' : 'var(--text-muted)',
              borderColor: confirmDel ? 'oklch(52% 0.18 25)' : 'var(--border)',
            }}
          >
            {confirmDel ? 'Click again' : 'Remove'}
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={secondaryBtn}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function chipStyle(hue: number | null): React.CSSProperties {
  const h = hue ?? 200;
  return {
    width: 28,
    height: 28,
    borderRadius: 14,
    border: 'none',
    background: `oklch(72% 0.13 ${h})`,
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    letterSpacing: '0.02em',
  };
}

const primaryBtn: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 12,
};
const secondaryBtn: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: '1.5px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: 12,
};
