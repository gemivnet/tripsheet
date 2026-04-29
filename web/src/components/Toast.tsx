import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export type ToastKind = 'info' | 'success' | 'error' | 'warning';
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Auto-dismiss after this many ms. 0 = sticky. */
  ttl: number;
}

interface ToastApi {
  show: (message: string, kind?: ToastKind, ttl?: number) => void;
  info: (message: string, ttl?: number) => void;
  success: (message: string, ttl?: number) => void;
  error: (message: string, ttl?: number) => void;
  warning: (message: string, ttl?: number) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

/**
 * Global toast provider. Mounts once at the root; any component can
 * call `useToast()` to surface a transient message.
 *
 * Defaults:
 *  - info / success: 3s
 *  - warning:        4s
 *  - error:          5s (pass ttl=0 for sticky errors)
 */
export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seqRef = useRef(0);

  const dismiss = useCallback((id: number): void => {
    setToasts((p) => p.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, kind: ToastKind = 'info', ttl?: number): void => {
      const id = ++seqRef.current;
      const finalTtl = ttl ?? (kind === 'error' ? 5000 : kind === 'warning' ? 4000 : 3000);
      setToasts((p) => [...p, { id, kind, message, ttl: finalTtl }]);
      if (finalTtl > 0) setTimeout(() => dismiss(id), finalTtl);
    },
    [dismiss],
  );

  const api: ToastApi = {
    show,
    info: (m, ttl) => show(m, 'info', ttl),
    success: (m, ttl) => show(m, 'success', ttl),
    error: (m, ttl) => show(m, 'error', ttl),
    warning: (m, ttl) => show(m, 'warning', ttl),
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        style={{
          position: 'fixed',
          bottom: 60,
          right: 20,
          zIndex: 9000,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            style={{ ...toastStyle(t.kind), pointerEvents: 'auto', cursor: 'pointer' }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    // Fallback no-op so hook callers don't crash if mounted outside the
    // provider (e.g. tests). All methods are silent.
    return {
      show: () => undefined,
      info: () => undefined,
      success: () => undefined,
      error: () => undefined,
      warning: () => undefined,
    };
  }
  return ctx;
}

function toastStyle(kind: ToastKind): React.CSSProperties {
  const base: React.CSSProperties = {
    minWidth: 240,
    maxWidth: 380,
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 13,
    boxShadow: '0 8px 28px oklch(20% 0.04 65 / 0.18)',
    fontFamily: 'var(--font-body)',
    fontWeight: 500,
    lineHeight: 1.4,
  };
  if (kind === 'error')
    return {
      ...base,
      background: 'oklch(96% 0.04 25)',
      color: 'oklch(35% 0.16 25)',
      border: '1.5px solid oklch(60% 0.16 25)',
    };
  if (kind === 'success')
    return {
      ...base,
      background: 'oklch(96% 0.04 150)',
      color: 'oklch(32% 0.13 150)',
      border: '1.5px solid oklch(58% 0.14 150)',
    };
  if (kind === 'warning')
    return {
      ...base,
      background: 'oklch(97% 0.05 75)',
      color: 'oklch(40% 0.13 65)',
      border: '1.5px solid oklch(62% 0.14 65)',
    };
  return {
    ...base,
    background: 'oklch(98% 0.01 220)',
    color: 'oklch(30% 0.04 220)',
    border: '1.5px solid oklch(72% 0.06 220)',
  };
}
