import { useState, useCallback, useEffect, useRef } from 'react';
import { Shell, type View } from './components/Shell';
import { useSocket } from './hooks/useSocket';
import { useAgent } from './hooks/useAgent';
import { ActivityPanel } from './panels/ActivityPanel';
import { ChatPanel } from './panels/ChatPanel';
import { MemoryPanel } from './panels/MemoryPanel';
import { HeartbeatPanel } from './panels/HeartbeatPanel';
import { PersonaPanel } from './panels/PersonaPanel';
import { ToolsPanel } from './panels/ToolsPanel';
import { StatsPanel } from './panels/StatsPanel';
import { ConfigPanel } from './panels/ConfigPanel';

const START_TIME = Date.now();

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  ts: number;
}

export function App() {
  const { connected, events, send } = useSocket();
  const agent = useAgent(events);
  const [view, setView] = useState<View>('activity');
  const [memoryContent, setMemoryContent] = useState<Record<string, string>>({});
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [conversationId] = useState(() => `chat-${Date.now()}`);
  const lastProcessedRef = useRef(0);

  // Track streaming assistant message
  const streamingRef = useRef<{ ts: number; content: string } | null>(null);

  // Build chat messages from events — process new events incrementally
  useEffect(() => {
    if (events.length === 0) return;
    const newEvents = events.slice(0, events.length - lastProcessedRef.current);
    if (newEvents.length === 0) return;
    lastProcessedRef.current = events.length;

    for (const evt of newEvents) {
      if (evt.type === 'agent:text_delta') {
        const delta = evt.data['delta'] as string;
        if (!streamingRef.current) {
          // Start a new streaming message
          streamingRef.current = { ts: evt.ts, content: delta };
          setChatMessages(prev => [...prev, { role: 'assistant', content: delta, ts: evt.ts }]);
        } else {
          // Append to existing streaming message
          streamingRef.current.content += delta;
          const accumulated = streamingRef.current.content;
          const streamTs = streamingRef.current.ts;
          setChatMessages(prev => {
            const updated = [...prev];
            // Find and update the streaming message
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].ts === streamTs && updated[i].role === 'assistant') {
                updated[i] = { ...updated[i], content: accumulated };
                break;
              }
            }
            return updated;
          });
        }
      }
      if (evt.type === 'agent:response') {
        // Finalize: replace streaming message with final content, or add if no streaming happened
        const text = evt.data['text'] as string;
        if (streamingRef.current) {
          const streamTs = streamingRef.current.ts;
          streamingRef.current = null;
          setChatMessages(prev => {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].ts === streamTs && updated[i].role === 'assistant') {
                updated[i] = { ...updated[i], content: text };
                break;
              }
            }
            return updated;
          });
        } else {
          setChatMessages(prev => [...prev, { role: 'assistant', content: text, ts: evt.ts }]);
        }
      }
      if (evt.type === 'agent:tool_call') {
        // Tool call interrupts streaming — reset for next text block
        streamingRef.current = null;
        setChatMessages(prev => [...prev, {
          role: 'tool' as const,
          content: `> ${evt.data['tool']}(${JSON.stringify(evt.data['input']).slice(0, 100)})`,
          ts: evt.ts,
        }]);
      }
      if (evt.type === 'agent:tool_result') {
        const output = (evt.data['output'] as string)?.slice(0, 200);
        setChatMessages(prev => [...prev, { role: 'tool' as const, content: output, ts: evt.ts }]);
      }
      if (evt.type === 'agent:subagent') {
        const status = evt.data['status'] as string;
        const desc = evt.data['description'] as string;
        setChatMessages(prev => [...prev, {
          role: 'tool' as const,
          content: `[subagent ${status}] ${desc}`,
          ts: evt.ts,
        }]);
      }
    }
  }, [events]);

  // Reload all memory files from disk
  const refreshAllMemory = useCallback(() => {
    for (const file of ['MEMORY', 'HEARTBEAT', 'SOUL']) {
      fetch(`/api/memory/${file}`)
        .then(r => r.json())
        .then(data => {
          setMemoryContent(prev => ({ ...prev, [data.file]: data.content }));
        })
        .catch(() => {});
    }
  }, []);

  // Auto-refresh memory when agent finishes a response or updates memory
  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[0];
    if (latest.type === 'agent:response' || latest.type === 'memory:updated') {
      refreshAllMemory();
    }
  }, [events, refreshAllMemory]);

  const handleChatSend = useCallback((message: string) => {
    setChatMessages(prev => [...prev, { role: 'user', content: message, ts: Date.now() }]);
    send('chat:send', { message, conversationId });
  }, [send, conversationId]);

  const handleMemoryLoad = useCallback((file: string) => {
    fetch(`/api/memory/${file}`)
      .then(r => r.json())
      .then(data => {
        setMemoryContent(prev => ({ ...prev, [data.file]: data.content }));
      })
      .catch(() => {});
  }, []);

  const handleMemorySave = useCallback((file: string, content: string) => {
    send('memory:write', { file, content });
    setMemoryContent(prev => ({ ...prev, [file]: content }));
  }, [send]);

  const handleHeartbeatTrigger = useCallback(() => {
    send('heartbeat:trigger');
  }, [send]);

  const handleHeartbeatToggle = useCallback((enabled: boolean) => {
    send('heartbeat:toggle', { enabled });
  }, [send]);

  return (
    <Shell
      view={view}
      onViewChange={setView}
      connected={connected}
      agent={agent}
      onHeartbeatTrigger={handleHeartbeatTrigger}
      onHeartbeatToggle={handleHeartbeatToggle}
    >
      {view === 'activity' && <ActivityPanel events={events} />}
      {view === 'chat' && <ChatPanel messages={chatMessages} onSend={handleChatSend} isRunning={agent.isRunning} />}
      {view === 'heartbeat' && (
        <HeartbeatPanel
          agent={agent}
          events={events}
          onHeartbeatTrigger={handleHeartbeatTrigger}
          onHeartbeatToggle={handleHeartbeatToggle}
          memoryContent={memoryContent}
          onMemorySave={handleMemorySave}
          onMemoryLoad={handleMemoryLoad}
        />
      )}
      {view === 'persona' && (
        <PersonaPanel
          agent={agent}
          connected={connected}
          memoryContent={memoryContent}
          onMemorySave={handleMemorySave}
          onMemoryLoad={handleMemoryLoad}
          startTime={START_TIME}
        />
      )}
      {view === 'memory' && <MemoryPanel onSave={handleMemorySave} onLoad={handleMemoryLoad} memoryContent={memoryContent} />}
      {view === 'tools' && <ToolsPanel events={events} />}
      {view === 'config' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-c-border h-full">
          <ConfigPanel />
          <StatsPanel agent={agent} connected={connected} startTime={START_TIME} />
        </div>
      )}
    </Shell>
  );
}
