import { useEffect, useRef, useState, useCallback } from 'react';
import { getToken } from '../auth';

export interface SocketEvent {
  type: string;
  ts: number;
  data: Record<string, unknown>;
}

type BinaryHandler = (data: ArrayBuffer) => void;

// Shared binary handler registry — useVoice registers here
const binaryHandlers = new Set<BinaryHandler>();

export function registerBinaryHandler(handler: BinaryHandler): () => void {
  binaryHandlers.add(handler);
  return () => binaryHandlers.delete(handler);
}

export function useSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<SocketEvent[]>([]);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getToken();
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
    const wsUrl = `${protocol}//${window.location.host}/ws${tokenParam}`;
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onmessage = (e) => {
        // Binary frame — forward to voice handler
        if (e.data instanceof ArrayBuffer) {
          for (const handler of binaryHandlers) {
            handler(e.data);
          }
          return;
        }

        try {
          const event = JSON.parse(e.data) as SocketEvent;
          setEvents(prev => [event, ...prev].slice(0, 500));

          // Forward voice:done to binary handlers as a signal
          if (event.type === 'voice:done') {
            for (const handler of binaryHandlers) {
              handler(new ArrayBuffer(0)); // zero-length = end signal
            }
          }
        } catch {}
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  const send = useCallback((type: string, data?: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }));
    }
  }, []);

  return { connected, events, send };
}
