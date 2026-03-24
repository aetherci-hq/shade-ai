import { StrictMode, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getToken, setToken } from './auth';
import './index.css';

function LoginScreen({ onLogin }: { onLogin: (token: string) => void }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!input.trim()) return;
    setError(false);
    try {
      const res = await fetch('/api/auth/check', {
        headers: { Authorization: `Bearer ${input.trim()}` },
      });
      const data = await res.json();
      if (data.valid) {
        onLogin(input.trim());
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    }
  }, [input, onLogin]);

  return (
    <div className="h-screen w-screen bg-c-bg flex items-center justify-center grain">
      <div className="w-80">
        <div className="text-center mb-8">
          <div className="text-[24px] font-medium text-c-text tracking-[0.2em] glow-text-strong">SHADE</div>
          <div className="text-[10px] text-c-muted tracking-[0.3em] uppercase mt-1">Remote Access</div>
        </div>
        <div className="space-y-3">
          <input
            type="password"
            value={input}
            onChange={e => { setInput(e.target.value); setError(false); }}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="Auth token"
            className="w-full bg-c-surface border border-c-border px-4 py-2.5 text-[13px] text-c-text font-mono outline-none focus:border-c-accent/40 placeholder:text-c-muted"
            style={{ caretColor: 'var(--color-c-accent)' }}
            autoFocus
          />
          {error && (
            <div className="text-[11px] text-c-red">Invalid token. Check your shade.config.yaml server.authToken.</div>
          )}
          <button
            onClick={handleSubmit}
            className="w-full py-2 text-[12px] font-medium uppercase tracking-[0.15em] border border-c-accent text-c-accent hover:bg-c-accent/10 transition-colors"
          >
            Connect
          </button>
        </div>
        <div className="text-[10px] text-c-muted text-center mt-6 leading-relaxed">
          Find your token in <code className="text-c-cyan bg-c-surface px-1">shade.config.yaml</code> under <code className="text-c-cyan bg-c-surface px-1">server.authToken</code>
          <br />or check the Config panel on your desktop dashboard.
        </div>
      </div>
    </div>
  );
}

function Root() {
  const [authed, setAuthed] = useState<boolean | null>(null); // null = checking

  useEffect(() => {
    const token = getToken();
    fetch('/api/auth/check', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then(data => {
        if (!data.required) {
          setAuthed(true); // No auth needed
        } else if (data.valid) {
          setAuthed(true); // Token is valid
        } else {
          setAuthed(false); // Need to login
        }
      })
      .catch(() => setAuthed(true)); // Can't reach server, try anyway
  }, []);

  const handleLogin = useCallback((token: string) => {
    setToken(token);
    window.location.reload(); // Reload to reinitialize socket with token
  }, []);

  if (authed === null) {
    return (
      <div className="h-screen w-screen bg-c-bg flex items-center justify-center">
        <div className="text-c-muted text-[11px] uppercase tracking-wider">Connecting...</div>
      </div>
    );
  }

  if (!authed) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
