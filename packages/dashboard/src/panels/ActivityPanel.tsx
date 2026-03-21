import { Panel } from '../components/Panel';
import { LogLine } from '../components/LogLine';
import type { SocketEvent } from '../hooks/useSocket';

interface Props {
  events: SocketEvent[];
}

function eventToMessage(evt: SocketEvent): string {
  const d = evt.data;
  switch (evt.type) {
    case 'connected': return 'Dashboard connected';
    case 'agent:thinking': return `Processing conversation ${(d['conversationId'] as string)?.slice(0, 8)}...`;
    case 'agent:tool_call': return `${d['tool']}(${JSON.stringify(d['input']).slice(0, 80)})`;
    case 'agent:tool_result': {
      const dur = d['durationMs'] as number;
      const err = d['error'] as boolean;
      return `${d['tool']} ${err ? 'FAILED' : 'OK'} (${dur}ms): ${(d['output'] as string)?.slice(0, 80)}`;
    }
    case 'agent:response': return (d['text'] as string)?.slice(0, 120) ?? '';
    case 'agent:error': return d['error'] as string ?? 'Unknown error';
    case 'heartbeat:wake': return 'Heartbeat triggered';
    case 'heartbeat:decision': return `Decision: ${d['action']} - ${(d['reason'] as string)?.slice(0, 80)}`;
    case 'heartbeat:sleep': return `Next heartbeat at ${new Date(d['nextWake'] as number).toLocaleTimeString('en-US', { hour12: false })}`;
    case 'memory:updated': return `${d['file']} updated`;
    case 'guardrail:flag': return `${d['reason']}: ${d['detail']}`;
    case 'stats:usage': return `+${d['inputTokens']} in / +${d['outputTokens']} out`;
    default: return JSON.stringify(d).slice(0, 100);
  }
}

export function ActivityPanel({ events }: Props) {
  const visible = events.filter(e => e.type !== 'stats:usage');

  return (
    <Panel
      title="Activity Stream"
      status={
        <span className="text-c-dim font-medium uppercase tracking-wider">
          {visible.length} events
        </span>
      }
      className="h-full"
    >
      {visible.length === 0 ? (
        <div className="text-c-muted text-center py-8">
          No activity yet. Send a message or wait for a heartbeat.
        </div>
      ) : (
        <div className="space-y-0">
          {visible.map((evt, i) => (
            <LogLine key={`${evt.ts}-${i}`} ts={evt.ts} type={evt.type} message={eventToMessage(evt)} />
          ))}
        </div>
      )}
    </Panel>
  );
}
