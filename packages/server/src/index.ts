import { resolve } from 'path';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { loadConfig, getConfig, Agent, HeartbeatDaemon, setMemoryStore, initUsageTracker, flushUsage, initKeys, eventBus, readMemory, writeMemory, loadUserTools } from '@specter/core';
import { initMemory } from '@specter/memory';
import { createServer } from './http.js';
import { startTranscriptCapture } from './transcripts.js';
import { initVoice } from '@specter/voice';

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

  // 2. Initialize key management
  initKeys(BASE_DIR);

  // 3. Initialize persistent usage tracker
  initUsageTracker();
  console.log(`[specter] Usage tracker initialized (~/.specter/usage.json)`);

  // 3. Initialize persistent memory
  const memoryStore = await initMemory();
  setMemoryStore(memoryStore);
  console.log(`[specter] Memory initialized (auto-capture: ${config.memory.autoCapture})`);

  // 4. Start transcript capture
  startTranscriptCapture();

  // 5. Initialize voice engine
  const voiceEngine = initVoice();
  if (voiceEngine) {
    console.log(`[specter] Voice enabled (ElevenLabs)`);
  }

  // 6. Load custom tools and install runner
  const userTools = loadUserTools();
  if (userTools.length > 0) {
    console.log(`[specter] Custom tools loaded: ${userTools.map(t => t.name).join(', ')}`);
  }
  // Copy tool runner to tools directory so agent can invoke it via Bash
  const toolsDir = config.tools.userDir;
  mkdirSync(toolsDir, { recursive: true });
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const runnerSrc = resolve(__dirname, '../src/tool-runner.ts');
    // Fallback: look in the core package
    const coreSrc = resolve(__dirname, '../../core/src/tool-runner.ts');
    const src = existsSync(runnerSrc) ? runnerSrc : coreSrc;
    if (existsSync(src)) {
      copyFileSync(src, resolve(toolsDir, '_run.ts'));
    }
  } catch { /* runner copy is best-effort */ }

  // 7. Create agent (now wraps Claude Agent SDK)
  const agent = new Agent();

  // 5. Create heartbeat daemon
  const heartbeat = new HeartbeatDaemon(agent);

  // 6. Start HTTP + WebSocket server
  const server = await createServer(agent, heartbeat, config);

  // 7. Start heartbeat
  if (config.heartbeat.enabled) {
    heartbeat.start();
    console.log(`[specter] Heartbeat enabled (every ${config.heartbeat.intervalMinutes}m)`);
  }

  // 8. Hot-reload: apply config changes to running components
  eventBus.on('config:updated', ({ fields, oldName, newName }) => {
    const cfg = getConfig();
    console.log(`[specter] Config updated: ${fields.join(', ')}`);

    // Auto-sync agent name in SOUL.md when config name changes
    if (oldName && newName && oldName !== newName) {
      const soul = readMemory('SOUL');
      const updated = soul.replaceAll(`You are ${oldName}`, `You are ${newName}`);
      if (updated !== soul) {
        writeMemory('SOUL', updated);
        console.log(`[specter] SOUL.md updated: "${oldName}" → "${newName}"`);
      }
    }

    // Hot-reload heartbeat settings
    if (fields.includes('heartbeat')) {
      heartbeat.updateInterval(cfg.heartbeat.intervalMinutes * 60 * 1000);
      heartbeat.toggle(cfg.heartbeat.enabled);
      console.log(`[specter] Heartbeat reloaded (enabled=${cfg.heartbeat.enabled}, interval=${cfg.heartbeat.intervalMinutes}m)`);
    }
  });

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
    } else if (event !== 'stats:usage' && event !== 'agent:text_delta' && event !== 'voice:audio' && event !== 'voice:done') {
      console.log(`[specter] ${event}`);
    }
  });

  console.log(`[specter] Alive at http://${config.server.host}:${config.server.port}`);

  const shutdown = () => {
    console.log('\n[specter] Shutting down...');
    flushUsage();
    voiceEngine?.stop();
    heartbeat.stop();
    agent.abort();
    memoryStore.close();
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
