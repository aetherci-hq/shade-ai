import { Panel } from '../components/Panel';
import type { AgentState } from '../hooks/useAgent';

interface Props {
  agent: AgentState;
  connected: boolean;
  startTime: number;
}

function formatUptime(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

function estimateCost(input: number, output: number): string {
  // Rough Claude Sonnet pricing: $3/M input, $15/M output
  const cost = (input * 3 + output * 15) / 1_000_000;
  return cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`;
}

export function StatsPanel({ agent, connected, startTime }: Props) {
  const uptime = Date.now() - startTime;

  const metrics = [
    { label: 'Status', value: connected ? (agent.isRunning ? 'Working' : 'Alive') : 'Disconnected', color: connected ? 'text-c-green' : 'text-c-red' },
    { label: 'Uptime', value: formatUptime(uptime), color: 'text-c-text' },
    { label: 'Input Tokens', value: agent.totalTokens.input.toLocaleString(), color: 'text-c-cyan' },
    { label: 'Output Tokens', value: agent.totalTokens.output.toLocaleString(), color: 'text-c-cyan' },
    { label: 'Est. Cost', value: estimateCost(agent.totalTokens.input, agent.totalTokens.output), color: 'text-c-amber' },
    { label: 'Tool Calls', value: String(agent.toolCalls), color: 'text-c-amber' },
    { label: 'Heartbeat', value: agent.heartbeat.enabled ? 'Enabled' : 'Disabled', color: agent.heartbeat.enabled ? 'text-c-green' : 'text-c-muted' },
  ];

  return (
    <Panel title="System Stats" className="h-full">
      <div className="space-y-1.5">
        {metrics.map(m => (
          <div key={m.label} className="flex justify-between items-baseline text-xs">
            <span className="text-c-muted text-[11px] uppercase tracking-[0.05em]">{m.label}</span>
            <span className={`font-medium ${m.color}`}>{m.value}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
