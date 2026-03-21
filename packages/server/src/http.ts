import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { readdirSync, readFileSync } from 'fs';
import type { Agent, HeartbeatDaemon, SpecterConfig } from '@specter/core';
import { readMemory, writeMemory, readActivity, eventBus, getConfig } from '@specter/core';
import { setupWebSocket } from './ws.js';

export async function createServer(agent: Agent, heartbeat: HeartbeatDaemon, config: SpecterConfig) {
  const app = Fastify({ logger: false });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  // Serve dashboard static files if built
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dashboardDist = resolve(__dirname, '../../dashboard/dist');
  if (existsSync(dashboardDist)) {
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
    const file = req.params.file.toUpperCase() as 'MEMORY' | 'HEARTBEAT' | 'SOUL';
    if (!['MEMORY', 'HEARTBEAT', 'SOUL'].includes(file)) {
      return reply.code(400).send({ error: 'Invalid file' });
    }
    return { file, content: readMemory(file) };
  });

  app.put<{ Params: { file: string }; Body: { content: string } }>('/api/memory/:file', async (req, reply) => {
    const file = req.params.file.toUpperCase() as 'MEMORY' | 'HEARTBEAT' | 'SOUL';
    if (!['MEMORY', 'HEARTBEAT', 'SOUL'].includes(file)) {
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
    return {
      llm: { provider: cfg.llm.provider, model: cfg.llm.model },
      agent: {
        maxTurns: cfg.agent.maxTurns,
        maxBudgetUsd: cfg.agent.maxBudgetUsd,
        permissionMode: cfg.agent.permissionMode,
        subagents: cfg.agent.subagents ? Object.keys(cfg.agent.subagents) : [],
      },
      heartbeat: cfg.heartbeat,
      tools: { allowed: cfg.tools.allowed, disallowed: cfg.tools.disallowed },
    };
  });

  app.get('/api/tools', async () => {
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
    const IGNORE_FILES = new Set(['package.json', 'package-lock.json', 'tsconfig.base.json', 'specter.config.yaml', '.gitignore', 'agent.json']);
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

    return { registered, userTools, workspaceFiles };
  });

  app.get<{ Params: { filename: string } }>('/api/tools/:filename', async (req, reply) => {
    const toolsDir = resolve(config.tools.userDir);
    const filePath = resolve(toolsDir, req.params.filename);
    if (!filePath.startsWith(toolsDir) || !existsSync(filePath)) {
      return reply.code(404).send({ error: 'Tool not found' });
    }
    return { filename: req.params.filename, content: readFileSync(filePath, 'utf-8') };
  });

  app.get<{ Params: { filename: string } }>('/api/workspace/:filename', async (req, reply) => {
    const baseDir = resolve(config.memory.dir);
    const filePath = resolve(baseDir, req.params.filename);
    if (!filePath.startsWith(baseDir) || !existsSync(filePath)) {
      return reply.code(404).send({ error: 'File not found' });
    }
    return { filename: req.params.filename, content: readFileSync(filePath, 'utf-8') };
  });

  await app.listen({ port: config.server.port, host: config.server.host });
  return app;
}
