import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Activity, MessageSquare, Brain, Wrench, Settings, Zap, ChevronRight, ChevronLeft, HeartPulse, Fingerprint, Volume2, VolumeX, Mic, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { AgentState } from '../hooks/useAgent';
import { authFetch } from '../auth';

export type View = 'activity' | 'chat' | 'heartbeat' | 'persona' | 'memory' | 'tools' | 'config';

interface ShellProps {
  children: ReactNode;
  view: View;
  onViewChange: (v: View) => void;
  connected: boolean;
  agent: AgentState;
  onHeartbeatTrigger: () => void;
  onHeartbeatToggle: (enabled: boolean) => void;
  startTime: number;
  agentName: string;
  modelName: string;
  focusMode: boolean;
  onFocusModeToggle: (v: boolean) => void;
  focusChatPanel: ReactNode;
  voice: { muted: boolean; speaking: boolean; toggleMute: () => void };
  onVoiceMode?: () => void;
}

const NAV_ITEMS: { id: View; label: string; icon: typeof Activity }[] = [
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'heartbeat', label: 'Heartbeat', icon: HeartPulse },
  { id: 'persona', label: 'Persona', icon: Fingerprint },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'config', label: 'Config', icon: Settings },
];

function formatCountdown(nextWake: number): string {
  const diff = Math.max(0, nextWake - Date.now());
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function Shell({ children, view, onViewChange, connected, agent, onHeartbeatTrigger, onHeartbeatToggle, startTime, agentName, modelName, focusMode, onFocusModeToggle, focusChatPanel, voice, onVoiceMode }: ShellProps) {
  const [clock, setClock] = useState(new Date());
  const [sessionCost, setSessionCost] = useState(0);
  const costFetchRef = useRef(0);
  // Auto-collapse sidebar on small screens
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 768);

  const toggleSidebar = useCallback(() => setCollapsed(c => !c), []);

  // Listen for resize — auto-collapse on mobile
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) setCollapsed(true);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch actual cost from persistent tracker periodically
  useEffect(() => {
    const load = () => {
      authFetch('/api/usage')
        .then(r => r.json())
        .then(data => { if (data?.session) setSessionCost(data.session.costUsd); })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, []);

  // Escape key exits focus mode
  useEffect(() => {
    if (!focusMode) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFocusModeToggle(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [focusMode, onFocusModeToggle]);

  const uptime = Date.now() - startTime;

  return (
    <div className="flex flex-col h-screen w-screen grain">
      {/* Accent line — signature top border */}
      <div className="h-px w-full bg-c-accent opacity-30 shrink-0" />

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className={`shrink-0 bg-c-panel border-r border-c-border flex flex-col transition-all duration-200 ${collapsed ? 'w-12' : 'w-52'}`}>
          {/* Identity */}
          <div className={`border-b border-c-border relative ${collapsed ? 'px-2 py-3' : 'px-4 pt-5 pb-4'}`}>
            {/* Accent edge — warm copper top border on header only */}
            {!collapsed && <div className="absolute top-0 left-3 right-3 h-px bg-gradient-to-r from-transparent via-c-accent/40 to-transparent" />}

            {collapsed ? (
              /* Collapsed: icon + status dot */
              <div className="flex flex-col items-center gap-2">
                <button onClick={toggleSidebar} className="text-c-accent hover:text-c-accent/80 transition-colors" title="Expand sidebar">
                  <PanelLeftOpen size={15} />
                </button>
                <div className={`w-2 h-2 ${connected ? (agent.isRunning ? 'bg-c-amber animate-pulse-live' : 'bg-c-green animate-pulse-live') : 'bg-c-red'}`} />
              </div>
            ) : (
              /* Expanded: prominent name + status */
              <>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-[18px] font-medium text-c-text tracking-[0.18em] leading-none glow-text-strong">
                      {agentName.toUpperCase()}
                    </div>
                    <div className="text-[9px] text-c-muted tracking-[0.3em] uppercase mt-1">Autonomous Agent</div>
                  </div>
                  <button onClick={toggleSidebar} className="text-c-muted hover:text-c-accent transition-colors mt-0.5" title="Collapse sidebar">
                    <PanelLeftClose size={13} />
                  </button>
                </div>

                {/* Status line with accent dash */}
                <div className="flex items-center gap-2">
                  <div className={`w-5 h-px ${connected ? (agent.isRunning ? 'bg-c-amber' : 'bg-c-green') : 'bg-c-red'}`} />
                  <div className={`w-1.5 h-1.5 ${connected ? (agent.isRunning ? 'bg-c-amber animate-pulse-live' : 'bg-c-green animate-pulse-live') : 'bg-c-red'}`} />
                  <span className={`text-[10px] font-medium uppercase tracking-[0.12em] ${connected ? (agent.isRunning ? 'text-c-amber' : 'text-c-green') : 'text-c-red'}`}>
                    {connected ? (agent.isRunning ? 'Working' : 'Online') : 'Offline'}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Nav */}
          <nav className={`flex-1 py-3 ${collapsed ? 'px-1' : 'px-2'}`}>
            {!collapsed && <div className="text-[9px] font-medium uppercase tracking-[0.15em] text-c-muted px-2 mb-2">Navigation</div>}
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => onViewChange(id)}
                title={collapsed ? label : undefined}
                className={`w-full flex items-center ${collapsed ? 'justify-center px-1 py-2' : 'gap-2.5 px-2.5 py-1.5'} text-[11px] transition-colors mb-px ${collapsed ? '' : 'border-l'} ${
                  view === id
                    ? `bg-c-surface text-c-text ${collapsed ? '' : 'border-c-accent'}`
                    : `text-c-dim hover:bg-c-surface/50 hover:text-c-text ${collapsed ? '' : 'border-transparent'}`
                }`}
              >
                <Icon size={collapsed ? 16 : 13} className={view === id ? 'text-c-accent' : 'text-c-muted'} />
                {!collapsed && label}
                {!collapsed && view === id && <ChevronRight size={10} className="ml-auto text-c-accent" />}
              </button>
            ))}
          </nav>

          {/* Heartbeat Widget */}
          <div className={`border-t border-c-border ${collapsed ? 'px-1 py-2' : 'px-3 py-3'}`}>
            {collapsed ? (
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={onHeartbeatTrigger}
                  title={`Heartbeat: ${agent.heartbeat.enabled ? formatCountdown(agent.heartbeat.nextWake) : 'Disabled'}`}
                  className="text-c-muted hover:text-c-accent transition-colors p-1"
                >
                  <HeartPulse size={14} className={agent.heartbeat.enabled ? 'text-c-green' : 'text-c-muted'} />
                </button>
                <button
                  onClick={toggleSidebar}
                  className="text-c-muted hover:text-c-accent transition-colors p-1"
                  title="Expand sidebar"
                >
                  <PanelLeftOpen size={13} />
                </button>
              </div>
            ) : (
              <>
                <div className="text-[9px] font-medium uppercase tracking-[0.15em] text-c-muted mb-2">Heartbeat</div>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className={`w-1.5 h-1.5 ${agent.heartbeat.enabled ? 'bg-c-green' : 'bg-c-muted'}`} />
                  <span className="text-[10px] text-c-dim">
                    {agent.heartbeat.enabled ? formatCountdown(agent.heartbeat.nextWake) : 'Disabled'}
                  </span>
                  <button
                    onClick={() => onHeartbeatToggle(!agent.heartbeat.enabled)}
                    className="ml-auto text-[9px] text-c-muted hover:text-c-accent transition-colors uppercase tracking-wider border border-c-border px-1.5 py-0.5"
                  >
                    {agent.heartbeat.enabled ? 'off' : 'on'}
                  </button>
                </div>
                <button
                  onClick={onHeartbeatTrigger}
                  className="w-full text-[9px] py-1 border border-c-border text-c-muted hover:text-c-accent hover:border-c-accent/40 transition-colors uppercase tracking-wider"
                >
                  Trigger Now
                </button>
              </>
            )}
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 flex flex-col min-w-0">
          {children}
        </main>
      </div>

      {/* Bottom Status Bar */}
      <footer className="h-6 shrink-0 bg-c-bg border-t border-c-border flex items-center px-3 gap-4 text-[10px]">
        <div className="flex items-center gap-1.5">
          <div className={`w-1 h-1 ${connected ? 'bg-c-green' : 'bg-c-red'}`} />
          <span className={connected ? 'text-c-dim' : 'text-c-red'}>
            {connected ? 'connected' : 'disconnected'}
          </span>
        </div>
        <span className="text-c-border">|</span>
        <span className="text-c-muted">{modelName.replace(/^claude-|-\d+$/g, '')}</span>
        <span className="text-c-border">|</span>
        <span className="text-c-muted">up {formatUptime(uptime)}</span>
        <span className="text-c-border">|</span>
        <span className="text-c-dim">
          <span className="text-c-muted">in </span>{formatTokens(agent.totalTokens.input)}
          <span className="text-c-muted ml-2">out </span>{formatTokens(agent.totalTokens.output)}
        </span>
        <span className="text-c-border">|</span>
        <span className="text-c-muted">{agent.toolCalls} calls</span>
        <span className="text-c-border">|</span>
        <span className="text-c-amber">{sessionCost < 0.01 && sessionCost > 0 ? '<$0.01' : `$${sessionCost.toFixed(2)}`}</span>
        <span className="text-c-border">|</span>
        {onVoiceMode && (
          <button
            onClick={onVoiceMode}
            className="text-c-muted hover:text-c-accent transition-colors"
            title="Voice mode"
          >
            <Mic size={11} />
          </button>
        )}
        <button
          onClick={voice.toggleMute}
          className={`flex items-center gap-1 transition-colors ${voice.speaking ? 'text-c-accent' : voice.muted ? 'text-c-muted/50' : 'text-c-muted'}`}
          title={voice.muted ? 'Unmute voice' : 'Mute voice'}
        >
          {voice.muted ? <VolumeX size={11} /> : <Volume2 size={11} className={voice.speaking ? 'animate-pulse-live' : ''} />}
        </button>
        <div className="ml-auto text-c-muted">
          {clock.toLocaleTimeString('en-US', { hour12: false })}
        </div>
      </footer>

      {/* Focus Mode Overlay */}
      {focusMode && (
        <div className="fixed inset-0 z-50 flex flex-col bg-c-bg">
          <div className="h-px w-full bg-c-accent opacity-30 shrink-0" />
          <div className="flex-1 min-h-0 max-w-4xl w-full mx-auto flex flex-col">
            {focusChatPanel}
          </div>
          <div className="h-6 shrink-0 bg-c-bg border-t border-c-border flex items-center justify-center px-3 text-[10px] text-c-muted">
            <span className="opacity-50">Press <span className="text-c-accent">Esc</span> to exit focus mode</span>
          </div>
        </div>
      )}
    </div>
  );
}
