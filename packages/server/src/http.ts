import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { readdirSync, readFileSync } from 'fs';
import type { Agent, HeartbeatDaemon, SpecterConfig } from '@shade/core';
import { readMemory, writeMemory, readActivity, readTranscript, listConversations, eventBus, getConfig, updateConfig, getUsageSummary, getKeyStatuses, setKeys, getUserTools, saveToolConfig, getToolConfigValues, loadUserTools } from '@shade/core';
import { getMemoryStore } from '@shade/memory';
import { setupWebSocket, getRemoteClients, disconnectClient, disconnectAllRemote } from './ws.js';

function formatConfigResponse(cfg: SpecterConfig) {
  return {
    name: cfg.name,
    timezone: cfg.timezone,
    llm: { provider: cfg.llm.provider, model: cfg.llm.model },
    models: cfg.models,
    agent: {
      maxTurns: cfg.agent.maxTurns,
      maxBudgetUsd: cfg.agent.maxBudgetUsd,
      permissionMode: cfg.agent.permissionMode,
      subagents: cfg.agent.subagents ? Object.fromEntries(
        Object.entries(cfg.agent.subagents).map(([name, def]) => [name, {
          description: def.description,
          prompt: def.prompt,
          model: def.model,
          tools: def.tools ?? [],
          maxTurns: def.maxTurns,
        }])
      ) : {},
    },
    heartbeat: cfg.heartbeat,
    server: {
      port: cfg.server.port,
      host: cfg.server.host,
      authToken: cfg.server.authToken ? '••••••••' : undefined, // masked
    },
    tools: { allowed: cfg.tools.allowed, disallowed: cfg.tools.disallowed },
    voice: {
      enabled: cfg.voice.enabled,
      provider: cfg.voice.provider,
      voiceId: cfg.voice.voiceId,
      model: cfg.voice.model,
      triggers: cfg.voice.triggers,
      maxCharsPerHour: cfg.voice.maxCharsPerHour,
      maxCostPerDay: cfg.voice.maxCostPerDay,
      // apiKey deliberately omitted — use /api/keys for key management
    },
    memory: {
      autoCapture: cfg.memory.autoCapture,
      maxEntries: cfg.memory.maxEntries,
      contextLimit: cfg.memory.contextLimit,
      embedModel: cfg.memory.embedModel,
    },
  };
}

export async function createServer(agent: Agent, heartbeat: HeartbeatDaemon, config: SpecterConfig) {
  const app = Fastify({ logger: false });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  // Auth middleware — if server.authToken is set, protect /api/* routes from remote access
  const authToken = config.server.authToken;
  if (authToken) {
    app.addHook('onRequest', async (req, reply) => {
      // Skip auth for static files (dashboard), favicon, and the auth check endpoint
      if (!req.url.startsWith('/api/') && !req.url.startsWith('/ws')) return;
      if (req.url === '/api/auth/check') return;

      // Skip auth for localhost connections — auth is for remote access
      const remoteIp = req.ip;
      const isLocal = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
      if (isLocal) return;

      const header = req.headers.authorization;
      const queryToken = (req.query as Record<string, string>)?.token;
      const token = header?.replace('Bearer ', '') ?? queryToken;

      if (token !== authToken) {
        reply.code(401).send({ error: 'Unauthorized' });
      }
    });
    console.log(`[specter] Auth enabled — remote access requires token`);
  }

  // Auth check endpoint — lets the dashboard verify the token
  app.get('/api/auth/check', async (req) => {
    if (!authToken) return { required: false };
    // Localhost doesn't need auth
    const remoteIp = req.ip;
    const isLocal = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
    if (isLocal) return { required: false };
    const header = req.headers.authorization;
    const token = header?.replace('Bearer ', '');
    return { required: true, valid: token === authToken };
  });

  // ─── Remote Access Control ─────────────────────────────────────────
  app.get('/api/access/status', async () => {
    const cfg = getConfig();
    const armed = cfg.server.host === '0.0.0.0';
    return {
      armed,
      host: cfg.server.host,
      port: cfg.server.port,
      authToken: !!cfg.server.authToken,
      clients: getRemoteClients(),
    };
  });

  app.post<{ Params: { id: string } }>('/api/access/disconnect/:id', async (req, reply) => {
    const found = disconnectClient(req.params.id);
    if (!found) return reply.code(404).send({ error: 'Client not found' });
    return { ok: true };
  });

  app.post('/api/access/kill', async () => {
    const count = disconnectAllRemote();
    // Lock down: flip host back to localhost and persist
    updateConfig({ server: { host: '127.0.0.1' } });
    return { ok: true, disconnected: count };
  });

  // Serve dashboard static files — resolve via npm package location
  let dashboardDist = '';
  try {
    const dashboardMain = fileURLToPath(import.meta.resolve('@shade/dashboard'));
    dashboardDist = dirname(dashboardMain);
  } catch {
    // Fallback: monorepo sibling path
    const __dirname = dirname(fileURLToPath(import.meta.url));
    dashboardDist = resolve(__dirname, '../../dashboard/dist');
  }
  if (dashboardDist && existsSync(dashboardDist)) {
    await app.register(fastifyStatic, {
      root: dashboardDist,
      prefix: '/',
    });
  }

  // WebSocket endpoint
  setupWebSocket(app, agent, heartbeat);

  // REST API
  const startTime = Date.now();

  app.get('/api/status', async () => ({
    alive: true,
    uptime: Date.now() - startTime,
    heartbeat: {
      enabled: heartbeat.enabled,
      nextWake: heartbeat.nextWake,
      lastState: heartbeat.lastState,
    },
    agent: {
      running: agent.isRunning(),
    },
  }));

  app.get<{ Params: { file: string } }>('/api/memory/:file', async (req, reply) => {
    const file = req.params.file.toUpperCase() as 'MEMORY' | 'HEARTBEAT' | 'SOUL' | 'HUMAN';
    if (!['MEMORY', 'HEARTBEAT', 'SOUL', 'HUMAN'].includes(file)) {
      return reply.code(400).send({ error: 'Invalid file' });
    }
    return { file, content: readMemory(file) };
  });

  app.put<{ Params: { file: string }; Body: { content: string } }>('/api/memory/:file', async (req, reply) => {
    const file = req.params.file.toUpperCase() as 'MEMORY' | 'HEARTBEAT' | 'SOUL' | 'HUMAN';
    if (!['MEMORY', 'HEARTBEAT', 'SOUL', 'HUMAN'].includes(file)) {
      return reply.code(400).send({ error: 'Invalid file' });
    }
    writeMemory(file, req.body.content);
    return { ok: true };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/activity', async (req) => {
    const limit = parseInt(req.query.limit ?? '100', 10);
    return readActivity(limit);
  });

  app.post<{ Body: { message: string; conversationId?: string } }>('/api/chat', async (req) => {
    const { message, conversationId } = req.body;
    const result = await agent.run(message, conversationId);
    return { response: result };
  });

  app.get('/api/config', async () => {
    const cfg = getConfig();
    return formatConfigResponse(cfg);
  });

  app.put<{ Body: Record<string, unknown> }>('/api/config', async (req) => {
    const partial = req.body;
    // Allow server config changes (persisted to YAML, requires restart to take effect)
    // Unmask authToken — if it's the masked placeholder, remove it so we don't overwrite with dots
    if (partial['server']) {
      const srv = partial['server'] as Record<string, unknown>;
      if (srv['authToken'] === '••••••••' || srv['authToken'] === '') {
        delete srv['authToken'];
      }
    }
    // Protect memory paths but allow feature flags
    if (partial['memory']) {
      const mem = partial['memory'] as Record<string, unknown>;
      delete mem['dir'];
      delete mem['stateDir'];
    }
    // Strip apiKey from voice updates — use /api/keys instead
    if (partial['voice']) {
      const voice = partial['voice'] as Record<string, unknown>;
      delete voice['apiKey'];
    }
    const updated = updateConfig(partial);
    return formatConfigResponse(updated);
  });

  // API key management
  app.get('/api/keys', async () => {
    return getKeyStatuses();
  });

  app.put<{ Body: Record<string, string> }>('/api/keys', async (req) => {
    setKeys(req.body);
    return getKeyStatuses();
  });

  app.get('/api/tools', async () => {
    // Re-scan tools directory on every request so new tools appear immediately
    loadUserTools();

    const cfg = getConfig();
    const registered = cfg.tools.allowed.map(t => ({
      name: t,
      description: `Built-in Claude Agent SDK tool`,
      type: 'builtin' as const,
    }));

    // Scan user tools directory
    const userTools: { name: string; filename: string; content: string }[] = [];
    const toolsDir = resolve(config.tools.userDir);
    if (existsSync(toolsDir)) {
      try {
        const files = readdirSync(toolsDir).filter(f => f.endsWith('.ts') || f.endsWith('.js'));
        for (const file of files) {
          const content = readFileSync(resolve(toolsDir, file), 'utf-8');
          userTools.push({ name: file, filename: file, content });
        }
      } catch {}
    }

    // Scan workspace root for agent-created files (non-config, non-system)
    const IGNORE = new Set(['node_modules', 'dist', 'packages', 'state', 'tools', '.git', '.env', '.env.example']);
    const IGNORE_FILES = new Set(['package.json', 'package-lock.json', 'tsconfig.base.json', 'shade.config.yaml', '.gitignore', 'agent.json']);
    const workspaceFiles: { name: string; size: number }[] = [];
    try {
      const entries = readdirSync(resolve(config.memory.dir), { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORE.has(entry.name) || IGNORE_FILES.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        if (entry.name.endsWith('.md')) continue; // Memory files shown elsewhere
        if (entry.isFile()) {
          const stat = readFileSync(resolve(config.memory.dir, entry.name));
          workspaceFiles.push({ name: entry.name, size: stat.length });
        }
      }
    } catch {}

    // Parsed custom tools (with metadata)
    const customTools = getUserTools();

    return { registered, userTools, workspaceFiles, customTools };
  });

  app.get<{ Params: { filename: string } }>('/api/tools/:filename', async (req, reply) => {
    const toolsDir = resolve(config.tools.userDir);
    const filePath = resolve(toolsDir, req.params.filename);
    if (!filePath.startsWith(toolsDir) || !existsSync(filePath)) {
      return reply.code(404).send({ error: 'Tool not found' });
    }
    return { filename: req.params.filename, content: readFileSync(filePath, 'utf-8') };
  });

  // Tool config — save setup values and reload tools
  app.get<{ Params: { name: string } }>('/api/tools/config/:name', async (req) => {
    return getToolConfigValues(req.params.name);
  });

  app.put<{ Params: { name: string }; Body: Record<string, string> }>('/api/tools/config/:name', async (req) => {
    saveToolConfig(req.params.name, req.body);
    // Reload tools so configured status updates
    loadUserTools();
    return { ok: true };
  });

  app.get<{ Params: { filename: string } }>('/api/workspace/:filename', async (req, reply) => {
    const baseDir = resolve(config.memory.dir);
    const filePath = resolve(baseDir, req.params.filename);
    if (!filePath.startsWith(baseDir) || !existsSync(filePath)) {
      return reply.code(404).send({ error: 'File not found' });
    }
    return { filename: req.params.filename, content: readFileSync(filePath, 'utf-8') };
  });

  // Conversations / transcripts
  app.get<{ Querystring: { limit?: string } }>('/api/conversations', async (req) => {
    const limit = parseInt(req.query.limit ?? '50', 10);
    const conversations = listConversations();
    return conversations.slice(0, limit);
  });

  app.get<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    const transcript = readTranscript(req.params.id);
    if (transcript.length === 0) {
      return reply.code(404).send({ error: 'Conversation not found' });
    }
    return { id: req.params.id, messages: transcript };
  });

  // Persistent usage stats
  app.get('/api/usage', async () => {
    return getUsageSummary();
  });

  // Persistent memory API
  app.get<{ Querystring: { q: string; limit?: string } }>('/api/memories/search', async (req) => {
    const store = getMemoryStore();
    const limit = parseInt(req.query.limit ?? '10', 10);
    const results = await store.search(req.query.q, { limit });
    return results.map(m => ({
      id: m.id,
      content: m.content,
      type: m.type,
      source: m.source,
      tags: m.tags,
      importance: m.importance,
      score: m.score,
      createdAt: m.createdAt,
    }));
  });

  app.get<{ Querystring: { limit?: string } }>('/api/memories', async (req) => {
    const store = getMemoryStore();
    const limit = parseInt(req.query.limit ?? '50', 10);
    const entries = await store.recent(limit);
    return entries.map(m => ({
      id: m.id,
      content: m.content,
      type: m.type,
      source: m.source,
      tags: m.tags,
      importance: m.importance,
      createdAt: m.createdAt,
    }));
  });

  app.get('/api/memories/stats', async () => {
    const store = getMemoryStore();
    return store.stats();
  });

  app.delete<{ Params: { id: string } }>('/api/memories/:id', async (req) => {
    const store = getMemoryStore();
    await store.forget(req.params.id);
    return { ok: true };
  });

  app.post<{ Body: { content: string; tags?: string[]; importance?: number } }>('/api/memories', async (req) => {
    const store = getMemoryStore();
    const id = await store.store({
      content: req.body.content,
      type: 'user',
      source: 'dashboard',
      tags: req.body.tags,
      importance: req.body.importance ?? 0.7,
    });
    return { id };
  });

  await app.listen({ port: config.server.port, host: config.server.host });
  return app;
}
