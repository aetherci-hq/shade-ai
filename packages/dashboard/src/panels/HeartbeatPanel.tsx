import { useState, useEffect, useMemo, useCallback } from 'react';
import { Zap, Play, Pause, ChevronDown, ChevronRight, Clock, Activity, Terminal, Plus, BookTemplate } from 'lucide-react';
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
  date: string;
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

function formatCountdown(nextWake: number): { minutes: number; seconds: number } {
  const diff = Math.max(0, nextWake - Date.now());
  const totalSecs = diff / 1000;
  const minutes = Math.floor(totalSecs / 60);
  const seconds = Math.floor(totalSecs % 60);
  return { minutes, seconds };
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
  const size = 148;
  const stroke = 2;
  const radius = (size - stroke * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(1, Math.max(0, progress)));

  const ringColor = status === 'disabled' ? 'var(--color-c-muted)' :
                    status === 'working' ? 'var(--color-c-amber)' :
                    'var(--color-c-accent)';

  const statusLabel = status.toUpperCase();
  const statusColor = status === 'working' ? 'var(--color-c-amber)' :
                      status === 'waking' ? 'var(--color-c-accent)' :
                      status === 'disabled' ? 'var(--color-c-muted)' :
                      'var(--color-c-dim)';

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        {/* Track */}
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke="var(--color-c-surface)"
          strokeWidth={stroke}
        />
        {/* Tick marks */}
        {Array.from({ length: 60 }, (_, i) => {
          const angle = (i / 60) * 2 * Math.PI - Math.PI / 2;
          const isMajor = i % 5 === 0;
          const innerR = radius - (isMajor ? 7 : 3);
          const outerR = radius - 1;
          return (
            <line
              key={i}
              x1={size / 2 + innerR * Math.cos(angle + Math.PI / 2)}
              y1={size / 2 + innerR * Math.sin(angle + Math.PI / 2)}
              x2={size / 2 + outerR * Math.cos(angle + Math.PI / 2)}
              y2={size / 2 + outerR * Math.sin(angle + Math.PI / 2)}
              stroke={isMajor ? 'var(--color-c-border)' : 'rgba(38,38,44,0.4)'}
              strokeWidth={isMajor ? 1 : 0.5}
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
          strokeLinecap="butt"
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      {/* Center content */}
      <div className="flex flex-col items-center z-10">
        <span className="text-[26px] font-medium tracking-tight" style={{ color: ringColor }}>
          {status === 'disabled' ? '--:--' : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`}
        </span>
        <span className="text-[9px] font-medium uppercase tracking-[0.2em] mt-0.5" style={{ color: statusColor }}>
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
            bg = 'rgba(72, 70, 63, 0.4)';
          } else {
            const alpha = 0.15 + intensity * 0.55;
            bg = `rgba(191, 149, 107, ${alpha})`;
          }

          return (
            <div
              key={day.date}
              className="relative cursor-default"
              style={{
                width: 16,
                height: 16,
                background: bg,
                border: isToday ? '1px solid var(--color-c-accent)' : '1px solid transparent',
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
          <span className="text-c-accent ml-2">{hoveredDay.acted} acted</span>
          {hoveredDay.cost > 0 && <span className="text-c-amber ml-2">${hoveredDay.cost.toFixed(3)}</span>}
        </div>
      )}
      {/* Legend */}
      <div className="flex items-center gap-2 mt-2 text-[9px] text-c-muted">
        <span>less</span>
        <div className="flex gap-[2px]">
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((v, i) => (
            <div key={i} style={{ width: 10, height: 10, background: v === 0 ? 'var(--color-c-surface)' : `rgba(191,149,107,${0.15 + v * 0.55})` }} />
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
      {/* Vertical connector */}
      <div className="flex flex-col items-center shrink-0" style={{ width: 20 }}>
        <div
          className="w-1.5 h-1.5 shrink-0 mt-1"
          style={{
            background: isActed ? 'var(--color-c-accent)' : cycle.decision === 'pending' ? 'var(--color-c-amber)' : 'var(--color-c-muted)',
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
            className="font-medium uppercase tracking-[0.08em] text-[9px] px-1.5 py-px border"
            style={{
              color: isActed ? 'var(--color-c-accent)' : cycle.decision === 'pending' ? 'var(--color-c-amber)' : 'var(--color-c-muted)',
              borderColor: isActed ? 'rgba(191,149,107,0.25)' : cycle.decision === 'pending' ? 'rgba(181,152,92,0.25)' : 'var(--color-c-border)',
              background: isActed ? 'rgba(191,149,107,0.06)' : 'transparent',
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
              className="ml-auto flex items-center gap-1 text-[9px] text-c-muted hover:text-c-accent transition-colors uppercase tracking-wider"
            >
              {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              {cycle.tools.length} tools
            </button>
          )}
        </div>

        {cycle.reason && (
          <div className="text-[10px] text-c-dim mt-1 leading-relaxed truncate">
            {cycle.reason.slice(0, 120)}
          </div>
        )}

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

// ─── Standing Order Templates ───────────────────────────────────────

const TEMPLATES: { name: string; description: string; content: string }[] = [
  {
    name: 'Inbox Triage',
    description: 'Scan for urgent items across inboxes',
    content: '- Quick scan: anything urgent in recent activity? Flag critical items and summarize.',
  },
  {
    name: 'Daily Brief',
    description: 'Morning summary of what matters today',
    content: '- If morning (before 10am): prepare a daily brief — weather, calendar events, pending tasks, anything that needs attention today.',
  },
  {
    name: 'URL Monitor',
    description: 'Check a URL for changes',
    content: '- Monitor URL: [URL_HERE] — fetch it, compare to last known state in MEMORY.md. If changed, note the diff and alert.',
  },
  {
    name: 'Git Repository Check',
    description: 'Check repos for new PRs, issues, or CI failures',
    content: '- Check git repos for new pull requests, open issues, or failed CI runs. Summarize anything that needs attention.',
  },
  {
    name: 'System Health',
    description: 'Check disk, memory, and running processes',
    content: '- Run system health check: disk space, memory usage, CPU load. Flag if anything is above 85% utilization.',
  },
  {
    name: 'Log Watcher',
    description: 'Scan log files for errors or anomalies',
    content: '- Scan log files in [LOG_DIR] for errors, warnings, or anomalies since last check. Summarize findings.',
  },
  {
    name: 'Stale Task Cleanup',
    description: 'Review and clean up old tasks and notes',
    content: '- Review MEMORY.md for stale entries older than 7 days. Archive or remove anything no longer relevant. Keep it clean.',
  },
];

// ─── Standing Orders Card ───────────────────────────────────────────

function StandingOrders({ content, onSave, onLoad }: {
  content: string;
  onSave: (content: string) => void;
  onLoad: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [showTemplates, setShowTemplates] = useState(false);

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

  const handleAddTemplate = (template: typeof TEMPLATES[0]) => {
    const current = content.trim();
    const header = current.includes('# Standing Orders') ? '' : '# Standing Orders\n\n';
    const newContent = current
      ? current + '\n' + template.content
      : header + template.content;
    onSave(newContent);
    setShowTemplates(false);
  };

  if (editing) {
    return (
      <div className="space-y-2">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          className="w-full bg-c-surface border border-c-border text-c-text text-[12px] p-3 outline-none resize-none font-mono leading-relaxed"
          style={{ minHeight: 150, caretColor: 'var(--color-c-accent)' }}
          autoFocus
        />
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            className="text-[11px] px-3 py-1 border border-c-accent text-c-accent uppercase tracking-wider font-medium hover:bg-c-accent/10 transition-colors"
          >
            Save
          </button>
          <button
            onClick={() => { setEditing(false); setDraft(content); }}
            className="text-[11px] px-3 py-1 border border-c-border text-c-muted uppercase tracking-wider hover:text-c-text transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-c-muted flex items-center gap-1.5">
          <Terminal size={11} />
          Standing Orders
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className="text-[10px] text-c-muted hover:text-c-accent transition-colors uppercase tracking-wider border border-c-border px-2 py-0.5 hover:border-c-accent/30 flex items-center gap-1"
          >
            <Plus size={9} /> Template
          </button>
          <button
            onClick={() => setEditing(true)}
            className="text-[10px] text-c-muted hover:text-c-accent transition-colors uppercase tracking-wider border border-c-border px-2 py-0.5 hover:border-c-accent/30"
          >
            Edit
          </button>
        </div>
      </div>

      {/* Template picker */}
      {showTemplates && (
        <div className="mb-3 space-y-1.5 animate-fade-in">
          <div className="text-[11px] text-c-dim mb-2">Add a pre-built standing order:</div>
          {TEMPLATES.map(t => (
            <button
              key={t.name}
              onClick={() => handleAddTemplate(t)}
              className="w-full text-left bg-c-surface border border-c-border p-2.5 hover:border-c-accent/25 transition-colors group"
            >
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-c-text font-medium group-hover:text-c-accent transition-colors">{t.name}</span>
                <Plus size={10} className="text-c-muted group-hover:text-c-accent transition-colors" />
              </div>
              <div className="text-[11px] text-c-dim mt-0.5">{t.description}</div>
            </button>
          ))}
        </div>
      )}

      {orders.length === 0 ? (
        <div className="text-c-muted text-[12px] bg-c-surface border border-c-border p-3">
          No standing orders yet. Add a template above or click Edit to write your own.
        </div>
      ) : (
        <div className="space-y-1.5">
          {orders.map((order, i) => (
            <div key={i} className="flex gap-2 text-[12px] py-0.5">
              <span className="text-c-accent shrink-0">-</span>
              <span className="text-c-dim">{order.replace(/^[-*]\s*/, '')}</span>
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

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { cycles, dayActivity, stats } = useMemo(() => {
    const cycles: HeartbeatCycle[] = [];
    let current: HeartbeatCycle | null = null;
    let totalCost = 0;
    let todayWakes = 0;
    let todayActed = 0;
    const todayKey = dateKey(Date.now());
    const dayMap = new Map<string, DayActivity>();

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
      cycles: [...cycles].reverse(),
      dayActivity: Array.from(dayMap.values()),
      stats: { totalCost, todayWakes, todayActed, totalCycles: cycles.length, streak, streakType },
    };
  }, [events]);

  const isEnabled = agent.heartbeat.enabled;
  const isWorking = agent.isRunning;
  const countdown = formatCountdown(agent.heartbeat.nextWake);

  const intervalMs = 15 * 60 * 1000;
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
        <span className="text-[10px] font-medium tracking-[0.15em] uppercase text-c-dim flex items-center gap-1.5">
          <Activity size={11} className="text-c-accent" />
          Heartbeat Command
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onHeartbeatToggle(!isEnabled)}
            className={`flex items-center gap-1 text-[9px] font-medium uppercase tracking-wider px-2 py-0.5 border transition-all ${
              isEnabled
                ? 'text-c-accent border-c-accent/25 bg-c-accent/5 hover:bg-c-accent/10'
                : 'text-c-muted border-c-border hover:text-c-accent hover:border-c-accent/25'
            }`}
          >
            {isEnabled ? <Pause size={8} /> : <Play size={8} />}
            {isEnabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">

        {/* Command Center: Ring + Stats */}
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-start gap-6">
            <div className="shrink-0">
              <ProgressRing
                progress={progress}
                status={status}
                minutes={countdown.minutes}
                seconds={countdown.seconds}
              />
            </div>

            <div className="flex-1 min-w-0 pt-1">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-4">
                <div>
                  <div className="text-[9px] uppercase tracking-[0.1em] text-c-muted">Today</div>
                  <div className="text-[16px] font-medium text-c-text">{stats.todayWakes}</div>
                  <div className="text-[9px] text-c-dim">wakes</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-[0.1em] text-c-muted">Acted</div>
                  <div className="text-[16px] font-medium text-c-accent">{stats.todayActed}</div>
                  <div className="text-[9px] text-c-dim">of {stats.todayWakes} today</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-[0.1em] text-c-muted">Total Cost</div>
                  <div className="text-[14px] font-medium text-c-amber">${stats.totalCost.toFixed(3)}</div>
                  <div className="text-[9px] text-c-dim">all heartbeats</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-[0.1em] text-c-muted">Streak</div>
                  <div className="text-[14px] font-medium" style={{
                    color: stats.streakType === 'acted' ? 'var(--color-c-accent)' :
                           stats.streakType === 'idle' ? 'var(--color-c-muted)' : 'var(--color-c-dim)'
                  }}>
                    {stats.streak > 0 ? stats.streak : '\u2014'}
                  </div>
                  <div className="text-[9px] text-c-dim">
                    {stats.streakType === 'acted' ? 'productive' : stats.streakType === 'idle' ? 'idle' : '\u2014'}
                  </div>
                </div>
              </div>

              <button
                onClick={onHeartbeatTrigger}
                disabled={isWorking}
                className="flex items-center gap-1.5 text-[10px] px-3 py-1.5 border border-c-accent text-c-accent uppercase tracking-[0.12em] font-medium hover:bg-c-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <Zap size={10} />
                Trigger Now
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-c-border" />

        {/* Activity Heatmap */}
        <div className="px-4 py-3">
          <div className="text-[9px] font-medium uppercase tracking-[0.15em] text-c-muted mb-2.5 flex items-center gap-1.5">
            <Clock size={10} />
            30-Day Activity
          </div>
          <HeatmapGrid days={dayActivity} />
        </div>

        <div className="border-t border-c-border" />

        {/* Standing Orders */}
        <div className="px-4 py-3">
          <StandingOrders
            content={memoryContent['HEARTBEAT'] ?? ''}
            onSave={handleMemorySave}
            onLoad={handleMemoryLoad}
          />
        </div>

        <div className="border-t border-c-border" />

        {/* Timeline */}
        <div className="px-4 py-3">
          <div className="text-[9px] font-medium uppercase tracking-[0.15em] text-c-muted mb-3 flex items-center gap-1.5">
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
