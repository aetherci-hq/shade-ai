import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { Shell, type View } from './components/Shell';
import { useSocket } from './hooks/useSocket';
import { useAgent } from './hooks/useAgent';
import { useVoice } from './hooks/useVoice';
import { authFetch } from './auth';
import { Volume2, VolumeX, SquarePen } from 'lucide-react';
import { VoiceMode } from './components/VoiceMode';
import { HomePanel } from './panels/HomePanel';
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

export interface AppConfig {
  name: string;
  llm: { provider: string; model: string };
  models?: { default: string; advanced: string; heartbeat: string };
  agent: {
    maxTurns: number;
    maxBudgetUsd?: number;
    permissionMode: string;
    subagents: Record<string, { description: string; model: string; tools: string[] }>;
  };
  heartbeat: { enabled: boolean; intervalMinutes: number };
  tools: { allowed: string[]; disallowed: string[] };
}

export function App() {
  const { connected, events, send } = useSocket();
  const agent = useAgent(events);
  const voice = useVoice();
  const [view, setView] = useState<View>('home');
  const [memoryContent, setMemoryContent] = useState<Record<string, string>>({});
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState(() => `chat-${Date.now()}`);
  const lastProcessedRef = useRef(0);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);

  // Track streaming assistant message
  const streamingRef = useRef<{ ts: number; content: string } | null>(null);
  // Track last message we sent (to avoid duplicating our own user message from broadcast)
  const lastSentRef = useRef<string>('');

  // Fetch config on mount
  useEffect(() => {
    authFetch('/api/config')
      .then(r => r.json())
      .then(setAppConfig)
      .catch(() => {});
  }, []);

  // Resume last chat conversation on mount
  useEffect(() => {
    if (chatLoaded) return;
    authFetch('/api/conversations?limit=10')
      .then(r => r.json())
      .then((conversations: Array<{ id: string; messageCount: number; lastActivity: number }>) => {
        // Find the most recent non-heartbeat chat conversation
        const lastChat = conversations.find(c => c.id.startsWith('chat-'));
        if (!lastChat) { setChatLoaded(true); return; }

        return authFetch(`/api/conversations/${lastChat.id}`)
          .then(r => r.json())
          .then((data: { id: string; messages: Array<{ role: string; content: string; ts: number; type?: string }> }) => {
            const restored: ChatMessage[] = [];
            for (const msg of data.messages) {
              if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool') {
                restored.push({ role: msg.role, content: msg.content, ts: msg.ts });
              }
            }
            if (restored.length > 0) {
              setChatMessages(restored);
              setConversationId(data.id);
            }
            setChatLoaded(true);
          });
      })
      .catch(() => { setChatLoaded(true); });
  }, [chatLoaded]);

  const agentName = appConfig?.name ?? 'Specter';

  // Build chat messages from events — process new events incrementally
  useEffect(() => {
    if (events.length === 0) return;
    const newEvents = events.slice(0, events.length - lastProcessedRef.current);
    if (newEvents.length === 0) return;
    lastProcessedRef.current = events.length;

    for (const evt of newEvents) {
      // Skip heartbeat events — they clutter the chat window
      const evtConvId = evt.data['conversationId'] as string | undefined;
      if (evtConvId && evtConvId.startsWith('heartbeat')) continue;

      // User message from another device — add it if we didn't send it
      if (evt.type === 'chat:user_message') {
        const msg = evt.data['message'] as string;
        if (msg !== lastSentRef.current) {
          setChatMessages(prev => [...prev, { role: 'user', content: msg, ts: evt.ts }]);
        }
        lastSentRef.current = ''; // clear after check
        continue;
      }

      if (evt.type === 'agent:text_delta') {
        const delta = evt.data['delta'] as string;
        if (!streamingRef.current) {
          streamingRef.current = { ts: evt.ts, content: delta };
          setChatMessages(prev => [...prev, { role: 'assistant', content: delta, ts: evt.ts }]);
        } else {
          streamingRef.current.content += delta;
          const accumulated = streamingRef.current.content;
          const streamTs = streamingRef.current.ts;
          setChatMessages(prev => {
            const updated = [...prev];
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
        // Finalize the streaming message if one exists
        if (streamingRef.current) {
          const text = evt.data['text'] as string;
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
          // No active stream — text was already delivered via deltas before tool calls.
          // Don't create a duplicate message. Just reset state.
          streamingRef.current = null;
        }
      }
      if (evt.type === 'agent:tool_call') {
        // Tool call arrived — pause streaming accumulation but DON'T discard the ref entirely.
        // Mark it as paused so new text_delta events after tools create a fresh message.
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
    for (const file of ['MEMORY', 'HEARTBEAT', 'SOUL', 'HUMAN']) {
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

  const handleNewChat = useCallback(() => {
    setChatMessages([]);
    setConversationId(`chat-${Date.now()}`);
    streamingRef.current = null;
    lastProcessedRef.current = events.length;
  }, [events.length]);

  const handleChatSend = useCallback((message: string, model?: string) => {
    // flushSync ensures the user message is committed to state BEFORE
    // the WebSocket send, preventing race conditions where the agent's
    // response arrives and renders before the user's own message.
    lastSentRef.current = message;
    flushSync(() => {
      setChatMessages(prev => [...prev, { role: 'user', content: message, ts: Date.now() }]);
    });
    send('chat:send', { message, conversationId, model });
  }, [send, conversationId]);

  const handleVoiceSend = useCallback((message: string) => {
    setChatMessages(prev => [...prev, { role: 'user', content: message, ts: Date.now() }]);
    send('chat:send', { message, conversationId, voiceMode: true });
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

  // Mobile detection
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ─── Mobile Layout: full-screen chat with agent ───
  if (isMobile) {
    return (
      <div className="flex flex-col h-screen w-screen bg-c-bg grain">
        <div className="h-px w-full bg-c-accent opacity-30 shrink-0" />
        <div className="flex-1 min-h-0 flex flex-col">
          <ChatPanel
            messages={chatMessages}
            onSend={handleChatSend}
            onNewChat={handleNewChat}
            isRunning={agent.isRunning}
            agentName={agentName}
            voice={voice}
            onVoiceMode={() => setVoiceMode(true)}
            models={appConfig?.models}
          />
        </div>
        {voiceMode && (
          <VoiceMode
            agentName={agentName}
            isRunning={agent.isRunning}
            speaking={voice.speaking}
            muted={voice.muted}
            onToggleMute={voice.toggleMute}
            onSend={handleVoiceSend}
            onClose={() => setVoiceMode(false)}
          />
        )}
      </div>
    );
  }

  // ─── Desktop Layout: full dashboard ───
  return (
    <>
    <Shell
      view={view}
      onViewChange={setView}
      connected={connected}
      agent={agent}
      onHeartbeatTrigger={handleHeartbeatTrigger}
      onHeartbeatToggle={handleHeartbeatToggle}
      startTime={START_TIME}
      agentName={agentName}
      modelName={appConfig?.llm.model ?? 'sonnet'}
      focusMode={focusMode}
      onFocusModeToggle={setFocusMode}
      voice={voice}
      onVoiceMode={() => setVoiceMode(true)}
      focusChatPanel={
        <ChatPanel messages={chatMessages} onSend={handleChatSend} onNewChat={handleNewChat} isRunning={agent.isRunning} agentName={agentName} focusMode={focusMode} onFocusToggle={() => setFocusMode(f => !f)} voice={voice} onVoiceMode={() => setVoiceMode(true)} models={appConfig?.models} />
      }
    >
      {view === 'home' && (
        <HomePanel
          agent={agent}
          connected={connected}
          events={events}
          agentName={agentName}
          startTime={START_TIME}
          appConfig={appConfig}
          onNavigate={setView}
          onChatSend={(msg) => { setView('chat'); handleChatSend(msg); }}
        />
      )}
      {view === 'chat' && <ChatPanel messages={chatMessages} onSend={handleChatSend} onNewChat={handleNewChat} isRunning={agent.isRunning} agentName={agentName} focusMode={focusMode} onFocusToggle={() => setFocusMode(f => !f)} voice={voice} onVoiceMode={() => setVoiceMode(true)} models={appConfig?.models} />}
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
          appConfig={appConfig}
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
    {voiceMode && (
      <VoiceMode
        agentName={agentName}
        isRunning={agent.isRunning}
        speaking={voice.speaking}
        muted={voice.muted}
        onToggleMute={voice.toggleMute}
        onSend={handleVoiceSend}
        onClose={() => setVoiceMode(false)}
      />
    )}
    </>
  );
}
