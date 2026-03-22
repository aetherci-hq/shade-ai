import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Send, Square, ChevronDown, ChevronRight, ArrowDown, MessageSquare } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  ts: number;
}

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  isRunning: boolean;
  agentName: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Classify tool messages
function parseToolMessage(content: string): {
  type: 'call' | 'result' | 'subagent' | 'unknown';
  toolName: string;
  summary: string;
  fullContent: string;
  isError: boolean;
} {
  // Tool call: "> ToolName({...})"
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

  // Subagent: "[subagent started/completed] ..."
  const subMatch = content.match(/^\[subagent (\w+)\]\s*(.+)/s);
  if (subMatch) {
    return { type: 'subagent', toolName: subMatch[1], summary: subMatch[2], fullContent: content, isError: false };
  }

  // Tool result: everything else in 'tool' role
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

function getToolBorderColor(name: string): string {
  const fileTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
  const shellTools = ['Bash'];
  const webTools = ['WebFetch', 'WebSearch'];
  const agentTools = ['Agent', 'Task'];

  if (fileTools.includes(name)) return 'border-c-cyan/15';
  if (shellTools.includes(name)) return 'border-c-amber/15';
  if (webTools.includes(name)) return 'border-c-purple/15';
  if (agentTools.includes(name)) return 'border-c-accent/15';
  return 'border-c-border';
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

    // Code block toggle
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <div key={`code-${i}`} className="my-1.5 bg-c-bg border border-c-border overflow-x-auto">
            <div className="flex items-center justify-between px-2 py-0.5 border-b border-c-border">
              <span className="text-[9px] text-c-muted uppercase tracking-wider">{codeLang || 'code'}</span>
            </div>
            <pre className="px-2 py-1.5 text-[11px] text-c-cyan leading-relaxed">{codeLines.join('\n')}</pre>
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

    // Headers
    const h2Match = line.match(/^##\s+(.+)/);
    if (h2Match) {
      elements.push(<div key={i} className="text-c-text font-medium text-[12px] mt-2 mb-0.5 uppercase tracking-[0.06em]">{h2Match[1]}</div>);
      continue;
    }
    const h3Match = line.match(/^###\s+(.+)/);
    if (h3Match) {
      elements.push(<div key={i} className="text-c-dim font-medium text-[11px] mt-1.5 mb-0.5">{h3Match[1]}</div>);
      continue;
    }

    // Empty line
    if (!line.trim()) {
      elements.push(<div key={i} className="h-1" />);
      continue;
    }

    // Process inline formatting
    let processed = line;
    processed = processed.replace(/\*\*(.+?)\*\*/g, '<b class="text-c-text font-medium">$1</b>');
    processed = processed.replace(/`([^`]+)`/g, '<code class="text-c-cyan text-[10px] bg-c-surface px-1 py-px border border-c-border">$1</code>');

    // List items
    if (line.match(/^[-*]\s/)) {
      elements.push(
        <div key={i} className="flex gap-1.5 py-px pl-1">
          <span className="text-c-accent shrink-0 text-[10px]">-</span>
          <span className="text-c-dim text-[11px]" dangerouslySetInnerHTML={{ __html: processed.replace(/^[-*]\s/, '') }} />
        </div>
      );
      continue;
    }

    // Numbered items
    const numMatch = line.match(/^(\d+)\.\s(.*)/);
    if (numMatch) {
      elements.push(
        <div key={i} className="flex gap-1.5 py-px pl-1">
          <span className="text-c-muted shrink-0 text-[10px] w-3 text-right">{numMatch[1]}.</span>
          <span className="text-c-dim text-[11px]" dangerouslySetInnerHTML={{ __html: processed.replace(/^\d+\.\s/, '') }} />
        </div>
      );
      continue;
    }

    // Regular paragraph
    elements.push(
      <div key={i} className="text-c-text text-[12px] leading-relaxed py-px" dangerouslySetInnerHTML={{ __html: processed }} />
    );
  }

  // Close unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      <div key="code-final" className="my-1.5 bg-c-bg border border-c-border overflow-x-auto">
        <pre className="px-2 py-1.5 text-[11px] text-c-cyan leading-relaxed">{codeLines.join('\n')}</pre>
      </div>
    );
  }

  return elements;
}

// ─── Tool Call Card ─────────────────────────────────────────────────

function ToolCallCard({ content, ts }: { content: string; ts: number }) {
  const [expanded, setExpanded] = useState(false);
  const parsed = parseToolMessage(content);

  if (parsed.type === 'subagent') {
    return (
      <div className="flex items-center gap-2 py-1 pl-3 border-l border-c-purple/30 animate-fade-in">
        <span className="text-[9px] font-medium uppercase tracking-[0.08em] px-1.5 py-px border border-c-purple/20 text-c-purple">
          {parsed.toolName}
        </span>
        <span className="text-c-dim text-[10px] truncate">{parsed.summary}</span>
      </div>
    );
  }

  if (parsed.type === 'result') {
    return (
      <div className="pl-6 py-0.5 animate-fade-in">
        <div className={`text-[10px] leading-relaxed truncate ${parsed.isError ? 'text-c-red' : 'text-c-dim'}`}>
          {parsed.isError && <span className="text-c-red font-medium mr-1">ERR</span>}
          {parsed.summary}
        </div>
      </div>
    );
  }

  // Tool call card
  const color = getToolColor(parsed.toolName);
  const borderColor = getToolBorderColor(parsed.toolName);

  return (
    <div className={`border ${borderColor} bg-c-surface/50 animate-fade-in`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-c-hover/50 transition-colors group"
      >
        {expanded ? <ChevronDown size={9} className="text-c-muted shrink-0" /> : <ChevronRight size={9} className="text-c-muted shrink-0" />}
        <span className={`text-[10px] font-medium uppercase tracking-[0.06em] shrink-0 ${color}`}>
          {parsed.toolName}
        </span>
        <span className="text-c-muted text-[10px] mr-1">{'\u2192'}</span>
        <span className="text-c-dim text-[10px] truncate flex-1 group-hover:text-c-text transition-colors">
          {parsed.summary}
        </span>
        <span className="text-[9px] text-c-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {formatTime(ts)}
        </span>
      </button>
      {expanded && (
        <div className="px-2.5 pb-2 border-t border-c-border/50">
          <pre className="text-[10px] text-c-dim leading-relaxed whitespace-pre-wrap break-all max-h-48 overflow-y-auto mt-1.5">
            {parsed.fullContent}
          </pre>
        </div>
      )}
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
      <div className="bg-c-accent/[0.04] border border-c-accent/15 px-3 py-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-c-accent">You</span>
          <span className={`text-[9px] text-c-muted transition-opacity duration-200 ${showTime ? 'opacity-100' : 'opacity-0'}`}>
            {formatTime(ts)}
          </span>
        </div>
        <div className="text-c-text text-[12px] whitespace-pre-wrap break-words leading-relaxed">{content}</div>
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
      <div className="bg-c-surface/60 border-l-2 border-c-cyan/30 px-3 py-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-c-cyan">{agentName}</span>
          {isStreaming && <span className="w-1 h-1 bg-c-amber animate-pulse-live" />}
          <span className={`text-[9px] text-c-muted transition-opacity duration-200 ${showTime ? 'opacity-100' : 'opacity-0'}`}>
            {formatTime(ts)}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          {rendered}
          {isStreaming && (
            <span className="inline-block w-1.5 h-3.5 bg-c-accent ml-0.5 align-middle animate-blink" />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export function ChatPanel({ messages, onSend, isRunning, agentName }: Props) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);

  // Count messages by type
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

  // Detect if the last assistant message is still streaming
  const lastAssistantIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  }, [messages]);

  // Auto-scroll when near bottom
  useEffect(() => {
    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isNearBottom]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distFromBottom < 80;
    setIsNearBottom(near);
    setShowScrollButton(!near && messages.length > 3);
  }, [messages.length]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowScrollButton(false);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = '20px';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    }
  }, [input]);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isRunning) return;
    onSend(input.trim());
    setInput('');
    setIsNearBottom(true);
  }, [input, isRunning, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  // Group consecutive tool messages
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

  return (
    <div className="h-full flex flex-col bg-c-panel overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center px-3 py-1.5 border-b border-c-border shrink-0">
        <span className="text-[10px] font-medium tracking-[0.15em] uppercase text-c-dim flex items-center gap-1.5">
          <MessageSquare size={11} className="text-c-accent" />
          Terminal
        </span>
        <div className="flex items-center gap-3 text-[9px]">
          <span className="text-c-muted">{stats.total} msg</span>
          {stats.toolCount > 0 && <span className="text-c-cyan">{stats.toolCount} ops</span>}
          {isRunning ? (
            <span className="text-c-amber font-medium uppercase tracking-wider flex items-center gap-1">
              <span className="w-1 h-1 bg-c-amber animate-pulse-live" />
              Processing
            </span>
          ) : (
            <span className="text-c-green font-medium uppercase tracking-wider">Ready</span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-2"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-c-muted text-[11px] mb-1">{agentName.toLowerCase()} ready</div>
            <div className="text-c-dim text-[10px]">Type a command below to begin.</div>
          </div>
        )}

        <div className="space-y-3">
          {groupedMessages.map(group => {
            if (group.type === 'user') {
              return <UserMessage key={group.key} content={group.messages[0].content} ts={group.messages[0].ts} />;
            }

            if (group.type === 'assistant') {
              const msg = group.messages[0];
              const idx = messages.indexOf(msg);
              const isLast = idx === lastAssistantIndex;
              const isStreaming = isLast && isRunning;
              return <AssistantMessage key={group.key} content={msg.content} ts={msg.ts} isStreaming={isStreaming} agentName={agentName} />;
            }

            // Tool group
            return (
              <div key={group.key} className="space-y-px ml-4 opacity-70 hover:opacity-100 transition-opacity">
                {group.messages.map((msg, j) => (
                  <ToolCallCard key={`${msg.ts}-${j}`} content={msg.content} ts={msg.ts} />
                ))}
              </div>
            );
          })}
        </div>

        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <div className="absolute right-6 bottom-20 z-10">
          <button
            onClick={scrollToBottom}
            className="flex items-center gap-1 px-2 py-1 text-[9px] bg-c-surface border border-c-border text-c-muted hover:text-c-accent hover:border-c-accent/30 transition-colors uppercase tracking-wider"
            style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}
          >
            <ArrowDown size={10} />
            Latest
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="px-3 py-2 border-t border-c-border shrink-0">
        <div className="flex items-end gap-2">
          <span className="text-c-accent font-medium text-[11px] shrink-0 pb-0.5">{agentName.toLowerCase()} {'>'}</span>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRunning ? 'Agent is working...' : 'Type a message...'}
            disabled={isRunning}
            rows={1}
            className="flex-1 bg-transparent border-none outline-none text-c-text font-mono text-[12px] placeholder:text-c-muted disabled:opacity-30 resize-none leading-relaxed"
            style={{ caretColor: 'var(--color-c-accent)', minHeight: 20, maxHeight: 120 }}
            autoFocus
          />
          <div className="flex items-center gap-1.5 pb-0.5">
            {input.length > 0 && !isRunning && (
              <span className="text-[9px] text-c-muted">{input.length}</span>
            )}
            <button
              onClick={isRunning ? undefined : handleSubmit}
              disabled={isRunning ? false : !input.trim()}
              className={`p-1 transition-all ${
                isRunning
                  ? 'text-c-red hover:text-c-red/80 cursor-pointer'
                  : input.trim()
                    ? 'text-c-accent hover:text-c-accent/80 cursor-pointer'
                    : 'text-c-muted/30 cursor-not-allowed'
              }`}
              title={isRunning ? 'Stop' : 'Send'}
            >
              {isRunning ? <Square size={14} /> : <Send size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
