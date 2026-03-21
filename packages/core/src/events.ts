import { EventEmitter } from 'events';

export interface SpecterEvents {
  'agent:thinking': { conversationId: string };
  'agent:text_delta': { conversationId: string; delta: string };
  'agent:tool_call': { conversationId: string; tool: string; input: Record<string, unknown> };
  'agent:tool_result': { conversationId: string; tool: string; output: string; durationMs?: number; error?: boolean };
  'agent:response': { conversationId: string; text: string; usage: { inputTokens: number; outputTokens: number }; costUsd?: number; numTurns?: number };
  'agent:error': { conversationId: string; error: string };
  'agent:subagent': { conversationId: string; agentId: string; description: string; status: 'started' | 'progress' | 'completed' };
  'heartbeat:wake': { timestamp: number };
  'heartbeat:decision': { action: string; reason: string };
  'heartbeat:sleep': { nextWake: number };
  'memory:updated': { file: string };
  'guardrail:flag': { reason: string; detail: string };
  'stats:usage': { inputTokens: number; outputTokens: number; costUsd?: number };
  'session:init': { sessionId: string; tools: string[]; model: string };
}

type EventName = keyof SpecterEvents;

class SpecterEventBus {
  private emitter = new EventEmitter();

  on<E extends EventName>(event: E, listener: (data: SpecterEvents[E]) => void): void {
    this.emitter.on(event, listener);
  }

  off<E extends EventName>(event: E, listener: (data: SpecterEvents[E]) => void): void {
    this.emitter.off(event, listener);
  }

  emit<E extends EventName>(event: E, data: SpecterEvents[E]): void {
    this.emitter.emit(event, data);
  }

  onAny(listener: (event: string, data: unknown) => void): void {
    const originalEmit = this.emitter.emit.bind(this.emitter);
    this.emitter.emit = (event: string | symbol, ...args: unknown[]) => {
      if (typeof event === 'string') {
        listener(event, args[0]);
      }
      return originalEmit(event, ...args);
    };
  }
}

export const eventBus = new SpecterEventBus();
