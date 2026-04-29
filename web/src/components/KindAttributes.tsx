import { useEffect, useRef, useState } from 'react';
import { api, type Item, type ItemKind, type KindDef, type KindFieldDef } from '../api.js';
import { inputStyle, labelStyle } from './shared.js';

let kindsCache: KindDef[] | null = null;

/**
 * Per-kind structured-attribute form. Renders fields defined by the
 * server's `/api/trips/item-kinds` registry.
 *
 * Two modes:
 *  - **Edit mode** (`mode='edit'`): commits each change to the API
 *    (debounced 300ms) so the timeline updates live as you type.
 *  - **Add mode** (`mode='add'`): just calls `onChange(attrs)` so the
 *    parent's form-state holds the values until the user clicks "Add."
 */
export type KindAttrsMode =
  | { mode: 'edit'; itemId: number; updateItem: (id: number, patch: { attributes?: Record<string, unknown> }) => Promise<unknown> }
  | { mode: 'add'; onChange: (attrs: Record<string, unknown>) => void };

export function KindAttributes({
  kind,
  initialAttrs,
  control,
}: {
  kind: ItemKind;
  initialAttrs: Record<string, unknown>;
  control: KindAttrsMode;
}): JSX.Element | null {
  const [kinds, setKinds] = useState<KindDef[] | null>(kindsCache);
  const [attrs, setAttrs] = useState<Record<string, unknown>>(initialAttrs);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync local state when the parent swaps to a different item.
  useEffect(() => { setAttrs(initialAttrs); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [JSON.stringify(initialAttrs)]);
  useEffect(() => {
    if (kindsCache) return;
    void api.listItemKinds().then((r) => { kindsCache = r.kinds; setKinds(r.kinds); });
  }, []);

  const def = kinds?.find((k) => k.kind === kind);
  if (!def || def.fields.length === 0) return null;

  const commit = (newAttrs: Record<string, unknown>): void => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    if (control.mode === 'edit') {
      void control.updateItem(control.itemId, { attributes: newAttrs });
    } else {
      control.onChange(newAttrs);
    }
  };

  const setField = (name: string, raw: unknown, immediate: boolean): void => {
    setAttrs((prev) => {
      const next = { ...prev, [name]: raw };
      if (immediate || control.mode === 'add') {
        commit(next);
      } else {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => commit(next), 300);
      }
      return next;
    });
  };

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ ...labelStyle, marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
        <span>{def.label} details</span>
        {def.hint && (
          <span style={{ fontWeight: 400, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>
            {def.hint}
          </span>
        )}
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
        padding: 10, border: '1.5px solid var(--border)', borderRadius: 8,
        background: 'oklch(98% 0.01 75)',
      }}>
        {def.fields.map((field) => (
          <FieldInput
            key={field.name}
            field={field}
            value={attrs[field.name]}
            onChange={(v) => setField(field.name, v, field.type === 'select')}
            onFlush={() => commit(attrs)}
          />
        ))}
      </div>
    </div>
  );
}

function FieldInput({
  field, value, onChange, onFlush,
}: {
  field: KindFieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  onFlush: () => void;
}): JSX.Element {
  const v = value == null ? '' : String(value);

  if (field.type === 'select' && field.options) {
    return (
      <div style={field.name === 'address' ? gridSpan2 : undefined}>
        <label style={subLabel}>{field.label}</label>
        <select
          value={v}
          onChange={(e) => { onChange(e.target.value || undefined); }}
          style={inputStyle}
        >
          <option value="">—</option>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }

  const inputType =
    field.type === 'time' ? 'time'
    : field.type === 'date' ? 'date'
    : field.type === 'number' ? 'number'
    : 'text';

  const transform = (raw: string): unknown => {
    if (raw === '') return undefined;
    if (field.type === 'number') {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    if (field.type === 'iata') return raw.toUpperCase();
    return raw;
  };

  return (
    <div style={field.name === 'address' || field.name === 'venue_name' || field.name === 'property_name' ? gridSpan2 : undefined}>
      <label style={subLabel}>{field.label}</label>
      <input
        type={inputType}
        value={v}
        placeholder={field.placeholder}
        onChange={(e) => onChange(transform(e.target.value))}
        onBlur={onFlush}
        style={{ ...inputStyle, textTransform: field.type === 'iata' ? 'uppercase' : undefined }}
        maxLength={field.type === 'iata' ? 4 : undefined}
      />
    </div>
  );
}

const subLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--text-muted)', marginBottom: 2, display: 'block',
};
const gridSpan2: React.CSSProperties = { gridColumn: 'span 2' };

export function parseAttrs(json: string): Record<string, unknown> {
  try { return JSON.parse(json) as Record<string, unknown>; }
  catch { return {}; }
}
