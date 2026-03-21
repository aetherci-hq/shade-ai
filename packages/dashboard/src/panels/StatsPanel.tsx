import { useState, useEffect } from 'react';
import { Panel } from '../components/Panel';
import type { AgentState } from '../hooks/useAgent';

interface Props {
  agent: AgentState;
  connected: boolean;
  startTime: number;
}

interface DailyUsage {
  date: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  toolCalls: number;
  conversations: number;
}

interface UsageSummary {
  session: {
    startedAt: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    toolCalls: number;
    conversations: number;
  };
  today: DailyUsage;
  lifetime: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    toolCalls: number;
    conversations: number;
    sessions: number;
    firstUsed: number;
  };
  daily: DailyUsage[];
}

function formatUptime(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function StatRow({ label, value, color = 'text-c-text' }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between items-baseline text-xs">
      <span className="text-c-muted text-[10px] uppercase tracking-[0.05em]">{label}</span>
      <span className={`font-medium ${color}`}>{value}</span>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="text-[9px] font-medium uppercase tracking-[0.15em] text-c-accent mt-3 mb-1.5 pt-2 border-t border-c-border first:mt-0 first:pt-0 first:border-0">
      {label}
    </div>
  );
}

export function StatsPanel({ agent, connected, startTime }: Props) {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const uptime = Date.now() - startTime;

  useEffect(() => {
    const load = () => {
      fetch('/api/usage')
        .then(r => r.json())
        .then(setUsage)
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 15000); // Refresh every 15s
    return () => clearInterval(timer);
  }, []);

  return (
    <Panel title="System Stats" className="h-full">
      <div className="space-y-1">
        {/* Live status */}
        <StatRow
          label="Status"
          value={connected ? (agent.isRunning ? 'Working' : 'Alive') : 'Disconnected'}
          color={connected ? 'text-c-green' : 'text-c-red'}
        />
        <StatRow label="Uptime" value={formatUptime(uptime)} />
        <StatRow
          label="Heartbeat"
          value={agent.heartbeat.enabled ? 'Enabled' : 'Disabled'}
          color={agent.heartbeat.enabled ? 'text-c-green' : 'text-c-muted'}
        />

        {/* Session */}
        <SectionHeader label="This Session" />
        <StatRow label="Tokens In" value={formatTokens(agent.totalTokens.input)} color="text-c-cyan" />
        <StatRow label="Tokens Out" value={formatTokens(agent.totalTokens.output)} color="text-c-cyan" />
        <StatRow label="Cost" value={usage ? formatCost(usage.session.costUsd) : '—'} color="text-c-amber" />
        <StatRow label="Tool Calls" value={String(agent.toolCalls)} color="text-c-amber" />

        {/* Today */}
        {usage && (
          <>
            <SectionHeader label="Today" />
            <StatRow label="Tokens In" value={formatTokens(usage.today.inputTokens)} color="text-c-cyan" />
            <StatRow label="Tokens Out" value={formatTokens(usage.today.outputTokens)} color="text-c-cyan" />
            <StatRow label="Cost" value={formatCost(usage.today.costUsd)} color="text-c-amber" />
            <StatRow label="Tool Calls" value={String(usage.today.toolCalls)} color="text-c-amber" />
            <StatRow label="Conversations" value={String(usage.today.conversations)} />
          </>
        )}

        {/* Lifetime */}
        {usage && (
          <>
            <SectionHeader label="All Time" />
            <StatRow label="Tokens In" value={formatTokens(usage.lifetime.inputTokens)} color="text-c-cyan" />
            <StatRow label="Tokens Out" value={formatTokens(usage.lifetime.outputTokens)} color="text-c-cyan" />
            <StatRow label="Total Cost" value={formatCost(usage.lifetime.costUsd)} color="text-c-amber" />
            <StatRow label="Tool Calls" value={String(usage.lifetime.toolCalls)} color="text-c-amber" />
            <StatRow label="Conversations" value={String(usage.lifetime.conversations)} />
            <StatRow label="Sessions" value={String(usage.lifetime.sessions)} />
            <StatRow
              label="First Used"
              value={new Date(usage.lifetime.firstUsed).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            />
          </>
        )}
      </div>
    </Panel>
  );
}
