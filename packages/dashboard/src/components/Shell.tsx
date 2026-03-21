import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Activity, MessageSquare, Brain, Wrench, Settings, Zap, ChevronRight, HeartPulse, Fingerprint } from 'lucide-react';
import type { AgentState } from '../hooks/useAgent';

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

export function Shell({ children, view, onViewChange, connected, agent, onHeartbeatTrigger, onHeartbeatToggle, startTime, agentName, modelName }: ShellProps) {
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const uptime = Date.now() - startTime;

  return (
    <div className="flex flex-col h-screen w-screen grain">
      {/* Accent line — signature top border */}
      <div className="h-px w-full bg-c-accent opacity-30 shrink-0" />

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-52 shrink-0 bg-c-panel border-r border-c-border flex flex-col">
          {/* Logo */}
          <div className="px-4 py-4 border-b border-c-border">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-c-accent" />
              <span className="text-[11px] font-medium text-c-text glow-text-strong tracking-[0.2em]">{agentName.toUpperCase()}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-2">
              <div className={`w-1.5 h-1.5 ${connected ? 'bg-c-green animate-pulse-live' : 'bg-c-red'}`} />
              <span className={`text-[10px] font-medium uppercase tracking-[0.1em] ${connected ? (agent.isRunning ? 'text-c-amber' : 'text-c-green') : 'text-c-red'}`}>
                {connected ? (agent.isRunning ? 'Working' : 'Alive') : 'Disconnected'}
              </span>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 px-2 py-3">
            <div className="text-[9px] font-medium uppercase tracking-[0.15em] text-c-muted px-2 mb-2">Navigation</div>
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => onViewChange(id)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[11px] transition-colors mb-px border-l ${
                  view === id
                    ? 'bg-c-surface text-c-text border-c-accent'
                    : 'text-c-dim hover:bg-c-surface/50 hover:text-c-text border-transparent'
                }`}
              >
                <Icon size={13} className={view === id ? 'text-c-accent' : 'text-c-muted'} />
                {label}
                {view === id && <ChevronRight size={10} className="ml-auto text-c-accent" />}
              </button>
            ))}
          </nav>

          {/* Heartbeat Widget */}
          <div className="px-3 py-3 border-t border-c-border">
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
        <div className="ml-auto text-c-muted">
          {clock.toLocaleTimeString('en-US', { hour12: false })}
        </div>
      </footer>
    </div>
  );
}
