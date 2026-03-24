import { useState, useEffect, useMemo, useCallback } from 'react';
import { MessageSquare, HeartPulse, Brain, Wrench, Send, Zap, Activity, ChevronRight } from 'lucide-react';
import type { SocketEvent } from '../hooks/useSocket';
import type { AgentState } from '../hooks/useAgent';
import type { View } from '../components/Shell';
import { authFetch } from '../auth';

interface Props {
  agent: AgentState;
  connected: boolean;
  events: SocketEvent[];
  agentName: string;
  startTime: number;
  appConfig: { models?: { default: string; advanced: string; heartbeat: string }; llm: { model: string } } | null;
  onNavigate: (view: View) => void;
  onChatSend: (message: string) => void;
}

interface UsageSummary {
  session: { costUsd: number };
  today: { costUsd: number; toolCalls: number; conversations: number };
  lifetime: { costUsd: number; sessions: number; conversations: number; firstUsed: number };
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Quick Action Card ──────────────────────────────────────────────

function QuickAction({ icon: Icon, label, sublabel, color, onClick }: {
  icon: typeof MessageSquare;
  label: string;
  sublabel: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="bg-c-surface border border-c-border p-4 text-left hover:border-c-accent/25 transition-all group flex-1 min-w-0"
    >
      <Icon size={18} className={`${color} mb-3 group-hover:scale-110 transition-transform`} />
      <div className="text-[13px] text-c-text font-medium mb-0.5">{label}</div>
      <div className="text-[11px] text-c-dim">{sublabel}</div>
    </button>
  );
}

// ─── Stat Block ─────────────────────────────────────────────────────

function StatBlock({ label, value, color = 'text-c-text' }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center">
      <div className={`text-[20px] font-medium ${color}`}>{value}</div>
      <div className="text-[10px] text-c-muted uppercase tracking-[0.1em] mt-0.5">{label}</div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export function HomePanel({ agent, connected, events, agentName, startTime, appConfig, onNavigate, onChatSend }: Props) {
  const [input, setInput] = useState('');
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const uptime = Date.now() - startTime;

  useEffect(() => {
    authFetch('/api/usage').then(r => r.json()).then(setUsage).catch(() => {});
    const timer = setInterval(() => {
      authFetch('/api/usage').then(r => r.json()).then(setUsage).catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || agent.isRunning) return;
    onChatSend(input.trim());
    setInput('');
  }, [input, agent.isRunning, onChatSend]);

  // Recent activity — last 8 non-heartbeat events
  const recentActivity = useMemo(() => {
    return events
      .filter(e => {
        const convId = e.data['conversationId'] as string | undefined;
        if (convId?.startsWith('heartbeat')) return false;
        return e.type === 'agent:response' || e.type === 'agent:tool_call' || e.type === 'heartbeat:decision';
      })
      .slice(0, 6)
      .map(e => {
        if (e.type === 'agent:response') {
          const text = (e.data['text'] as string)?.slice(0, 80) ?? '';
          return { type: 'response', text, ts: e.ts };
        }
        if (e.type === 'agent:tool_call') {
          const tool = e.data['tool'] as string;
          return { type: 'tool', text: tool, ts: e.ts };
        }
        if (e.type === 'heartbeat:decision') {
          const action = e.data['action'] as string;
          const reason = (e.data['reason'] as string)?.slice(0, 60) ?? '';
          return { type: 'heartbeat', text: action === 'idle' ? 'Checked in — nothing to do' : reason, ts: e.ts };
        }
        return { type: 'other', text: e.type, ts: e.ts };
      });
  }, [events]);

  const modelName = (appConfig?.models?.default ?? appConfig?.llm.model ?? 'sonnet')
    .replace(/^claude-/, '').replace(/-\d+.*$/, '');

  const statusColor = connected ? (agent.isRunning ? 'text-c-amber' : 'text-c-green') : 'text-c-red';
  const statusText = connected ? (agent.isRunning ? 'Working' : 'Online') : 'Offline';
  const statusDotColor = connected ? (agent.isRunning ? 'bg-c-amber' : 'bg-c-green') : 'bg-c-red';

  return (
    <div className="h-full flex flex-col bg-c-panel overflow-hidden">
      <div className="flex-1 overflow-y-auto">

        {/* Hero — Agent Identity */}
        <div className="px-8 pt-10 pb-8 text-center relative">
          {/* Subtle gradient backdrop */}
          <div className="absolute inset-0 bg-gradient-to-b from-c-accent/[0.03] to-transparent pointer-events-none" />

          <div className="relative">
            {/* Status orb */}
            <div className="flex justify-center mb-4">
              <div className={`w-3 h-3 ${statusDotColor} ${connected ? 'animate-pulse-live' : ''}`}
                style={{ boxShadow: connected ? `0 0 12px var(--color-c-${agent.isRunning ? 'amber' : 'green'})` : 'none' }}
              />
            </div>

            <h1 className="text-[32px] font-medium tracking-[0.25em] text-c-text glow-text-strong leading-none">
              {agentName.toUpperCase()}
            </h1>
            <div className="flex items-center justify-center gap-3 mt-3">
              <span className={`text-[12px] font-medium uppercase tracking-[0.12em] ${statusColor}`}>{statusText}</span>
              <span className="text-c-border">·</span>
              <span className="text-[12px] text-c-muted uppercase tracking-[0.08em]">{modelName}</span>
              <span className="text-c-border">·</span>
              <span className="text-[12px] text-c-muted">{formatUptime(uptime)}</span>
            </div>
          </div>
        </div>

        {/* Chat Input — front and center */}
        <div className="px-8 pb-6">
          <div className="bg-c-surface border border-c-border hover:border-c-accent/20 transition-colors flex items-center gap-3 px-4 py-3">
            <span className="text-c-accent text-[14px] font-medium shrink-0">&gt;</span>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder={agent.isRunning ? 'Agent is working...' : 'Ask something...'}
              disabled={agent.isRunning}
              className="flex-1 bg-transparent border-none outline-none text-c-text font-mono text-[14px] placeholder:text-c-muted/50 disabled:opacity-30"
              style={{ caretColor: 'var(--color-c-accent)' }}
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || agent.isRunning}
              className={`p-1 transition-colors ${input.trim() && !agent.isRunning ? 'text-c-accent hover:text-c-accent/80' : 'text-c-muted/20'}`}
            >
              <Send size={18} />
            </button>
          </div>
        </div>

        {/* Stats Row */}
        {usage && (
          <div className="px-8 pb-8">
            <div className="flex justify-around py-4 border-t border-b border-c-border/50">
              <StatBlock label="Today" value={formatCost(usage.today.costUsd)} color="text-c-amber" />
              <StatBlock label="Conversations" value={String(usage.today.conversations)} color="text-c-cyan" />
              <StatBlock label="Tool Calls" value={String(usage.today.toolCalls)} color="text-c-accent" />
              <StatBlock label="Sessions" value={String(usage.lifetime.sessions)} color="text-c-dim" />
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="px-8 pb-8">
          <div className="flex gap-3">
            <QuickAction
              icon={MessageSquare}
              label="Chat"
              sublabel="Open terminal"
              color="text-c-cyan"
              onClick={() => onNavigate('chat')}
            />
            <QuickAction
              icon={HeartPulse}
              label="Heartbeat"
              sublabel={agent.heartbeat.enabled ? 'Running' : 'Disabled'}
              color="text-c-green"
              onClick={() => onNavigate('heartbeat')}
            />
            <QuickAction
              icon={Brain}
              label="Memory"
              sublabel="Recall & notes"
              color="text-c-purple"
              onClick={() => onNavigate('memory')}
            />
            <QuickAction
              icon={Wrench}
              label="Tools"
              sublabel="Custom & catalog"
              color="text-c-amber"
              onClick={() => onNavigate('tools')}
            />
          </div>
        </div>

        {/* Recent Activity */}
        <div className="px-8 pb-8">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-c-muted flex items-center gap-2">
              <Activity size={12} />
              Recent Activity
            </div>
          </div>

          {recentActivity.length === 0 ? (
            <div className="bg-c-surface border border-c-border p-6 text-center">
              <div className="text-[13px] text-c-dim mb-1">No activity yet</div>
              <div className="text-[11px] text-c-muted">Start a conversation or trigger a heartbeat</div>
            </div>
          ) : (
            <div className="space-y-1">
              {recentActivity.map((item, i) => (
                <div key={`${item.ts}-${i}`} className="flex items-center gap-3 py-1.5 px-3 bg-c-surface/50 border border-c-border/50 hover:border-c-border transition-colors">
                  <span className="text-[10px] text-c-muted shrink-0 w-14">{timeAgo(item.ts)}</span>
                  {item.type === 'response' && <MessageSquare size={11} className="text-c-cyan shrink-0" />}
                  {item.type === 'tool' && <Wrench size={11} className="text-c-amber shrink-0" />}
                  {item.type === 'heartbeat' && <HeartPulse size={11} className="text-c-green shrink-0" />}
                  <span className="text-[12px] text-c-dim truncate">{item.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
