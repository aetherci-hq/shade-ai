import { useState, useEffect, useMemo, useCallback } from 'react';
import { Zap, Play, Pause, ChevronDown, ChevronRight, Clock, Activity, Terminal } from 'lucide-react';
import type { SocketEvent } from '../hooks/useSocket';
import type { AgentState } from '../hooks/useAgent';

// ─── Types ──────────────────────────────────────────────────────────

interface HeartbeatCycle {
  wakeTs: number;
  decision: 'idle' | 'acted' | 'pending';
  reason: string;
  sleepTs?: number;
  tools: { name: string; input: string; output: string; durationMs: number; error: boolean }[];
  costUsd?: number;
}

interface DayActivity {
  date: string; // YYYY-MM-DD
  wakes: number;
  acted: number;
  idle: number;
  cost: number;
}

interface Props {
  agent: AgentState;
  events: SocketEvent[];
  onHeartbeatTrigger: () => void;
  onHeartbeatToggle: (enabled: boolean) => void;
  memoryContent: Record<string, string>;
  onMemorySave: (file: string, content: string) => void;
  onMemoryLoad: (file: string) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatCountdown(nextWake: number): { minutes: number; seconds: number; fraction: number } {
  const diff = Math.max(0, nextWake - Date.now());
  const totalSecs = diff / 1000;
  const minutes = Math.floor(totalSecs / 60);
  const seconds = Math.floor(totalSecs % 60);
  // fraction of the interval that has elapsed (for ring)
  return { minutes, seconds, fraction: 0 };
}

function dateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Progress Ring (SVG) ────────────────────────────────────────────

function ProgressRing({ progress, status, minutes, seconds }: {
  progress: number;
  status: 'sleeping' | 'waking' | 'working' | 'disabled';
  minutes: number;
  seconds: number;
}) {
  const size = 160;
  const stroke = 3;
  const radius = (size - stroke * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(1, Math.max(0, progress)));

  const statusLabel = status.toUpperCase();
  const statusColor = status === 'working' ? 'var(--color-c-amber)' :
                      status === 'waking' ? 'var(--color-c-green)' :
                      status === 'disabled' ? 'var(--color-c-muted)' :
                      'var(--color-c-dim)';

  const ringColor = status === 'disabled' ? 'var(--color-c-muted)' : 'var(--color-c-green)';
  const glowFilter = status === 'disabled' ? '' : 'url(#ringGlow)';

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <defs>
          <filter id="ringGlow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        {/* Track */}
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke="var(--color-c-surface)"
          strokeWidth={stroke}
        />
        {/* Tick marks every 5 minutes (12 ticks for a 60-min display) */}
        {Array.from({ length: 60 }, (_, i) => {
          const angle = (i / 60) * 2 * Math.PI - Math.PI / 2;
          const isMajor = i % 5 === 0;
          const innerR = radius - (isMajor ? 8 : 4);
          const outerR = radius - 1;
          return (
            <line
              key={i}
              x1={size / 2 + innerR * Math.cos(angle + Math.PI / 2)}
              y1={size / 2 + innerR * Math.sin(angle + Math.PI / 2)}
              x2={size / 2 + outerR * Math.cos(angle + Math.PI / 2)}
              y2={size / 2 + outerR * Math.sin(angle + Math.PI / 2)}
              stroke={isMajor ? 'var(--color-c-border)' : 'rgba(33,38,45,0.5)'}
              strokeWidth={isMajor ? 1.5 : 0.5}
            />
          );
        })}
        {/* Progress arc */}
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke={ringColor}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          filter={glowFilter}
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      {/* Center content */}
      <div className="flex flex-col items-center z-10">
        <span className="text-[28px] font-bold tracking-tight" style={{ color: ringColor, textShadow: status !== 'disabled' ? '0 0 20px rgba(57,255,20,0.3)' : 'none' }}>
          {status === 'disabled' ? '--:--' : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`}
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-[0.2em] mt-0.5" style={{ color: statusColor }}>
          {statusLabel}
        </span>
      </div>
    </div>
  );
}

// ─── Heatmap Grid ───────────────────────────────────────────────────

function HeatmapGrid({ days }: { days: DayActivity[] }) {
  const [hoveredDay, setHoveredDay] = useState<DayActivity | null>(null);
  const today = dateKey(Date.now());

  // Build 30-day grid
  const grid = useMemo(() => {
    const map = new Map(days.map(d => [d.date, d]));
    const result: DayActivity[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = dateKey(d.getTime());
      result.push(map.get(key) ?? { date: key, wakes: 0, acted: 0, idle: 0, cost: 0 });
    }
    return result;
  }, [days]);

  const maxActed = Math.max(1, ...grid.map(d => d.acted));

  return (
    <div className="relative">
      <div className="flex gap-[3px] flex-wrap">
        {grid.map(day => {
          const intensity = day.acted / maxActed;
          const isToday = day.date === today;
          const hasActivity = day.wakes > 0;

          let bg: string;
          if (!hasActivity) {
            bg = 'var(--color-c-surface)';
          } else if (day.acted === 0) {
            bg = 'rgba(72, 79, 88, 0.4)'; // idle — muted
          } else {
            const alpha = 0.15 + intensity * 0.65;
            bg = `rgba(57, 255, 20, ${alpha})`;
          }

          return (
            <div
              key={day.date}
              className="relative cursor-default"
              style={{
                width: 18,
                height: 18,
                background: bg,
                border: isToday ? '1px solid var(--color-c-green)' : '1px solid transparent',
                boxShadow: isToday ? '0 0 8px rgba(57,255,20,0.2)' : hasActivity && day.acted > 0 ? `0 0 ${4 + intensity * 6}px rgba(57,255,20,${intensity * 0.15})` : 'none',
                animation: isToday ? 'pulse-live 2s ease-in-out infinite' : undefined,
              }}
              onMouseEnter={() => setHoveredDay(day)}
              onMouseLeave={() => setHoveredDay(null)}
            />
          );
        })}
      </div>
      {/* Tooltip */}
      {hoveredDay && (
        <div
          className="absolute z-20 px-2.5 py-1.5 text-[10px] border border-c-border bg-c-panel"
          style={{ bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6, whiteSpace: 'nowrap' }}
        >
          <span className="text-c-text font-medium">{new Date(hoveredDay.date + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          <span className="text-c-muted ml-2">{hoveredDay.wakes} wakes</span>
          <span className="text-c-green ml-2">{hoveredDay.acted} acted</span>
          {hoveredDay.cost > 0 && <span className="text-c-amber ml-2">${hoveredDay.cost.toFixed(3)}</span>}
        </div>
      )}
      {/* Legend */}
      <div className="flex items-center gap-2 mt-2 text-[9px] text-c-muted">
        <span>less</span>
        <div className="flex gap-[2px]">
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v, i) => (
            <div key={i} style={{ width: 10, height: 10, background: v === 0 ? 'var(--color-c-surface)' : `rgba(57,255,20,${0.15 + v * 0.65})` }} />
          ))}
        </div>
        <span>more</span>
      </div>
    </div>
  );
}

// ─── Timeline Entry ─────────────────────────────────────────────────

function TimelineEntry({ cycle, isFirst }: { cycle: HeartbeatCycle; isFirst: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isActed = cycle.decision === 'acted';
  const duration = cycle.sleepTs ? cycle.sleepTs - cycle.wakeTs : Date.now() - cycle.wakeTs;

  return (
    <div className="relative flex gap-3 animate-fade-in">
      {/* Vertical connector line */}
      <div className="flex flex-col items-center shrink-0" style={{ width: 20 }}>
        <div
          className="w-2 h-2 rounded-full shrink-0 mt-1"
          style={{
            background: isActed ? 'var(--color-c-green)' : cycle.decision === 'pending' ? 'var(--color-c-amber)' : 'var(--color-c-muted)',
            boxShadow: isActed ? '0 0 8px rgba(57,255,20,0.4)' : cycle.decision === 'pending' ? '0 0 6px rgba(210,153,34,0.4)' : 'none',
          }}
        />
        {!isFirst && (
          <div className="w-px flex-1 min-h-[16px]" style={{ background: 'var(--color-c-border)' }} />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 pb-3 min-w-0">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-c-muted">{formatTime(cycle.wakeTs)}</span>
          <span
            className="font-semibold uppercase tracking-[0.08em] text-[9px] px-1.5 py-px border"
            style={{
              color: isActed ? 'var(--color-c-green)' : cycle.decision === 'pending' ? 'var(--color-c-amber)' : 'var(--color-c-muted)',
              borderColor: isActed ? 'rgba(57,255,20,0.3)' : cycle.decision === 'pending' ? 'rgba(210,153,34,0.3)' : 'var(--color-c-border)',
              background: isActed ? 'rgba(57,255,20,0.06)' : 'transparent',
            }}
          >
            {cycle.decision === 'pending' ? 'working' : cycle.decision}
          </span>
          <span className="text-c-muted text-[10px]">{formatDuration(duration)}</span>
          {cycle.costUsd !== undefined && cycle.costUsd > 0 && (
            <span className="text-c-amber text-[10px]">${cycle.costUsd.toFixed(4)}</span>
          )}
          {isActed && cycle.tools.length > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="ml-auto flex items-center gap-1 text-[9px] text-c-muted hover:text-c-green transition-colors uppercase tracking-wider"
            >
              {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              {cycle.tools.length} tools
            </button>
          )}
        </div>

        {/* Reason preview */}
        {cycle.reason && (
          <div className="text-[10px] text-c-dim mt-1 leading-relaxed truncate">
            {cycle.reason.slice(0, 120)}
          </div>
        )}

        {/* Expanded tool trace */}
        {expanded && (
          <div className="mt-2 space-y-1 border-l border-c-border pl-2 ml-1">
            {cycle.tools.map((tool, i) => (
              <div key={i} className="text-[10px]">
                <div className="flex items-center gap-2">
                  <span className="text-c-cyan font-medium">{tool.name}</span>
                  <span className="text-c-muted">{tool.durationMs}ms</span>
                  {tool.error && <span className="text-c-red font-medium">FAIL</span>}
                </div>
                {tool.output && (
                  <div className="text-c-dim mt-0.5 truncate">{tool.output.slice(0, 100)}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Standing Orders Card ───────────────────────────────────────────

function StandingOrders({ content, onSave, onLoad }: {
  content: string;
  onSave: (content: string) => void;
  onLoad: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);

  useEffect(() => { onLoad(); }, [onLoad]);
  useEffect(() => { if (!editing) setDraft(content); }, [content, editing]);

  const orders = useMemo(() => {
    if (!content) return [];
    return content.split('\n').filter(l => l.trim().length > 0 && !l.startsWith('#'));
  }, [content]);

  const handleSave = () => {
    onSave(draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="space-y-2">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          className="w-full bg-c-surface border border-c-border text-c-text text-[11px] p-2 outline-none resize-none font-mono"
          style={{ minHeight: 120, caretColor: 'var(--color-c-green)' }}
          autoFocus
        />
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            className="text-[10px] px-3 py-1 border border-c-green text-c-green uppercase tracking-wider font-semibold hover:bg-[rgba(57,255,20,0.1)] transition-colors"
          >
            Save
          </button>
          <button
            onClick={() => { setEditing(false); setDraft(content); }}
            className="text-[10px] px-3 py-1 border border-c-border text-c-muted uppercase tracking-wider hover:text-c-text transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-c-muted flex items-center gap-1.5">
          <Terminal size={10} />
          Standing Orders
        </div>
        <button
          onClick={() => setEditing(true)}
          className="text-[9px] text-c-muted hover:text-c-green transition-colors uppercase tracking-wider border border-c-border px-1.5 py-0.5 hover:border-c-green"
        >
          Edit
        </button>
      </div>
      {orders.length === 0 ? (
        <div className="text-c-muted text-[11px]">No standing orders. Click edit to add tasks.</div>
      ) : (
        <div className="space-y-1">
          {orders.map((order, i) => (
            <div key={i} className="flex gap-2 text-[11px] py-0.5">
              <span className="text-c-green shrink-0">{'>'}</span>
              <span className="text-c-dim">{order}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export function HeartbeatPanel({ agent, events, onHeartbeatTrigger, onHeartbeatToggle, memoryContent, onMemorySave, onMemoryLoad }: Props) {
  const [now, setNow] = useState(Date.now());

  // Tick every second for countdown
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ─── Derive heartbeat cycles from events ───────────────────────
  const { cycles, dayActivity, stats } = useMemo(() => {
    const cycles: HeartbeatCycle[] = [];
    let current: HeartbeatCycle | null = null;
    let totalCost = 0;
    let todayWakes = 0;
    let todayActed = 0;
    const todayKey = dateKey(Date.now());
    const dayMap = new Map<string, DayActivity>();

    // Process oldest-first
    const sorted = [...events].reverse();
    for (const evt of sorted) {
      if (evt.type === 'heartbeat:wake') {
        if (current) cycles.push(current);
        current = {
          wakeTs: evt.data['timestamp'] as number ?? evt.ts,
          decision: 'pending',
          reason: '',
          tools: [],
        };
      }
      if (evt.type === 'heartbeat:decision' && current) {
        current.decision = (evt.data['action'] as string) === 'idle' ? 'idle' : 'acted';
        current.reason = evt.data['reason'] as string ?? '';
      }
      if (evt.type === 'heartbeat:sleep' && current) {
        current.sleepTs = evt.ts;
        // Finalize this cycle
        const dk = dateKey(current.wakeTs);
        const day = dayMap.get(dk) ?? { date: dk, wakes: 0, acted: 0, idle: 0, cost: 0 };
        day.wakes++;
        if (current.decision === 'acted') day.acted++;
        else day.idle++;
        day.cost += current.costUsd ?? 0;
        dayMap.set(dk, day);

        if (dk === todayKey) {
          todayWakes++;
          if (current.decision === 'acted') todayActed++;
        }
        totalCost += current.costUsd ?? 0;
      }
      // Capture tool calls during heartbeat
      if (evt.type === 'agent:tool_call' && current && current.decision === 'pending') {
        current.tools.push({
          name: evt.data['tool'] as string ?? '',
          input: JSON.stringify(evt.data['input']).slice(0, 100),
          output: '',
          durationMs: 0,
          error: false,
        });
      }
      if (evt.type === 'agent:tool_result' && current && current.tools.length > 0) {
        const lastTool = current.tools[current.tools.length - 1];
        lastTool.output = (evt.data['output'] as string ?? '').slice(0, 200);
        lastTool.durationMs = evt.data['durationMs'] as number ?? 0;
        lastTool.error = evt.data['error'] as boolean ?? false;
      }
      if (evt.type === 'agent:response' && current) {
        current.costUsd = evt.data['costUsd'] as number ?? 0;
      }
    }
    if (current) cycles.push(current);

    // Compute streak
    let streak = 0;
    let streakType: 'acted' | 'idle' | 'none' = 'none';
    const recentCycles = [...cycles].reverse();
    if (recentCycles.length > 0) {
      streakType = recentCycles[0].decision === 'acted' ? 'acted' : recentCycles[0].decision === 'idle' ? 'idle' : 'none';
      for (const c of recentCycles) {
        if ((c.decision === 'acted' && streakType === 'acted') || (c.decision === 'idle' && streakType === 'idle')) {
          streak++;
        } else break;
      }
    }

    return {
      cycles: [...cycles].reverse(), // newest first
      dayActivity: Array.from(dayMap.values()),
      stats: { totalCost, todayWakes, todayActed, totalCycles: cycles.length, streak, streakType },
    };
  }, [events]);

  // ─── Status & countdown ────────────────────────────────────────
  const isEnabled = agent.heartbeat.enabled;
  const isWorking = agent.isRunning;
  const countdown = formatCountdown(agent.heartbeat.nextWake);

  // Calculate progress (0 = just woke, 1 = about to wake)
  const intervalMs = 15 * 60 * 1000; // fallback
  const elapsed = isEnabled && agent.heartbeat.nextWake > 0
    ? Math.max(0, intervalMs - (agent.heartbeat.nextWake - now))
    : 0;
  const progress = isEnabled ? Math.min(1, elapsed / intervalMs) : 0;

  const status: 'sleeping' | 'waking' | 'working' | 'disabled' =
    !isEnabled ? 'disabled' :
    isWorking ? 'working' :
    countdown.minutes === 0 && countdown.seconds < 5 ? 'waking' : 'sleeping';

  const handleMemoryLoad = useCallback(() => {
    onMemoryLoad('HEARTBEAT');
  }, [onMemoryLoad]);

  const handleMemorySave = useCallback((content: string) => {
    onMemorySave('HEARTBEAT', content);
  }, [onMemorySave]);

  return (
    <div className="h-full flex flex-col bg-c-panel overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center px-3 py-1.5 border-b border-c-border shrink-0">
        <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-c-dim glow-text flex items-center gap-1.5">
          <Activity size={12} className="text-c-green" />
          Heartbeat Command
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onHeartbeatToggle(!isEnabled)}
            className={`flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 border transition-all ${
              isEnabled
                ? 'text-c-green border-c-green/30 bg-[rgba(57,255,20,0.06)] hover:bg-[rgba(57,255,20,0.12)]'
                : 'text-c-muted border-c-border hover:text-c-green hover:border-c-green/30'
            }`}
          >
            {isEnabled ? <Pause size={8} /> : <Play size={8} />}
            {isEnabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">

        {/* ─── Command Center: Ring + Stats ─── */}
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-start gap-6">
            {/* Progress Ring */}
            <div className="shrink-0">
              <ProgressRing
                progress={progress}
                status={status}
                minutes={countdown.minutes}
                seconds={countdown.seconds}
              />
            </div>

            {/* Stats + Controls */}
            <div className="flex-1 min-w-0 pt-1">
              {/* Quick stats grid */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-4">
                <div>
                  <div className="text-[9px] uppercase tracking-[0.1em] text-c-muted">Today</div>
                  <div className="text-[16px] font-bold text-c-text">{stats.todayWakes}</div>
                  <div className="text-[9px] text-c-dim">wakes</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-[0.1em] text-c-muted">Acted</div>
                  <div className="text-[16px] font-bold text-c-green">{stats.todayActed}</div>
                  <div className="text-[9px] text-c-dim">of {stats.todayWakes} today</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-[0.1em] text-c-muted">Total Cost</div>
                  <div className="text-[14px] font-bold text-c-amber">${stats.totalCost.toFixed(3)}</div>
                  <div className="text-[9px] text-c-dim">all heartbeats</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-[0.1em] text-c-muted">Streak</div>
                  <div className="text-[14px] font-bold" style={{
                    color: stats.streakType === 'acted' ? 'var(--color-c-green)' :
                           stats.streakType === 'idle' ? 'var(--color-c-muted)' : 'var(--color-c-dim)'
                  }}>
                    {stats.streak > 0 ? stats.streak : '—'}
                  </div>
                  <div className="text-[9px] text-c-dim">
                    {stats.streakType === 'acted' ? 'productive' : stats.streakType === 'idle' ? 'idle' : '—'}
                  </div>
                </div>
              </div>

              {/* Trigger button */}
              <button
                onClick={onHeartbeatTrigger}
                disabled={isWorking}
                className="flex items-center gap-1.5 text-[10px] px-3 py-1.5 border border-c-green text-c-green uppercase tracking-[0.12em] font-semibold hover:bg-[rgba(57,255,20,0.1)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                style={{ textShadow: '0 0 10px rgba(57,255,20,0.3)' }}
              >
                <Zap size={10} />
                Trigger Now
              </button>
            </div>
          </div>
        </div>

        {/* ─── Divider ─── */}
        <div className="border-t border-c-border" />

        {/* ─── Activity Heatmap ─── */}
        <div className="px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-c-muted mb-2.5 flex items-center gap-1.5">
            <Clock size={10} />
            30-Day Activity
          </div>
          <HeatmapGrid days={dayActivity} />
        </div>

        {/* ─── Divider ─── */}
        <div className="border-t border-c-border" />

        {/* ─── Standing Orders ─── */}
        <div className="px-4 py-3">
          <StandingOrders
            content={memoryContent['HEARTBEAT'] ?? ''}
            onSave={handleMemorySave}
            onLoad={handleMemoryLoad}
          />
        </div>

        {/* ─── Divider ─── */}
        <div className="border-t border-c-border" />

        {/* ─── Timeline ─── */}
        <div className="px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-c-muted mb-3 flex items-center gap-1.5">
            <Activity size={10} />
            Cycle History
            <span className="text-c-dim ml-1">({cycles.length})</span>
          </div>

          {cycles.length === 0 ? (
            <div className="text-c-muted text-[11px] py-4 text-center">
              No heartbeat cycles recorded yet.
            </div>
          ) : (
            <div>
              {cycles.slice(0, 30).map((cycle, i) => (
                <TimelineEntry
                  key={cycle.wakeTs}
                  cycle={cycle}
                  isFirst={i === cycles.length - 1}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
