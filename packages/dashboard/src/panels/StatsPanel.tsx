import { useState, useEffect, useMemo } from 'react';
import { Panel } from '../components/Panel';
import type { AgentState } from '../hooks/useAgent';
import { authFetch } from '../auth';

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
    <div className="flex justify-between items-baseline text-[12px]">
      <span className="text-c-muted text-[11px] uppercase tracking-[0.05em]">{label}</span>
      <span className={`font-medium ${color}`}>{value}</span>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-c-accent mt-4 mb-2 pt-3 border-t border-c-border first:mt-0 first:pt-0 first:border-0">
      {label}
    </div>
  );
}

// ─── Cost Bar Chart ─────────────────────────────────────────────────

function CostChart({ daily }: { daily: DailyUsage[] }) {
  // Show last 14 days, fill gaps with zero — use local dates, not UTC
  const chartData = useMemo(() => {
    const days: { date: string; label: string; cost: number }[] = [];
    const now = new Date();

    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      // Use local date, not UTC
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayData = daily.find(dd => dd.date === dateStr);
      days.push({
        date: dateStr,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        cost: dayData?.costUsd ?? 0,
      });
    }
    return days;
  }, [daily]);

  const maxCost = Math.max(...chartData.map(d => d.cost), 0.01);

  return (
    <div className="mt-2">
      <div className="flex items-end gap-[3px] h-[60px]">
        {chartData.map((day, i) => {
          const height = day.cost > 0 ? Math.max((day.cost / maxCost) * 100, 4) : 0;
          const isToday = i === chartData.length - 1;
          return (
            <div
              key={day.date}
              className="flex-1 flex flex-col items-center justify-end h-full group relative"
            >
              <div
                className={`w-full transition-all ${day.cost > 0 ? (isToday ? 'bg-c-accent' : 'bg-c-accent/30') : 'bg-c-border/50'} group-hover:bg-c-accent/60`}
                style={{ height: `${height}%`, minHeight: 1 }}
              />
              {/* Tooltip */}
              <div className="absolute -top-7 opacity-0 group-hover:opacity-100 transition-opacity bg-c-surface border border-c-border px-1.5 py-0.5 text-[9px] text-c-text whitespace-nowrap z-10 pointer-events-none">
                {day.label}: {formatCost(day.cost)}
              </div>
            </div>
          );
        })}
      </div>
      {/* X-axis labels */}
      <div className="flex justify-between mt-1">
        <span className="text-[9px] text-c-muted">{chartData[0]?.label}</span>
        <span className="text-[9px] text-c-muted">Today</span>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export function StatsPanel({ agent, connected, startTime }: Props) {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const uptime = Date.now() - startTime;

  useEffect(() => {
    const load = () => {
      authFetch('/api/usage')
        .then(r => r.json())
        .then(setUsage)
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  // Budget forecasting
  const forecast = useMemo(() => {
    if (!usage || usage.daily.length === 0) return null;

    const last7 = usage.daily.slice(-7);
    const last30 = usage.daily.slice(-30);

    const avg7 = last7.reduce((s, d) => s + d.costUsd, 0) / Math.max(last7.length, 1);
    const avg30 = last30.reduce((s, d) => s + d.costUsd, 0) / Math.max(last30.length, 1);

    // Use 7-day average for projection (more recent = more relevant)
    const dailyAvg = last7.length >= 3 ? avg7 : avg30;
    const projectedMonthly = dailyAvg * 30;

    // Days active
    const daysActive = usage.daily.length;

    return { dailyAvg, projectedMonthly, daysActive, avg7, avg30 };
  }, [usage]);

  return (
    <Panel title="System Stats" className="h-full">
      <div className="space-y-1.5 px-1">
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

        {/* Budget Forecast */}
        {forecast && (
          <>
            <SectionHeader label="Budget Forecast" />
            <StatRow label="Daily Average" value={formatCost(forecast.dailyAvg)} color="text-c-amber" />
            <StatRow
              label="Projected Monthly"
              value={formatCost(forecast.projectedMonthly)}
              color={forecast.projectedMonthly > 50 ? 'text-c-red' : forecast.projectedMonthly > 20 ? 'text-c-amber' : 'text-c-green'}
            />
            <StatRow label="Days Tracked" value={String(forecast.daysActive)} />
            {usage && usage.daily.length > 0 && (
              <CostChart daily={usage.daily} />
            )}
          </>
        )}

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
