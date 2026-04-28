import { useEffect, useState } from 'react';
import { api, type User } from './api.js';
import { LoginPage } from './pages/Login.js';
import { TripsPage } from './pages/Trips.js';
import { TripEditorPage } from './pages/TripEditor.js';
import { Avatar } from './components/shared.js';
import { DevToolbar } from './components/DevToolbar.js';
import { ToastProvider } from './components/Toast.js';

type View = { kind: 'trips' } | { kind: 'trip'; id: number };

export function App(): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>({ kind: 'trips' });

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div />;
  if (!user) return (
    <ToastProvider>
      <LoginPage onSignedIn={setUser} />
    </ToastProvider>
  );

  if (view.kind === 'trip') {
    return (
      <ToastProvider>
        <TripEditorPage
          tripId={view.id}
          user={user}
          onBack={() => setView({ kind: 'trips' })}
          onLogout={() =>
            void api.logout().then(() => {
              setUser(null);
              setView({ kind: 'trips' });
            })
          }
        />
        <DevToolbar />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '10px 22px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface)', flexShrink: 0,
      }}>
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

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar name={user.display_name} userId={user.id} size={30} />
          <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>
            {user.display_name}
          </span>
          <button
            onClick={() =>
              void api.logout().then(() => {
                setUser(null);
              })
            }
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

      <div style={{ flex: 1, overflow: 'auto' }}>
        <TripsPage onOpen={(id) => setView({ kind: 'trip', id })} />
      </div>
      <DevToolbar />
    </div>
    </ToastProvider>
  );
}
