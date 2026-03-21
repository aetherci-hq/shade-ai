import { resolve } from 'path';
import { loadConfig, Agent, HeartbeatDaemon, eventBus } from '@specter/core';
import { createServer } from './http.js';

const BASE_DIR = resolve(process.cwd());

async function main() {
  // 1. Load config
  const config = loadConfig(BASE_DIR);
  console.log(`[specter] Config loaded from ${BASE_DIR}`);
  console.log(`[specter] Model: ${config.llm.model}`);
  console.log(`[specter] Tools: ${config.tools.allowed.join(', ')}`);
  if (config.agent.maxBudgetUsd) {
    console.log(`[specter] Budget cap: $${config.agent.maxBudgetUsd}`);
  }

  // 2. Create agent (now wraps Claude Agent SDK)
  const agent = new Agent();

  // 3. Create heartbeat daemon
  const heartbeat = new HeartbeatDaemon(agent);

  // 4. Start HTTP + WebSocket server
  const server = await createServer(agent, heartbeat, config);

  // 5. Start heartbeat
  if (config.heartbeat.enabled) {
    heartbeat.start();
    console.log(`[specter] Heartbeat enabled (every ${config.heartbeat.intervalMinutes}m)`);
  }

  // Log events to terminal
  eventBus.onAny((event, data) => {
    const d = data as Record<string, unknown>;
    if (event === 'agent:error') {
      console.error(`[specter] ERROR: ${d['error']}`);
    } else if (event === 'agent:response') {
      const cost = d['costUsd'] as number | undefined;
      const costStr = cost ? ` ($${cost.toFixed(4)})` : '';
      console.log(`[specter] Response${costStr}: ${(d['text'] as string)?.slice(0, 120)}`);
    } else if (event === 'session:init') {
      console.log(`[specter] Session ${d['sessionId']} initialized`);
    } else if (event === 'agent:subagent') {
      console.log(`[specter] Subagent ${d['status']}: ${d['description']}`);
    } else if (event !== 'stats:usage' && event !== 'agent:text_delta') {
      console.log(`[specter] ${event}`);
    }
  });

  console.log(`[specter] Alive at http://${config.server.host}:${config.server.port}`);

  const shutdown = () => {
    console.log('\n[specter] Shutting down...');
    heartbeat.stop();
    agent.abort();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('[specter] Fatal:', err);
  process.exit(1);
});
