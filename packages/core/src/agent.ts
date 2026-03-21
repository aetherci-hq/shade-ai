import { query } from '@anthropic-ai/claude-agent-sdk';
import { eventBus } from './events.js';
import { readMemory, appendActivity } from './memory.js';
import { getConfig } from './config.js';

export class Agent {
  private running = false;
  private sessionId?: string;
  private abortController?: AbortController;
  private static MAX_CONTINUATIONS = 3;

  isRunning(): boolean {
    return this.running;
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  async run(input: string, conversationId?: string): Promise<string> {
    const config = getConfig();
    const convId = conversationId ?? 'default';
    this.running = true;
    this.abortController = new AbortController();

    const soul = readMemory('SOUL');

    try {
      return await this.executeQuery(input, convId, soul, config, false);
    } finally {
      this.running = false;
    }
  }

  abort(): void {
    this.abortController?.abort();
  }

  private async executeQuery(
    input: string,
    conversationId: string,
    systemPrompt: string,
    config: ReturnType<typeof getConfig>,
    isContinuation: boolean,
    continuationCount = 0,
  ): Promise<string> {
    const q = query({
      prompt: isContinuation ? 'Continue where you left off. Complete the task.' : input,
      options: {
        systemPrompt,
        allowedTools: config.tools.allowed,
        disallowedTools: config.tools.disallowed,
        permissionMode: config.agent.permissionMode === 'bypassPermissions'
          ? 'bypassPermissions' : config.agent.permissionMode,
        allowDangerouslySkipPermissions: config.agent.permissionMode === 'bypassPermissions',
        maxTurns: config.agent.maxTurns,
        maxBudgetUsd: config.agent.maxBudgetUsd,
        includePartialMessages: true,
        abortController: this.abortController,
        resume: this.sessionId,
        continue: isContinuation,
        model: config.llm.model,
        agents: config.agent.subagents ? Object.fromEntries(
          Object.entries(config.agent.subagents).map(([name, def]) => [name, {
            description: def.description,
            prompt: def.prompt,
            tools: def.tools,
            model: def.model,
            maxTurns: def.maxTurns,
          }])
        ) : undefined,
      },
    });

    let result = '';
    let lastToolName = '';

    try {
      for await (const message of q) {
        switch (message.type) {
          case 'system':
            if (message.subtype === 'init') {
              this.sessionId = message.session_id;
              eventBus.emit('session:init', {
                sessionId: message.session_id,
                tools: message.tools,
                model: message.model,
              });
              eventBus.emit('agent:thinking', { conversationId });
            }
            if (message.subtype === 'task_started') {
              const m = message as { task_id: string; description: string };
              eventBus.emit('agent:subagent', {
                conversationId,
                agentId: m.task_id,
                description: m.description,
                status: 'started',
              });
            }
            if (message.subtype === 'task_notification') {
              const m = message as { task_id: string; summary: string };
              eventBus.emit('agent:subagent', {
                conversationId,
                agentId: m.task_id,
                description: m.summary,
                status: 'completed',
              });
            }
            break;

          case 'stream_event': {
            const evt = message.event;
            if (evt.type === 'content_block_delta') {
              const delta = evt.delta as { type: string; text?: string };
              if (delta.type === 'text_delta' && delta.text) {
                eventBus.emit('agent:text_delta', {
                  conversationId,
                  delta: delta.text,
                });
              }
            }
            if (evt.type === 'content_block_start') {
              const block = (evt as { content_block?: { type: string; name?: string } }).content_block;
              if (block?.type === 'tool_use' && block.name) {
                lastToolName = block.name;
              }
            }
            break;
          }

          case 'assistant': {
            // Full assistant message — extract tool calls for the activity log
            for (const block of message.message.content) {
              if (block.type === 'tool_use') {
                const input = block.input as Record<string, unknown>;
                eventBus.emit('agent:tool_call', {
                  conversationId,
                  tool: block.name,
                  input,
                });
                appendActivity({
                  type: 'tool_call',
                  conversationId,
                  tool: block.name,
                  input,
                });
              }
            }
            break;
          }

          case 'user': {
            // Tool results come back as user messages
            if (message.tool_use_result !== undefined) {
              const resultStr = typeof message.tool_use_result === 'string'
                ? message.tool_use_result
                : JSON.stringify(message.tool_use_result).slice(0, 2000);
              eventBus.emit('agent:tool_result', {
                conversationId,
                tool: lastToolName,
                output: resultStr.slice(0, 2000),
              });
              appendActivity({
                type: 'tool_result',
                conversationId,
                tool: lastToolName,
                output: resultStr.slice(0, 500),
              });
            }
            break;
          }

          case 'result': {
            if (message.subtype === 'success') {
              result = message.result;
              const usage = {
                inputTokens: message.usage.input_tokens ?? 0,
                outputTokens: message.usage.output_tokens ?? 0,
              };
              eventBus.emit('agent:response', {
                conversationId,
                text: result,
                usage,
                costUsd: message.total_cost_usd,
                numTurns: message.num_turns,
              });
              eventBus.emit('stats:usage', {
                ...usage,
                costUsd: message.total_cost_usd,
              });
              appendActivity({
                type: 'response',
                conversationId,
                text: result.slice(0, 500),
                usage,
                costUsd: message.total_cost_usd,
              });
            } else if (message.subtype === 'error_max_turns' && continuationCount < Agent.MAX_CONTINUATIONS) {
              // Auto-continue: resume the session where it left off
              eventBus.emit('agent:thinking', { conversationId });
              appendActivity({ type: 'continuation', conversationId, attempt: continuationCount + 1 });
              return await this.executeQuery(input, conversationId, systemPrompt, config, true, continuationCount + 1);
            } else {
              const errors = (message as { errors?: string[] }).errors;
              const errorMsg = errors?.join(', ') || message.subtype;
              eventBus.emit('agent:error', { conversationId, error: errorMsg });
              appendActivity({ type: 'error', conversationId, error: errorMsg });
            }
            break;
          }

          case 'tool_use_summary': {
            // Could display in dashboard — for now just log
            break;
          }
        }
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      eventBus.emit('agent:error', { conversationId, error: errorMsg });
      appendActivity({ type: 'error', conversationId, error: errorMsg });
    }

    return result;
  }
}
