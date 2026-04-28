import { useEffect, useRef, useState } from 'react';
import { api, type Item, type KindDef, type KindFieldDef } from '../api.js';
import { inputStyle, labelStyle } from './shared.js';

let kindsCache: KindDef[] | null = null;

/**
 * Per-kind structured-attribute form. Renders a section of fields
 * defined by the server's `/api/trips/item-kinds` registry, so adding
 * a new field is a one-file backend change with no client-side
 * deploy. Saves to `items.attributes_json` on every change (debounced
 * 300ms) so the timeline card updates live as you type.
 */
export function KindAttributes({
  item,
  updateItem,
}: {
  item: Item;
  updateItem: (id: number, patch: Partial<Item> & { attributes?: Record<string, unknown> }) => Promise<unknown>;
}): JSX.Element | null {
  const [kinds, setKinds] = useState<KindDef[] | null>(kindsCache);
  const [attrs, setAttrs] = useState<Record<string, unknown>>(() => parseAttrs(item.attributes_json));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setAttrs(parseAttrs(item.attributes_json)); }, [item.id, item.attributes_json]);
  useEffect(() => {
    if (kindsCache) return;
    void api.listItemKinds().then((r) => { kindsCache = r.kinds; setKinds(r.kinds); });
  }, []);

  const def = kinds?.find((k) => k.kind === item.kind);
  if (!def || def.fields.length === 0) return null;

  const commitNow = (newAttrs: Record<string, unknown>): void => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void updateItem(item.id, { attributes: newAttrs });
  };

  const setField = (name: string, raw: unknown, immediate = false): void => {
    setAttrs((prev) => {
      const next = { ...prev, [name]: raw };
      if (immediate) {
        commitNow(next);
      } else {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => commitNow(next), 300);
      }
      return next;
    });
  };

  const flush = (currentAttrs: Record<string, unknown>): void => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    commitNow(currentAttrs);
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
            onFlush={() => flush(attrs)}
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

function parseAttrs(json: string): Record<string, unknown> {
  try { return JSON.parse(json) as Record<string, unknown>; }
  catch { return {}; }
}

const subLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--text-muted)', marginBottom: 2, display: 'block',
};
const gridSpan2: React.CSSProperties = { gridColumn: 'span 2' };
