import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { Agent, HeartbeatDaemon } from '@specter/core';
import { eventBus, readMemory, writeMemory } from '@specter/core';
import { recordUserMessage } from './transcripts.js';

const clients = new Set<WebSocket>();

export function setupWebSocket(app: FastifyInstance, agent: Agent, heartbeat: HeartbeatDaemon) {
  // Broadcast all core events to connected clients
  eventBus.onAny((event, data) => {
    // Voice audio chunks sent as binary frames (handled separately)
    if (event === 'voice:audio') {
      const chunk = (data as { chunk: Buffer }).chunk;
      for (const ws of clients) {
        if (ws.readyState === 1) {
          ws.send(chunk, { binary: true });
        }
      }
      return;
    }

    const message = JSON.stringify({ type: event, ts: Date.now(), data });
    for (const ws of clients) {
      if (ws.readyState === 1) { // OPEN
        ws.send(message);
      }
    }
  });

  app.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, (socket) => {
      const ws = socket as unknown as WebSocket;
      clients.add(ws);

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
        clients.delete(ws);
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
      if (message) {
        // Persist user message to transcript
        if (conversationId) {
          recordUserMessage(conversationId, message);
        }
        // Run async — events will stream to client via broadcast
        agent.run(message, conversationId).catch((err) => {
          eventBus.emit('agent:error', {
            conversationId: conversationId ?? 'unknown',
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
      const file = (msg.data?.['file'] as string)?.toUpperCase() as 'MEMORY' | 'HEARTBEAT' | 'SOUL';
      const content = readMemory(file);
      // Broadcast back as a specific event
      const response = JSON.stringify({
        type: 'memory:content',
        ts: Date.now(),
        data: { file, content },
      });
      // Send to all clients (simplification — in production, track per-client)
      for (const ws of clients) {
        if (ws.readyState === 1) ws.send(response);
      }
      break;
    }
    case 'memory:write': {
      const file = (msg.data?.['file'] as string)?.toUpperCase() as 'MEMORY' | 'HEARTBEAT' | 'SOUL';
      const content = msg.data?.['content'] as string;
      if (file && content !== undefined) {
        writeMemory(file, content);
      }
      break;
    }
  }
}
