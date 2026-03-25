import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { Agent, HeartbeatDaemon, ClientMeta } from '@shade/core';
import { eventBus, readMemory, writeMemory, getConfig } from '@shade/core';
import { recordUserMessage } from './transcripts.js';
import crypto from 'crypto';

const clients = new Map<WebSocket, ClientMeta>();

const LOCAL_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLocal(ip: string): boolean {
  return LOCAL_IPS.has(ip);
}

/** Get all remote (non-localhost) connected clients */
export function getRemoteClients(): ClientMeta[] {
  const remote: ClientMeta[] = [];
  for (const meta of clients.values()) {
    if (!isLocal(meta.ip)) {
      remote.push(meta);
    }
  }
  return remote;
}

/** Disconnect a single remote client by id */
export function disconnectClient(id: string): boolean {
  for (const [ws, meta] of clients.entries()) {
    if (meta.id === id) {
      ws.close(1000, 'Disconnected by admin');
      return true;
    }
  }
  return false;
}

/** Disconnect all remote clients */
export function disconnectAllRemote(): number {
  let count = 0;
  for (const [ws, meta] of clients.entries()) {
    if (!isLocal(meta.ip)) {
      ws.close(1000, 'Kill switch activated');
      count++;
    }
  }
  return count;
}

export function setupWebSocket(app: FastifyInstance, agent: Agent, heartbeat: HeartbeatDaemon) {
  // Broadcast all core events to connected clients
  eventBus.onAny((event, data) => {
    // Voice audio chunks sent as binary frames (handled separately)
    if (event === 'voice:audio') {
      const chunk = (data as { chunk: Buffer }).chunk;
      for (const ws of clients.keys()) {
        if (ws.readyState === 1) {
          ws.send(chunk, { binary: true });
        }
      }
      return;
    }

    const message = JSON.stringify({ type: event, ts: Date.now(), data });
    for (const ws of clients.keys()) {
      if (ws.readyState === 1) { // OPEN
        ws.send(message);
      }
    }
  });

  app.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, (socket, req) => {
      const ws = socket as unknown as WebSocket;
      const ip = req.ip;
      const userAgent = req.headers['user-agent'] ?? '';
      const id = crypto.randomUUID().slice(0, 8);

      const meta: ClientMeta = { id, ip, connectedAt: Date.now(), userAgent };
      clients.set(ws, meta);

      // Emit access event for remote connections
      if (!isLocal(ip)) {
        eventBus.emit('access:client_connected', { id, ip, connectedAt: meta.connectedAt });
      }

      // Send initial state
      ws.send(JSON.stringify({
        type: 'connected',
        ts: Date.now(),
        data: {
          heartbeatEnabled: heartbeat.enabled,
          heartbeatNextWake: heartbeat.nextWake,
          heartbeatLastState: heartbeat.lastState,
          agentRunning: agent.isRunning(),
          sessionId: agent.getSessionId(),
        },
      }));

      ws.on('message', async (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());
          await handleClientMessage(msg, agent, heartbeat);
        } catch (err) {
          ws.send(JSON.stringify({
            type: 'error',
            ts: Date.now(),
            data: { error: err instanceof Error ? err.message : String(err) },
          }));
        }
      });

      ws.on('close', () => {
        const closedMeta = clients.get(ws);
        clients.delete(ws);
        if (closedMeta && !isLocal(closedMeta.ip)) {
          eventBus.emit('access:client_disconnected', { id: closedMeta.id, ip: closedMeta.ip, reason: 'closed' });
        }
      });
    });
  });
}

async function handleClientMessage(
  msg: { type: string; data?: Record<string, unknown> },
  agent: Agent,
  heartbeat: HeartbeatDaemon,
) {
  switch (msg.type) {
    case 'chat:send': {
      const message = msg.data?.['message'] as string;
      const conversationId = msg.data?.['conversationId'] as string | undefined;
      const voiceMode = msg.data?.['voiceMode'] as boolean | undefined;
      const model = msg.data?.['model'] as string | undefined;
      if (message) {
        // Persist user message to transcript
        const convId = conversationId ?? `chat-${Date.now()}`;
        recordUserMessage(convId, message);
        // Broadcast user message to ALL clients (so other devices see it)
        const userMsg = JSON.stringify({
          type: 'chat:user_message',
          ts: Date.now(),
          data: { message, conversationId: convId },
        });
        for (const c of clients.keys()) {
          if (c.readyState === 1) c.send(userMsg);
        }
        // Run async — events will stream to client via broadcast
        agent.run(message, convId, { voiceMode: voiceMode ?? false, model }).catch((err) => {
          eventBus.emit('agent:error', {
            conversationId: convId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
      break;
    }
    case 'heartbeat:trigger':
      heartbeat.triggerNow().catch((err) => {
        eventBus.emit('agent:error', {
          conversationId: 'heartbeat',
          error: err instanceof Error ? err.message : String(err),
        });
      });
      break;
    case 'heartbeat:toggle':
      heartbeat.toggle(msg.data?.['enabled'] as boolean);
      break;
    case 'memory:read': {
      const file = (msg.data?.['file'] as string)?.toUpperCase() as 'MEMORY' | 'HEARTBEAT' | 'SOUL' | 'HUMAN';
      const content = readMemory(file);
      // Broadcast back as a specific event
      const response = JSON.stringify({
        type: 'memory:content',
        ts: Date.now(),
        data: { file, content },
      });
      // Send to all clients (simplification — in production, track per-client)
      for (const ws of clients.keys()) {
        if (ws.readyState === 1) ws.send(response);
      }
      break;
    }
    case 'memory:write': {
      const file = (msg.data?.['file'] as string)?.toUpperCase() as 'MEMORY' | 'HEARTBEAT' | 'SOUL' | 'HUMAN';
      const content = msg.data?.['content'] as string;
      if (file && content !== undefined) {
        writeMemory(file, content);
      }
      break;
    }
  }
}
