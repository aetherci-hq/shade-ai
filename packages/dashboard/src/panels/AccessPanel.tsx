import { useState, useEffect, useRef, useCallback } from 'react';
import { Shield, ShieldOff, Lock, Unlock, X, RefreshCw, Zap } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────

export interface AccessStatus {
  armed: boolean;
  host: string;
  port: number;
  authToken: boolean;
  clients: { id: string; ip: string; connectedAt: number; userAgent: string }[];
}

interface AccessPanelProps {
  accessStatus: AccessStatus | null;
  onArm: (token?: string) => void;
  onKill: () => void;
  onDisconnect: (id: string) => void;
  onTokenSet: (token: string) => void;
  onPortChange: (port: number) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function generateToken(): string {
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Slide To Arm ───────────────────────────────────────────────────

function SlideToArm({ disabled, onComplete }: { disabled: boolean; onComplete: () => void }) {
  const [position, setPosition] = useState(0); // 0-1
  const [phase, setPhase] = useState<'idle' | 'dragging' | 'completing' | 'snapping'>('idle');
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startX = useRef(0);
  const trackWidth = useRef(0);

  const HANDLE_SIZE = 44;
  const THRESHOLD = 0.9;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = true;
    startX.current = e.clientX;
    const track = trackRef.current;
    if (track) {
      trackWidth.current = track.getBoundingClientRect().width - HANDLE_SIZE;
    }
    setPhase('dragging');
  }, [disabled]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = e.clientX - startX.current;
    const pct = Math.max(0, Math.min(1, delta / trackWidth.current));
    setPosition(pct);
  }, []);

  const handlePointerUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;

    if (position >= THRESHOLD) {
      setPhase('completing');
      setPosition(1);
      // Brief flash then fire
      setTimeout(() => {
        onComplete();
        // Reset after callback (parent will change armed state)
        setPosition(0);
        setPhase('idle');
      }, 400);
    } else {
      setPhase('snapping');
      setPosition(0);
      setTimeout(() => setPhase('idle'), 300);
    }
  }, [position, onComplete]);

  const translateX = position * (trackRef.current ? trackRef.current.getBoundingClientRect().width - HANDLE_SIZE : 276);

  const trackLabel = position < 0.6 ? 'SLIDE TO ARM' : 'ARMING...';
  const labelOpacity = phase === 'completing' ? 0 : position < 0.3 ? 1 : Math.max(0, 1 - (position - 0.3) / 0.3);
  const armingOpacity = position >= 0.6 ? Math.min(1, (position - 0.6) / 0.2) : 0;

  // Handle color interpolation: muted → amber
  const handleBg = position > 0.1
    ? `rgba(181, 152, 92, ${Math.min(1, position * 1.2)})`
    : 'var(--color-c-muted)';

  return (
    <div
      ref={trackRef}
      className={`access-slide-track relative h-[48px] w-[320px] select-none ${disabled ? 'opacity-30 pointer-events-none' : ''} ${phase === 'completing' ? 'access-flash-amber' : ''}`}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Amber fill behind handle */}
      <div
        className="absolute inset-y-0 left-0 transition-none"
        style={{
          width: `${(position * 100)}%`,
          background: `linear-gradient(90deg, rgba(181, 152, 92, 0.15), rgba(181, 152, 92, ${0.1 + position * 0.25}))`,
        }}
      />

      {/* Track text */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {position < 0.6 && (
          <span
            className="text-[10px] uppercase tracking-[0.2em] text-c-muted font-medium"
            style={{ opacity: labelOpacity }}
          >
            {trackLabel}
          </span>
        )}
        {position >= 0.6 && (
          <span
            className="text-[10px] uppercase tracking-[0.2em] text-c-amber font-medium"
            style={{ opacity: armingOpacity }}
          >
            ARMING...
          </span>
        )}
      </div>

      {/* Handle */}
      <div
        className={`absolute top-[2px] left-[2px] w-[44px] h-[44px] flex items-center justify-center cursor-grab active:cursor-grabbing ${phase === 'snapping' ? 'access-snap-back' : ''}`}
        style={{
          transform: `translateX(${translateX}px)`,
          transition: phase === 'dragging' ? 'none' : phase === 'snapping' ? 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)' : phase === 'completing' ? 'transform 0.15s ease-out' : 'none',
          background: handleBg,
          border: '1px solid rgba(255,255,255,0.06)',
        }}
        onPointerDown={handlePointerDown}
      >
        <Lock size={16} className={position > 0.5 ? 'text-c-bg' : 'text-c-dim'} />
      </div>
    </div>
  );
}

// ─── Access Configuration ───────────────────────────────────────────

function AccessConfig({ status, onTokenSet, onPortChange }: {
  status: AccessStatus;
  onTokenSet: (token: string) => void;
  onPortChange: (port: number) => void;
}) {
  const [tokenInput, setTokenInput] = useState('');
  const [portInput, setPortInput] = useState(String(status.port));
  const [showToken, setShowToken] = useState(false);

  const portChanged = parseInt(portInput) !== status.port && parseInt(portInput) > 0;

  return (
    <div className="space-y-4">
      {/* Port */}
      <div>
        <div className="text-[9px] uppercase tracking-[0.15em] text-c-muted mb-1.5">Port</div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={portInput}
            onChange={e => setPortInput(e.target.value)}
            className="cfg-input w-20"
          />
          {portChanged && (
            <button
              onClick={() => {
                const p = parseInt(portInput);
                if (p > 0) onPortChange(p);
              }}
              className="text-[9px] uppercase tracking-wider px-2 py-0.5 border border-c-amber/40 text-c-amber hover:bg-c-amber/10 transition-colors"
            >
              Save
            </button>
          )}
          {portChanged && (
            <span className="text-[9px] text-c-muted">Restart needed</span>
          )}
        </div>
      </div>

      {/* Auth Token */}
      <div>
        <div className="text-[9px] uppercase tracking-[0.15em] text-c-muted mb-1.5">
          Auth Token {!status.authToken && <span className="text-c-red/60 ml-1">Required</span>}
        </div>
        {status.authToken ? (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-c-dim font-medium tracking-wider">
              {showToken ? '••••••••••••••••••••••••' : '••••••••'}
            </span>
            <button
              onClick={() => setShowToken(s => !s)}
              className="text-[9px] uppercase tracking-wider text-c-muted hover:text-c-accent border border-c-border px-1.5 py-0.5 transition-colors"
            >
              {showToken ? 'Hide' : 'Show'}
            </button>
            <button
              onClick={() => {
                const t = generateToken();
                setTokenInput(t);
              }}
              className="text-[9px] uppercase tracking-wider text-c-muted hover:text-c-accent border border-c-border px-1.5 py-0.5 transition-colors"
            >
              New
            </button>
          </div>
        ) : null}
        {(!status.authToken || tokenInput) && (
          <div className={`flex items-center gap-2 ${status.authToken ? 'mt-2' : ''}`}>
            <input
              type="text"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              placeholder={status.authToken ? 'Enter new token' : 'Set a token to enable arming'}
              className="cfg-input flex-1"
            />
            <button
              onClick={() => {
                const t = generateToken();
                setTokenInput(t);
              }}
              className="text-c-muted hover:text-c-accent border border-c-border p-0.5 transition-colors"
              title="Generate random token"
            >
              <RefreshCw size={10} />
            </button>
            <button
              onClick={() => { if (tokenInput.trim()) { onTokenSet(tokenInput.trim()); setTokenInput(''); } }}
              disabled={!tokenInput.trim()}
              className={`text-[9px] uppercase tracking-wider px-3 py-0.5 border transition-colors ${
                tokenInput.trim()
                  ? 'text-c-amber border-c-amber/40 hover:bg-c-amber/10'
                  : 'text-c-muted/30 border-c-border pointer-events-none'
              }`}
            >
              Set
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Client Row ─────────────────────────────────────────────────────

function ClientRow({ client, now, onDisconnect }: {
  client: { id: string; ip: string; connectedAt: number; userAgent: string };
  now: number;
  onDisconnect: () => void;
}) {
  const duration = formatDuration(now - client.connectedAt);
  // Extract simplified UA
  const ua = client.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop';

  return (
    <div className="flex items-center gap-3 py-2 px-3 bg-c-bg/50 border border-c-border/50 animate-fade-in">
      <div className="w-2 h-2 bg-c-red shrink-0 access-breathe-dot" />
      <span className="text-[12px] text-c-text font-medium tracking-wide flex-1 min-w-0">
        {client.ip}
      </span>
      <span className="text-[10px] text-c-muted shrink-0">{ua}</span>
      <span className="text-[10px] text-c-dim tabular-nums shrink-0 w-16 text-right">
        {duration}
      </span>
      <button
        onClick={onDisconnect}
        className="text-c-muted hover:text-c-red transition-colors shrink-0 p-0.5"
        title={`Disconnect ${client.ip}`}
      >
        <X size={12} />
      </button>
    </div>
  );
}

// ─── Kill Switch ────────────────────────────────────────────────────

function KillSwitch({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="access-kill-switch w-full py-3 border border-c-red text-c-red text-[12px] font-medium uppercase tracking-[0.2em] transition-all duration-150 hover:bg-c-red hover:text-c-bg active:scale-[0.98]"
    >
      <span className="flex items-center justify-center gap-2">
        <Zap size={14} />
        KILL SWITCH
      </span>
    </button>
  );
}

// ─── Connection Monitor ─────────────────────────────────────────────

function ConnectionMonitor({ status, onDisconnect, onKill }: {
  status: AccessStatus;
  onDisconnect: (id: string) => void;
  onKill: () => void;
}) {
  const [now, setNow] = useState(Date.now());

  // Tick every second for duration display
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hasClients = status.clients.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Status Header */}
      <div>
        <div className="flex items-center gap-2.5 mb-1">
          <div className={`w-2 h-2 ${hasClients ? 'bg-c-red' : 'bg-c-amber'} access-breathe-dot`} />
          <span className={`text-[12px] font-medium uppercase tracking-[0.1em] ${hasClients ? 'text-c-red' : 'text-c-amber'}`}>
            LISTENING ON {status.host}:{status.port}
          </span>
        </div>
        <div className="flex items-center gap-2 ml-[18px]">
          <span className="text-[9px] uppercase tracking-wider text-c-muted border border-c-border px-1.5 py-px">
            WS
          </span>
          <span className="text-[9px] text-c-muted">
            {hasClients ? `${status.clients.length} remote connection${status.clients.length !== 1 ? 's' : ''}` : 'Awaiting connections'}
          </span>
        </div>
      </div>

      {/* Client List */}
      <div>
        <div className="text-[9px] uppercase tracking-[0.15em] text-c-muted mb-2">
          Remote Clients
        </div>
        {hasClients ? (
          <div className="space-y-1">
            {status.clients.map(client => (
              <ClientRow
                key={client.id}
                client={client}
                now={now}
                onDisconnect={() => onDisconnect(client.id)}
              />
            ))}
          </div>
        ) : (
          <div className="py-6 text-center border border-c-border/30 bg-c-bg/30">
            <ShieldOff size={16} className="mx-auto text-c-muted/50 mb-2" />
            <div className="text-[11px] text-c-muted">No remote connections</div>
          </div>
        )}
      </div>

      {/* Kill Switch */}
      <KillSwitch onClick={onKill} />
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export function AccessPanel({ accessStatus, onArm, onKill, onDisconnect, onTokenSet, onPortChange }: AccessPanelProps) {
  if (!accessStatus) {
    return (
      <div className="h-full flex items-center justify-center bg-c-bg">
        <div className="text-c-muted text-[11px] uppercase tracking-wider">Loading...</div>
      </div>
    );
  }

  const { armed, clients } = accessStatus;
  const hasClients = clients.length > 0;

  // Visual state
  const state: 'locked' | 'armed' | 'connected' = !armed ? 'locked' : hasClients ? 'connected' : 'armed';

  // Border color by state
  const borderColor = state === 'connected'
    ? 'border-c-red'
    : state === 'armed'
      ? 'border-c-amber'
      : 'border-c-border';

  // Glow class by state
  const glowClass = state === 'connected'
    ? 'access-glow-red'
    : state === 'armed'
      ? 'access-glow-amber'
      : '';

  return (
    <div className="h-full flex flex-col bg-c-bg overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-8 py-12">

          {/* Vault Module */}
          <div className={`border ${borderColor} ${glowClass} transition-all duration-500 relative`}>

            {/* Ambient gradient for armed states */}
            {state !== 'locked' && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: state === 'connected'
                    ? 'radial-gradient(ellipse at center, rgba(166, 94, 94, 0.04) 0%, transparent 70%)'
                    : 'radial-gradient(ellipse at center, rgba(181, 152, 92, 0.04) 0%, transparent 70%)',
                }}
              />
            )}

            {/* Header */}
            <div className="relative px-6 pt-6 pb-4 border-b border-c-border/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {state === 'locked' ? (
                    <Shield size={18} className="text-c-muted" />
                  ) : (
                    <Shield size={18} className={hasClients ? 'text-c-red' : 'text-c-amber'} />
                  )}
                  <div>
                    <div className={`text-[14px] font-medium uppercase tracking-[0.15em] ${
                      state === 'locked' ? 'text-c-muted' : hasClients ? 'text-c-red' : 'text-c-amber'
                    }`}>
                      Remote Access
                    </div>
                    <div className={`text-[9px] uppercase tracking-[0.2em] mt-0.5 ${
                      state === 'locked' ? 'text-c-muted/50' : hasClients ? 'text-c-red/60' : 'text-c-amber/60'
                    }`}>
                      {state === 'locked' ? 'Locked' : state === 'connected' ? 'Active \u2014 Connections Present' : 'Armed \u2014 Listening'}
                    </div>
                  </div>
                </div>

                {/* State indicator */}
                {state !== 'locked' && (
                  <div className={`w-2.5 h-2.5 ${hasClients ? 'bg-c-red' : 'bg-c-amber'} access-breathe-dot`} />
                )}
              </div>
            </div>

            {/* Body */}
            <div className="relative px-6 py-8">
              {state === 'locked' ? (
                <div className="flex flex-col items-center">
                  {/* Lock Icon */}
                  <div className="mb-8">
                    <div className="w-16 h-16 flex items-center justify-center border border-c-border/50 bg-c-bg/50">
                      <Lock size={24} className="text-c-muted/60" />
                    </div>
                  </div>

                  {/* Slide to Arm */}
                  <SlideToArm
                    disabled={!accessStatus.authToken}
                    onComplete={() => onArm()}
                  />

                  {/* Hint */}
                  <div className="mt-4 text-[9px] text-c-muted/50 uppercase tracking-wider">
                    {accessStatus.authToken
                      ? 'Slide to expose server on all network interfaces'
                      : 'Token required before arming'}
                  </div>

                  {/* Configuration */}
                  <div className="w-full mt-10 pt-6 border-t border-c-border/30">
                    <AccessConfig
                      status={accessStatus}
                      onTokenSet={onTokenSet}
                      onPortChange={onPortChange}
                    />
                  </div>
                </div>
              ) : (
                <ConnectionMonitor
                  status={accessStatus}
                  onDisconnect={onDisconnect}
                  onKill={onKill}
                />
              )}
            </div>
          </div>

          {/* Security note */}
          <div className="mt-4 text-center">
            <div className="text-[9px] text-c-muted/40 uppercase tracking-wider">
              {state === 'locked'
                ? 'All traffic restricted to localhost'
                : 'Auth token required for all remote connections'}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
