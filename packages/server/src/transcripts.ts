import { eventBus, appendTranscript } from '@specter/core';

/**
 * Wire up event listeners that persist chat messages to transcript JSONL files.
 * Each conversation gets its own file at state/transcripts/{conversationId}.jsonl.
 */
export function startTranscriptCapture(): void {
  // User messages come through the WebSocket as chat:send — we capture them
  // via a dedicated function called from ws.ts when a user sends a message.
  // (eventBus doesn't emit user messages, so we handle that separately.)

  eventBus.on('agent:text_delta', () => {
    // Skip deltas — we capture the final response instead
  });

  eventBus.on('agent:response', ({ conversationId, text, usage, costUsd }) => {
    appendTranscript(conversationId, {
      role: 'assistant',
      content: text,
      usage,
      costUsd,
      ts: Date.now(),
    });
  });

  eventBus.on('agent:tool_call', ({ conversationId, tool, input }) => {
    appendTranscript(conversationId, {
      role: 'tool',
      type: 'call',
      tool,
      content: `> ${tool}(${JSON.stringify(input).slice(0, 500)})`,
      ts: Date.now(),
    });
  });

  eventBus.on('agent:tool_result', ({ conversationId, tool, output }) => {
    appendTranscript(conversationId, {
      role: 'tool',
      type: 'result',
      tool,
      content: output.slice(0, 2000),
      ts: Date.now(),
    });
  });

  eventBus.on('agent:subagent', ({ conversationId, agentId, description, status }) => {
    appendTranscript(conversationId, {
      role: 'tool',
      type: 'subagent',
      content: `[subagent ${status}] ${description}`,
      ts: Date.now(),
    });
  });

  eventBus.on('agent:error', ({ conversationId, error }) => {
    appendTranscript(conversationId, {
      role: 'system',
      content: `Error: ${error}`,
      ts: Date.now(),
    });
  });
}

/**
 * Record a user message to the transcript. Called from ws.ts when
 * a chat:send message is received, since user messages don't go
 * through the event bus.
 */
export function recordUserMessage(conversationId: string, message: string): void {
  appendTranscript(conversationId, {
    role: 'user',
    content: message,
    ts: Date.now(),
  });
}
