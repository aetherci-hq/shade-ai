interface LogLineProps {
  ts: number;
  type: string;
  message: string;
}

const TAG_COLORS: Record<string, string> = {
  'agent:thinking': 'text-c-dim',
  'agent:tool_call': 'text-c-cyan',
  'agent:tool_result': 'text-c-cyan',
  'agent:response': 'text-c-accent',
  'agent:error': 'text-c-red',
  'heartbeat:wake': 'text-c-amber',
  'heartbeat:decision': 'text-c-amber',
  'heartbeat:sleep': 'text-c-dim',
  'guardrail:flag': 'text-c-red',
  'stats:usage': 'text-c-dim',
  'memory:updated': 'text-c-purple',
  'connected': 'text-c-green',
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
}

function shortType(type: string): string {
  return type.split(':').pop() ?? type;
}

export function LogLine({ ts, type, message }: LogLineProps) {
  const color = TAG_COLORS[type] ?? 'text-c-dim';
  return (
    <div className="flex gap-2 py-px animate-fade-in">
      <span className="text-c-muted shrink-0 text-[10px]">{formatTime(ts)}</span>
      <span className={`font-medium shrink-0 min-w-[56px] uppercase text-[9px] tracking-[0.05em] ${color}`}>
        {shortType(type)}
      </span>
      <span className="text-c-dim truncate">{message}</span>
    </div>
  );
}
