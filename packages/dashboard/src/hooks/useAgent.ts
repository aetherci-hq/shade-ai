import { useMemo } from 'react';
import type { SocketEvent } from './useSocket';

export interface AgentState {
  isRunning: boolean;
  heartbeat: {
    enabled: boolean;
    nextWake: number;
    lastDecision: string;
    lastReason: string;
  };
  totalTokens: { input: number; output: number };
  toolCalls: number;
}

export function useAgent(events: SocketEvent[]): AgentState {
  return useMemo(() => {
    let isRunning = false;
    let hbEnabled = true;
    let hbNextWake = 0;
    let hbLastDecision = '';
    let hbLastReason = '';
    let totalInput = 0;
    let totalOutput = 0;
    let toolCalls = 0;

    // Process events in reverse (oldest first) to build current state
    const reversed = [...events].reverse();
    for (const evt of reversed) {
      switch (evt.type) {
        case 'connected':
          hbEnabled = evt.data['heartbeatEnabled'] as boolean ?? true;
          hbNextWake = evt.data['heartbeatNextWake'] as number ?? 0;
          isRunning = evt.data['agentRunning'] as boolean ?? false;
          break;
        case 'agent:thinking':
          isRunning = true;
          break;
        case 'agent:response':
        case 'agent:error':
          isRunning = false;
          break;
        case 'agent:tool_call':
          toolCalls++;
          break;
        case 'heartbeat:sleep':
          hbNextWake = evt.data['nextWake'] as number ?? 0;
          break;
        case 'heartbeat:decision':
          hbLastDecision = evt.data['action'] as string ?? '';
          hbLastReason = evt.data['reason'] as string ?? '';
          break;
        case 'stats:usage':
          totalInput += evt.data['inputTokens'] as number ?? 0;
          totalOutput += evt.data['outputTokens'] as number ?? 0;
          break;
      }
    }

    return {
      isRunning,
      heartbeat: { enabled: hbEnabled, nextWake: hbNextWake, lastDecision: hbLastDecision, lastReason: hbLastReason },
      totalTokens: { input: totalInput, output: totalOutput },
      toolCalls,
    };
  }, [events]);
}
