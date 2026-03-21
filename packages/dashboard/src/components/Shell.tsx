import { useState, type ReactNode } from 'react';
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

export function Shell({ children, view, onViewChange, connected, agent, onHeartbeatTrigger, onHeartbeatToggle }: ShellProps) {
  const [clock, setClock] = useState(new Date());

  // Update clock every second
  useState(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  });

  return (
    <div className="flex h-screen w-screen scanlines">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 bg-black/40 backdrop-blur-xl border-r border-white/10 flex flex-col">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-c-green" />
            <span className="text-sm font-bold text-c-text glow-text-strong tracking-wider">SPECTER</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-c-green shadow-[0_0_6px_rgba(57,255,20,0.6)] animate-pulse-live' : 'bg-c-red shadow-[0_0_4px_rgba(248,81,73,0.5)]'}`} />
            <span className={`text-[10px] font-medium uppercase tracking-[0.1em] ${connected ? 'text-c-green' : 'text-c-red'}`}>
              {connected ? (agent.isRunning ? 'WORKING' : 'ALIVE') : 'DISCONNECTED'}
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-c-muted px-2 mb-2">Navigation</div>
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onViewChange(id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-colors mb-0.5 border-l-2 ${
                view === id
                  ? 'bg-white/10 text-white border-l-c-green'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white border-transparent'
              }`}
            >
              <Icon size={14} className={view === id ? 'text-c-green' : 'text-gray-500'} />
              {label}
              {view === id && <ChevronRight size={12} className="ml-auto text-c-green" />}
            </button>
          ))}
        </nav>

        {/* Heartbeat Widget */}
        <div className="px-3 py-3 border-t border-white/10">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-c-muted mb-2">Heartbeat</div>
          <div className="flex items-center gap-2 mb-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${agent.heartbeat.enabled ? 'bg-c-green shadow-[0_0_4px_rgba(57,255,20,0.5)]' : 'bg-c-muted'}`} />
            <span className="text-[11px] text-c-dim">
              {agent.heartbeat.enabled ? `Next: ${formatCountdown(agent.heartbeat.nextWake)}` : 'Disabled'}
            </span>
            <span className={`ml-auto text-[10px] font-semibold uppercase tracking-wider ${agent.heartbeat.enabled ? 'text-c-green' : 'text-c-red'}`}>
              {agent.heartbeat.enabled ? 'on' : 'off'}
            </span>
            <button
              onClick={() => onHeartbeatToggle(!agent.heartbeat.enabled)}
              className="text-[10px] text-c-muted hover:text-c-green transition-colors uppercase tracking-wider border border-c-border px-1.5 py-0.5"
            >
              {agent.heartbeat.enabled ? 'disable' : 'enable'}
            </button>
          </div>
          {agent.heartbeat.lastDecision && (
            <div className="text-[10px] text-c-muted truncate mb-1.5">
              Last: <span className={agent.heartbeat.lastDecision === 'idle' ? 'text-c-dim' : 'text-c-green'}>{agent.heartbeat.lastDecision}</span>
            </div>
          )}
          <button
            onClick={onHeartbeatTrigger}
            className="w-full text-[10px] py-1 border border-c-border text-c-muted hover:text-c-green hover:border-c-green transition-colors uppercase tracking-wider"
          >
            Trigger Now
          </button>
        </div>

        {/* Stats Widget */}
        <div className="px-3 py-3 border-t border-white/10">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-c-muted mb-2">Session Stats</div>
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-c-muted">Tokens In</span>
              <span className="text-c-cyan font-medium">{formatTokens(agent.totalTokens.input)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-c-muted">Tokens Out</span>
              <span className="text-c-cyan font-medium">{formatTokens(agent.totalTokens.output)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-c-muted">Tool Calls</span>
              <span className="text-c-amber font-medium">{agent.toolCalls}</span>
            </div>
          </div>
        </div>

        {/* Clock */}
        <div className="px-3 py-2 border-t border-white/10 text-center text-[11px] text-c-muted font-medium">
          {clock.toLocaleTimeString('en-US', { hour12: false })}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {children}
      </main>
    </div>
  );
}
