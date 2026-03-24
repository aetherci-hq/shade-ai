import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Send, Square, ChevronDown, ChevronRight, ArrowDown, MessageSquare, Maximize2, Minimize2, SquarePen, Volume2, VolumeX, Mic } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  ts: number;
}

interface Props {
  messages: ChatMessage[];
  onSend: (message: string, model?: string) => void;
  onNewChat?: () => void;
  isRunning: boolean;
  agentName: string;
  focusMode?: boolean;
  onFocusToggle?: () => void;
  voice?: { muted: boolean; speaking: boolean; toggleMute: () => void };
  onVoiceMode?: () => void;
  models?: { default: string; advanced: string; heartbeat: string };
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function parseToolMessage(content: string): {
  type: 'call' | 'result' | 'subagent' | 'unknown';
  toolName: string;
  summary: string;
  fullContent: string;
  isError: boolean;
} {
  const callMatch = content.match(/^>\s*(\w+)\((.*)$/s);
  if (callMatch) {
    const name = callMatch[1];
    const inputStr = callMatch[2];
    let summary = '';
    try {
      if (name === 'Read' || name === 'Write' || name === 'Edit') {
        const pathMatch = inputStr.match(/"file_path"\s*:\s*"([^"]+)"/);
        summary = pathMatch ? pathMatch[1].split('/').slice(-2).join('/') : inputStr.slice(0, 60);
      } else if (name === 'Bash') {
        const cmdMatch = inputStr.match(/"command"\s*:\s*"([^"]+)"/);
        summary = cmdMatch ? cmdMatch[1].slice(0, 60) : inputStr.slice(0, 60);
      } else if (name === 'Grep') {
        const patMatch = inputStr.match(/"pattern"\s*:\s*"([^"]+)"/);
        summary = patMatch ? `/${patMatch[1]}/` : inputStr.slice(0, 60);
      } else if (name === 'Glob') {
        const patMatch = inputStr.match(/"pattern"\s*:\s*"([^"]+)"/);
        summary = patMatch ? patMatch[1] : inputStr.slice(0, 60);
      } else if (name === 'WebFetch' || name === 'WebSearch') {
        const urlMatch = inputStr.match(/"(?:url|query)"\s*:\s*"([^"]+)"/);
        summary = urlMatch ? urlMatch[1].slice(0, 60) : inputStr.slice(0, 60);
      } else if (name === 'Agent') {
        const descMatch = inputStr.match(/"description"\s*:\s*"([^"]+)"/);
        summary = descMatch ? descMatch[1].slice(0, 60) : inputStr.slice(0, 60);
      } else {
        summary = inputStr.slice(0, 60);
      }
    } catch {
      summary = inputStr.slice(0, 60);
    }
    return { type: 'call', toolName: name, summary, fullContent: inputStr, isError: false };
  }

  const subMatch = content.match(/^\[subagent (\w+)\]\s*(.+)/s);
  if (subMatch) {
    return { type: 'subagent', toolName: subMatch[1], summary: subMatch[2], fullContent: content, isError: false };
  }

  const isError = content.includes('FAIL') || content.includes('Error') || content.includes('BLOCKED');
  return { type: 'result', toolName: '', summary: content.slice(0, 120), fullContent: content, isError };
}

function getToolColor(name: string): string {
  const fileTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
  const shellTools = ['Bash'];
  const webTools = ['WebFetch', 'WebSearch'];
  const agentTools = ['Agent', 'Task'];

  if (fileTools.includes(name)) return 'text-c-cyan';
  if (shellTools.includes(name)) return 'text-c-amber';
  if (webTools.includes(name)) return 'text-c-purple';
  if (agentTools.includes(name)) return 'text-c-accent';
  return 'text-c-dim';
}

// Simple markdown renderer for assistant messages
function renderMarkdown(text: string): JSX.Element[] {
  const lines = text.split('\n');
  const elements: JSX.Element[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <div key={`code-${i}`} className="my-2 bg-c-bg border border-c-border overflow-x-auto">
            <div className="flex items-center justify-between px-3 py-1 border-b border-c-border">
              <span className="text-[10px] text-c-muted uppercase tracking-wider">{codeLang || 'code'}</span>
            </div>
            <pre className="px-3 py-2 text-[12px] text-c-cyan leading-relaxed">{codeLines.join('\n')}</pre>
          </div>
        );
        codeLines = [];
        codeLang = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const h2Match = line.match(/^##\s+(.+)/);
    if (h2Match) {
      elements.push(<div key={i} className="text-c-text font-medium text-[13px] mt-3 mb-1 uppercase tracking-[0.06em]">{h2Match[1]}</div>);
      continue;
    }
    const h3Match = line.match(/^###\s+(.+)/);
    if (h3Match) {
      elements.push(<div key={i} className="text-c-dim font-medium text-[12px] mt-2 mb-0.5">{h3Match[1]}</div>);
      continue;
    }

    if (!line.trim()) {
      elements.push(<div key={i} className="h-1.5" />);
      continue;
    }

    let processed = line;
    processed = processed.replace(/\*\*(.+?)\*\*/g, '<b class="text-c-text font-medium">$1</b>');
    processed = processed.replace(/`([^`]+)`/g, '<code class="text-c-cyan text-[11px] bg-c-surface px-1 py-px border border-c-border">$1</code>');

    if (line.match(/^[-*]\s/)) {
      elements.push(
        <div key={i} className="flex gap-2 py-0.5 pl-1">
          <span className="text-c-accent shrink-0 text-[11px]">-</span>
          <span className="text-c-dim text-[12px]" dangerouslySetInnerHTML={{ __html: processed.replace(/^[-*]\s/, '') }} />
        </div>
      );
      continue;
    }

    const numMatch = line.match(/^(\d+)\.\s(.*)/);
    if (numMatch) {
      elements.push(
        <div key={i} className="flex gap-2 py-0.5 pl-1">
          <span className="text-c-muted shrink-0 text-[11px] w-3 text-right">{numMatch[1]}.</span>
          <span className="text-c-dim text-[12px]" dangerouslySetInnerHTML={{ __html: processed.replace(/^\d+\.\s/, '') }} />
        </div>
      );
      continue;
    }

    elements.push(
      <div key={i} className="text-c-text text-[13px] leading-relaxed py-0.5" dangerouslySetInnerHTML={{ __html: processed }} />
    );
  }

  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      <div key="code-final" className="my-2 bg-c-bg border border-c-border overflow-x-auto">
        <pre className="px-3 py-2 text-[12px] text-c-cyan leading-relaxed">{codeLines.join('\n')}</pre>
      </div>
    );
  }

  return elements;
}

// ─── Thinking Indicator ─────────────────────────────────────────────

function ThinkingIndicator({ agentName }: { agentName: string }) {
  return (
    <div className="animate-fade-in">
      <div className="bg-c-surface/60 border-l-2 border-c-accent/40 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-c-accent">{agentName}</span>
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-4 bg-c-accent/60 animate-[bar-pulse_1s_ease-in-out_infinite]" />
            <span className="w-1.5 h-4 bg-c-accent/60 animate-[bar-pulse_1s_ease-in-out_0.15s_infinite]" />
            <span className="w-1.5 h-4 bg-c-accent/60 animate-[bar-pulse_1s_ease-in-out_0.3s_infinite]" />
          </div>
          <span className="text-[12px] text-c-dim">Thinking...</span>
        </div>
      </div>
    </div>
  );
}

// ─── Working Status (live tool operations) ──────────────────────────

function WorkingStatus({
  toolMessages,
  isActive,
}: {
  toolMessages: ChatMessage[];
  isActive: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  // Parse all tool messages to extract calls
  const operations = useMemo(() => {
    const ops: { toolName: string; summary: string; type: string; isError: boolean; ts: number }[] = [];
    for (const msg of toolMessages) {
      const parsed = parseToolMessage(msg.content);
      if (parsed.type === 'call') {
        ops.push({ toolName: parsed.toolName, summary: parsed.summary, type: 'call', isError: false, ts: msg.ts });
      } else if (parsed.type === 'subagent') {
        ops.push({ toolName: `subagent:${parsed.toolName}`, summary: parsed.summary, type: 'subagent', isError: false, ts: msg.ts });
      } else if (parsed.type === 'result' && parsed.isError) {
        ops.push({ toolName: '', summary: parsed.summary, type: 'error', isError: true, ts: msg.ts });
      }
    }
    return ops;
  }, [toolMessages]);

  const callCount = operations.filter(o => o.type === 'call').length;
  const latestCall = operations.filter(o => o.type === 'call' || o.type === 'subagent').slice(-1)[0];
  const hasErrors = operations.some(o => o.isError);

  if (callCount === 0 && !isActive) return null;

  // Elapsed time
  const elapsed = toolMessages.length > 0
    ? ((toolMessages[toolMessages.length - 1].ts - toolMessages[0].ts) / 1000).toFixed(1)
    : '0';

  return (
    <div className="animate-fade-in ml-4">
      <div className={`border bg-c-surface/40 ${isActive ? 'border-c-accent/20' : 'border-c-border/60'}`}>
        {/* Live status bar */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-c-hover/30 transition-colors group"
        >
          {/* Animated indicator */}
          {isActive ? (
            <div className="flex items-end gap-[2px] w-4 h-4 justify-center shrink-0">
              <span className="w-[3px] bg-c-accent/70 animate-[bar-pulse_0.8s_ease-in-out_infinite]" style={{ height: '40%' }} />
              <span className="w-[3px] bg-c-accent/70 animate-[bar-pulse_0.8s_ease-in-out_0.2s_infinite]" style={{ height: '70%' }} />
              <span className="w-[3px] bg-c-accent/70 animate-[bar-pulse_0.8s_ease-in-out_0.4s_infinite]" style={{ height: '50%' }} />
            </div>
          ) : (
            <div className="w-4 h-4 flex items-center justify-center shrink-0">
              {expanded ? <ChevronDown size={11} className="text-c-muted" /> : <ChevronRight size={11} className="text-c-muted" />}
            </div>
          )}

          {/* Current operation */}
          {latestCall && (
            <>
              <span className={`text-[11px] font-medium uppercase tracking-[0.06em] shrink-0 ${getToolColor(latestCall.toolName)}`}>
                {latestCall.toolName}
              </span>
              <span className="text-c-dim text-[11px] truncate flex-1">
                {latestCall.summary}
              </span>
            </>
          )}

          {/* Meta */}
          <div className="flex items-center gap-2 shrink-0">
            {hasErrors && <span className="text-[10px] text-c-red font-medium">ERR</span>}
            <span className="text-[10px] text-c-muted">
              {callCount} op{callCount !== 1 ? 's' : ''} · {elapsed}s
            </span>
          </div>
        </button>

        {/* Expanded: full operation log */}
        {expanded && (
          <div className="border-t border-c-border/50 px-3 py-2 max-h-48 overflow-y-auto animate-fade-in">
            {operations.filter(o => o.type === 'call' || o.type === 'subagent').map((op, i) => (
              <div key={`${op.ts}-${i}`} className="flex items-center gap-2 py-0.5">
                <span className="text-[9px] text-c-muted shrink-0 w-16">{formatTime(op.ts)}</span>
                <span className={`text-[10px] font-medium shrink-0 ${getToolColor(op.toolName)}`}>
                  {op.toolName}
                </span>
                <span className="text-[10px] text-c-dim truncate">{op.summary}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── User Message ───────────────────────────────────────────────────

function UserMessage({ content, ts }: { content: string; ts: number }) {
  const [showTime, setShowTime] = useState(false);

  return (
    <div
      className="animate-fade-in"
      onMouseEnter={() => setShowTime(true)}
      onMouseLeave={() => setShowTime(false)}
    >
      <div className="bg-c-accent/[0.04] border border-c-accent/15 px-4 py-2.5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-c-accent">You</span>
          <span className={`text-[10px] text-c-muted transition-opacity duration-200 ${showTime ? 'opacity-100' : 'opacity-0'}`}>
            {formatTime(ts)}
          </span>
        </div>
        <div className="text-c-text text-[13px] whitespace-pre-wrap break-words leading-relaxed">{content}</div>
      </div>
    </div>
  );
}

// ─── Assistant Message ──────────────────────────────────────────────

function AssistantMessage({ content, ts, isStreaming, agentName }: { content: string; ts: number; isStreaming: boolean; agentName: string }) {
  const [showTime, setShowTime] = useState(false);
  const rendered = useMemo(() => renderMarkdown(content), [content]);

  return (
    <div
      className="animate-fade-in"
      onMouseEnter={() => setShowTime(true)}
      onMouseLeave={() => setShowTime(false)}
    >
      <div className="bg-c-surface/60 border-l-2 border-c-cyan/30 px-4 py-2.5">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-c-cyan">{agentName}</span>
          {isStreaming && (
            <div className="flex items-end gap-[2px]">
              <span className="w-1 h-2.5 bg-c-accent/60 animate-[bar-pulse_0.8s_ease-in-out_infinite]" />
              <span className="w-1 h-2.5 bg-c-accent/60 animate-[bar-pulse_0.8s_ease-in-out_0.2s_infinite]" />
              <span className="w-1 h-2.5 bg-c-accent/60 animate-[bar-pulse_0.8s_ease-in-out_0.4s_infinite]" />
            </div>
          )}
          <span className={`text-[10px] text-c-muted transition-opacity duration-200 ${showTime ? 'opacity-100' : 'opacity-0'}`}>
            {formatTime(ts)}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          {rendered}
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-c-accent ml-0.5 align-middle animate-blink" />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export function ChatPanel({ messages, onSend, onNewChat, isRunning, agentName, focusMode, onFocusToggle, voice, onVoiceMode, models }: Props) {
  const [input, setInput] = useState('');
  const [useAdvanced, setUseAdvanced] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const stats = useMemo(() => {
    let userCount = 0;
    let assistantCount = 0;
    let toolCount = 0;
    for (const m of messages) {
      if (m.role === 'user') userCount++;
      else if (m.role === 'assistant') assistantCount++;
      else toolCount++;
    }
    return { userCount, assistantCount, toolCount, total: messages.length };
  }, [messages]);

  const lastAssistantIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  }, [messages]);

  // Auto-scroll: always scroll when new messages arrive unless user manually scrolled up
  const userScrolledUp = useRef(false);
  const lastMessageCount = useRef(0); // start at 0 so initial load triggers scroll
  const initialScrollDone = useRef(false);

  // Scroll to bottom on initial load (restored conversation)
  useEffect(() => {
    if (messages.length > 0 && !initialScrollDone.current) {
      initialScrollDone.current = true;
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'instant' });
      });
    }
  }, [messages.length]);

  useEffect(() => {
    // If message count increased, scroll to bottom (unless user explicitly scrolled up)
    if (messages.length > lastMessageCount.current) {
      if (!userScrolledUp.current) {
        requestAnimationFrame(() => {
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        });
      }
    }
    lastMessageCount.current = messages.length;
  }, [messages.length]);

  // Also scroll on streaming content updates (same last message, content changing)
  useEffect(() => {
    if (!userScrolledUp.current && isRunning) {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      });
    }
  }, [messages, isRunning]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // If user scrolls more than 150px from bottom, they've intentionally scrolled up
    userScrolledUp.current = distFromBottom > 150;
    setShowScrollButton(distFromBottom > 150 && messages.length > 3);
  }, [messages.length]);

  const scrollToBottom = useCallback(() => {
    userScrolledUp.current = false;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowScrollButton(false);
  }, []);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = '22px';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    }
  }, [input]);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isRunning) return;
    const model = useAdvanced && models?.advanced ? models.advanced : undefined;
    onSend(input.trim(), model);
    setInput('');
    userScrolledUp.current = false;
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
  }, [input, isRunning, onSend, useAdvanced, models]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  // Group messages: user, assistant, and tool blocks
  const groupedMessages = useMemo(() => {
    const groups: { type: 'user' | 'assistant' | 'tools'; messages: ChatMessage[]; key: string }[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'tool') {
        const last = groups[groups.length - 1];
        if (last && last.type === 'tools') {
          last.messages.push(msg);
        } else {
          groups.push({ type: 'tools', messages: [msg], key: `tools-${msg.ts}-${i}` });
        }
      } else if (msg.role === 'user') {
        groups.push({ type: 'user', messages: [msg], key: `user-${msg.ts}-${i}` });
      } else {
        groups.push({ type: 'assistant', messages: [msg], key: `asst-${msg.ts}-${i}` });
      }
    }
    return groups;
  }, [messages]);

  // Determine if the last group is an active tool block (agent working)
  const lastGroup = groupedMessages[groupedMessages.length - 1];
  const isLastGroupActiveTools = isRunning && lastGroup?.type === 'tools';

  // Show thinking indicator when running but no tool calls or text yet
  const showThinking = isRunning
    && messages.length > 0
    && messages[messages.length - 1].role === 'user';

  return (
    <div className="h-full flex flex-col bg-c-panel overflow-hidden">
      {/* Header — responsive sizing */}
      <div className="flex justify-between items-center px-4 py-2 sm:py-2 border-b border-c-border shrink-0" style={{ minHeight: 44 }}>
        <div className="flex items-center gap-2">
          <MessageSquare size={15} className="text-c-accent" />
          <span className="text-[13px] font-medium tracking-[0.12em] uppercase text-c-text">{agentName}</span>
          {isRunning ? (
            <div className="flex items-center gap-1.5">
              <div className="flex items-end gap-[2px]">
                <span className="w-1 h-2.5 bg-c-amber animate-[bar-pulse_0.8s_ease-in-out_infinite]" />
                <span className="w-1 h-2.5 bg-c-amber animate-[bar-pulse_0.8s_ease-in-out_0.2s_infinite]" />
                <span className="w-1 h-2.5 bg-c-amber animate-[bar-pulse_0.8s_ease-in-out_0.4s_infinite]" />
              </div>
            </div>
          ) : (
            <div className="w-1.5 h-1.5 bg-c-green animate-pulse-live" />
          )}
        </div>
        <div className="flex items-center gap-1">
          {onVoiceMode && (
            <button onClick={onVoiceMode} className="text-c-muted hover:text-c-accent transition-colors p-2">
              <Mic size={18} />
            </button>
          )}
          {voice && (
            <button
              onClick={voice.toggleMute}
              className={`p-2 transition-colors ${voice.speaking ? 'text-c-accent' : voice.muted ? 'text-c-muted/40' : 'text-c-muted hover:text-c-accent'}`}
            >
              {voice.muted ? <VolumeX size={18} /> : <Volume2 size={18} className={voice.speaking ? 'animate-pulse-live' : ''} />}
            </button>
          )}
          {onNewChat && messages.length > 0 && !isRunning && (
            <button onClick={onNewChat} className="text-c-muted hover:text-c-accent transition-colors p-2">
              <SquarePen size={18} />
            </button>
          )}
          {onFocusToggle && (
            <button onClick={onFocusToggle} className="text-c-muted hover:text-c-accent transition-colors p-2">
              {focusMode ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-c-muted text-[13px] mb-2">{agentName.toLowerCase()} ready</div>
            <div className="text-c-dim text-[12px]">Type a command below to begin.</div>
          </div>
        )}

        <div className="space-y-3">
          {groupedMessages.map((group, groupIdx) => {
            if (group.type === 'user') {
              return <UserMessage key={group.key} content={group.messages[0].content} ts={group.messages[0].ts} />;
            }

            if (group.type === 'assistant') {
              const msg = group.messages[0];
              const idx = messages.indexOf(msg);
              const isLast = idx === lastAssistantIndex;
              // Only show streaming cursor if this assistant message is the very last message
              // (no tool calls or other messages after it)
              const isLastMessage = idx === messages.length - 1;
              const isStreaming = isLast && isRunning && isLastMessage;
              return <AssistantMessage key={group.key} content={msg.content} ts={msg.ts} isStreaming={isStreaming} agentName={agentName} />;
            }

            // Tool group — show as compact working status
            const isActiveGroup = isLastGroupActiveTools && groupIdx === groupedMessages.length - 1;
            return (
              <WorkingStatus
                key={group.key}
                toolMessages={group.messages}
                isActive={isActiveGroup}
              />
            );
          })}

          {/* Thinking indicator — shown before any tool calls arrive */}
          {showThinking && <ThinkingIndicator agentName={agentName} />}
        </div>

        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <div className="absolute right-6 bottom-20 z-10">
          <button
            onClick={scrollToBottom}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] bg-c-surface border border-c-border text-c-muted hover:text-c-accent hover:border-c-accent/30 transition-colors uppercase tracking-wider"
            style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}
          >
            <ArrowDown size={11} />
            Latest
          </button>
        </div>
      )}

      {/* Input area — responsive padding and sizing */}
      <div className="px-4 py-3 border-t border-c-border shrink-0" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        {/* Model selector row */}
        {models && (
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setUseAdvanced(false)}
              className={`text-[12px] font-medium uppercase tracking-[0.08em] px-3 py-1 border transition-all ${
                !useAdvanced
                  ? 'text-c-cyan border-c-cyan/30 bg-c-cyan/5'
                  : 'text-c-muted border-c-border hover:text-c-dim hover:border-c-border/80'
              }`}
            >
              {(models.default ?? 'sonnet').replace(/^claude-/, '').replace(/-\d+.*$/, '')}
            </button>
            <button
              onClick={() => setUseAdvanced(true)}
              className={`text-[12px] font-medium uppercase tracking-[0.08em] px-3 py-1 border transition-all ${
                useAdvanced
                  ? 'text-c-amber border-c-amber/30 bg-c-amber/5'
                  : 'text-c-muted border-c-border hover:text-c-dim hover:border-c-border/80'
              }`}
            >
              {(models.advanced ?? 'opus').replace(/^claude-/, '').replace(/-\d+.*$/, '')}
            </button>
          </div>
        )}
        <div className="flex items-end gap-2.5">
          <span className="text-c-accent font-medium text-[14px] shrink-0 pb-1">{agentName.toLowerCase()} {'>'}</span>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRunning ? 'Agent is working...' : 'Type a message...'}
            disabled={isRunning}
            rows={1}
            className="flex-1 bg-transparent border-none outline-none text-c-text font-mono text-[15px] placeholder:text-c-muted disabled:opacity-30 resize-none leading-relaxed"
            style={{ caretColor: 'var(--color-c-accent)', minHeight: 24, maxHeight: 120 }}
            autoFocus
          />
          <div className="flex items-center gap-2 pb-1">
            <button
              onClick={isRunning ? undefined : handleSubmit}
              disabled={isRunning ? false : !input.trim()}
              className={`p-2 transition-all ${
                isRunning
                  ? 'text-c-red hover:text-c-red/80 cursor-pointer'
                  : input.trim()
                    ? 'text-c-accent hover:text-c-accent/80 cursor-pointer'
                    : 'text-c-muted/30 cursor-not-allowed'
              }`}
              title={isRunning ? 'Stop' : 'Send'}
            >
              {isRunning ? <Square size={20} /> : <Send size={20} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
