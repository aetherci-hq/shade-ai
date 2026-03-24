import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Zap, Pencil, Save, X, ChevronDown, ChevronRight, Search, Code, Copy, Check, Shield, User, Bot } from 'lucide-react';
import type { AgentState } from '../hooks/useAgent';

// ─── Types ──────────────────────────────────────────────────────────

interface SoulSection {
  title: string;
  level: number;
  content: string;
  lineStart: number;
  lineEnd: number;
}

interface SubagentInfo {
  name: string;
  description: string;
  model: string;
  tools: string[];
}

interface Props {
  agent: AgentState;
  connected: boolean;
  memoryContent: Record<string, string>;
  onMemorySave: (file: string, content: string) => void;
  onMemoryLoad: (file: string) => void;
  startTime: number;
  appConfig: import('../App').AppConfig | null;
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function estimateCost(input: number, output: number): string {
  const cost = (input * 3 + output * 15) / 1_000_000;
  return cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`;
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function parseSections(content: string): SoulSection[] {
  if (!content) return [];
  const lines = content.split('\n');
  const sections: SoulSection[] = [];
  let current: SoulSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,3})\s+(.+)/);
    if (match) {
      if (current) {
        current.lineEnd = i - 1;
        current.content = current.content.trimEnd();
        sections.push(current);
      }
      current = {
        title: match[2],
        level: match[1].length,
        content: '',
        lineStart: i,
        lineEnd: i,
      };
    } else if (current) {
      current.content += line + '\n';
    }
  }
  if (current) {
    current.lineEnd = lines.length - 1;
    current.content = current.content.trimEnd();
    sections.push(current);
  }

  return sections;
}

function getSectionContent(content: string, title: string): string {
  const sections = parseSections(content);
  const section = sections.find(s => s.title === title);
  return section?.content.replace(/^\n+/, '') ?? '';
}

function replaceSectionContent(fullContent: string, title: string, newBody: string): string {
  const lines = fullContent.split('\n');
  const sections = parseSections(fullContent);
  const section = sections.find(s => s.title === title);
  if (!section) return fullContent;

  const before = lines.slice(0, section.lineStart + 1);
  const after = lines.slice(section.lineEnd + 1);
  return [...before, newBody, ...after].join('\n');
}

function detectTraits(content: string): { label: string; active: boolean }[] {
  const lower = content.toLowerCase();
  return [
    { label: 'Humor', active: /humor|snarky|witty|joke/i.test(lower) },
    { label: 'Autonomous', active: /autonomous|independent|without.*permission/i.test(lower) },
    { label: 'Concise', active: /concise|direct|brief|succinct/i.test(lower) },
    { label: 'Persistent', active: /persistent|resourceful|don.t give up/i.test(lower) },
    { label: 'Memory', active: /memory\.md|persistent memory/i.test(lower) },
    { label: 'Subagents', active: /subagent|spawn.*agent/i.test(lower) },
    { label: 'Web Access', active: /web.*fetch|web.*search/i.test(lower) },
    { label: 'Shell Access', active: /bash|shell|command/i.test(lower) },
  ];
}

// ─── Rendered Markdown (simple) ─────────────────────────────────────

function RenderedContent({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="text-[13px] leading-[1.7] space-y-1">
      {lines.map((line, i) => {
        const boldProcessed = line.replace(/\*\*(.+?)\*\*/g, '<b class="text-c-text font-medium">$1</b>');
        const codeProcessed = boldProcessed.replace(/`([^`]+)`/g, '<code class="text-c-cyan text-[12px] bg-c-surface px-1.5 py-0.5">$1</code>');
        if (line.match(/^[-*]\s/)) {
          return <div key={i} className="flex gap-2 py-0.5"><span className="text-c-accent shrink-0">-</span><span className="text-c-dim" dangerouslySetInnerHTML={{ __html: codeProcessed.replace(/^[-*]\s/, '') }} /></div>;
        }
        if (line.match(/^\d+\.\s/)) {
          const num = line.match(/^(\d+)\./)?.[1];
          return <div key={i} className="flex gap-2 py-0.5"><span className="text-c-muted shrink-0 w-4 text-right">{num}.</span><span className="text-c-dim" dangerouslySetInnerHTML={{ __html: codeProcessed.replace(/^\d+\.\s*/, '') }} /></div>;
        }
        if (!line.trim()) return <div key={i} className="h-2.5" />;
        return <div key={i} className="text-c-dim py-0.5" dangerouslySetInnerHTML={{ __html: codeProcessed }} />;
      })}
    </div>
  );
}

// ─── Section Editor ─────────────────────────────────────────────────

function SectionEditor({
  title,
  content,
  onSave,
  placeholder,
}: {
  title: string;
  content: string;
  onSave: (newContent: string) => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleEdit = useCallback(() => {
    setDraft(content);
    setEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [content]);

  const handleSave = useCallback(() => {
    onSave(draft);
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [draft, onSave]);

  const handleCancel = useCallback(() => {
    setEditing(false);
    setDraft(content);
  }, [content]);

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-[12px] font-medium uppercase tracking-[0.1em] text-c-text">{title}</span>
          {saved && <span className="text-[11px] text-c-accent font-medium uppercase tracking-wider animate-fade-in">Saved</span>}
        </div>
        {editing ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider px-3 py-1 border border-c-accent/30 text-c-accent hover:bg-c-accent/5 transition-colors"
            >
              <Save size={11} /> Save
            </button>
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 text-[11px] text-c-muted border border-c-border px-3 py-1 hover:text-c-dim transition-colors uppercase tracking-wider"
            >
              <X size={11} /> Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={handleEdit}
            className="flex items-center gap-1.5 text-[11px] text-c-muted border border-c-border px-3 py-1 hover:text-c-accent hover:border-c-accent/25 transition-colors uppercase tracking-wider font-medium"
          >
            <Pencil size={11} /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <div>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') handleCancel();
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave();
            }}
            placeholder={placeholder}
            className="w-full bg-c-surface border border-c-accent/15 p-4 text-c-text font-mono text-[13px] resize-y outline-none focus:border-c-accent/30 leading-[1.7]"
            style={{ caretColor: 'var(--color-c-accent)', minHeight: 180 }}
            spellCheck={false}
          />
          <div className="text-[11px] text-c-muted mt-2">Ctrl+Enter to save · Escape to cancel</div>
        </div>
      ) : (
        <div className="bg-c-surface border border-c-border p-4">
          {content.trim() ? (
            <RenderedContent text={content} />
          ) : (
            <div className="text-c-muted text-[13px] italic py-2">Not defined. Click Edit to set up.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Subagent Card ──────────────────────────────────────────────────

function SubagentCard({ agent }: { agent: SubagentInfo }) {
  const modelColors: Record<string, string> = {
    haiku: 'text-c-purple',
    sonnet: 'text-c-cyan',
    opus: 'text-c-amber',
  };
  const modelBorderColors: Record<string, string> = {
    haiku: 'border-c-purple/20',
    sonnet: 'border-c-cyan/20',
    opus: 'border-c-amber/20',
  };
  const accentColor = modelColors[agent.model] ?? 'text-c-dim';
  const borderColor = modelBorderColors[agent.model] ?? 'border-c-border';
  const icon = agent.name === 'researcher' ? <Search size={14} /> : <Code size={14} />;

  return (
    <div className={`bg-c-surface border ${borderColor} p-4`}>
      <div className="flex items-center gap-2.5 mb-3">
        <span className={accentColor}>{icon}</span>
        <span className="text-c-text font-medium text-[13px] uppercase tracking-[0.06em]">{agent.name}</span>
        <span className={`ml-auto text-[11px] font-medium uppercase tracking-[0.08em] px-2 py-0.5 border ${borderColor} ${accentColor}`}>
          {agent.model}
        </span>
      </div>
      <div className="text-[12px] text-c-dim mb-3 leading-relaxed">{agent.description}</div>
      <div className="flex flex-wrap gap-1.5">
        {agent.tools.map(tool => (
          <span key={tool} className="text-[11px] text-c-muted px-2 py-0.5 bg-c-hover border border-c-border">
            {tool}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Human Persona Tab ──────────────────────────────────────────────

function HumanTab({
  content,
  onSave,
}: {
  content: string;
  onSave: (content: string) => void;
}) {
  const [draft, setDraft] = useState(content);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(content);
  }, [content, dirty]);

  const handleSave = useCallback(() => {
    onSave(draft);
    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [draft, onSave]);

  const handleReset = useCallback(() => {
    setDraft(content);
    setDirty(false);
  }, [content]);

  const charCount = draft.length;
  const tokenEstimate = Math.round(charCount / 4);

  return (
    <div className="px-6 py-6 animate-fade-in h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 mb-5">
        <div className="flex items-center gap-2.5 mb-3">
          <User size={16} className="text-c-accent" />
          <span className="text-[15px] font-medium tracking-[0.08em] text-c-text uppercase">About You</span>
        </div>
        <p className="text-[13px] text-c-dim leading-[1.7] max-w-lg">
          Tell your agent about yourself — your role, expertise, preferences, and how you like to work.
          This is injected into the agent's context so it can tailor its behavior to you.
        </p>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0 flex flex-col mb-4">
        <textarea
          value={draft}
          onChange={e => { setDraft(e.target.value); setDirty(true); }}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && dirty) handleSave();
          }}
          placeholder={"I'm a software engineer working on...\n\nI prefer concise responses and working code over explanations.\n\nMy stack: TypeScript, React, Node.js\n\nWhen I ask for help debugging, start by reading the relevant code — don't ask me to paste it."}
          className="w-full bg-c-surface border border-c-border p-5 text-c-text font-mono text-[13px] resize-none outline-none focus:border-c-accent/25 leading-[1.7] placeholder:text-c-muted/40 flex-1"
          style={{ caretColor: 'var(--color-c-accent)' }}
          spellCheck={false}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between shrink-0">
        <span className="text-[11px] text-c-muted">
          {charCount > 0 ? `${charCount} chars · ~${formatTokens(tokenEstimate)} tokens` : 'Empty — your agent won\'t know anything about you'}
        </span>
        <div className="flex items-center gap-3">
          {dirty && (
            <button
              onClick={handleReset}
              className="text-[11px] text-c-muted border border-c-border px-3 py-1 hover:text-c-dim transition-colors uppercase tracking-wider"
            >
              Reset
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!dirty}
            className={`flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider px-3.5 py-1 border transition-all ${
              saved
                ? 'text-c-accent border-c-accent bg-c-accent/10'
                : dirty
                  ? 'text-c-accent border-c-accent/30 hover:bg-c-accent/5'
                  : 'text-c-muted border-c-border opacity-40'
            }`}
          >
            <Save size={11} />
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      {dirty && <div className="text-[11px] text-c-muted shrink-0">Ctrl+Enter to save</div>}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export function PersonaPanel({ agent, connected, memoryContent, onMemorySave, onMemoryLoad, startTime, appConfig }: Props) {
  const [tab, setTab] = useState<'agent' | 'human'>('agent');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedDraft, setAdvancedDraft] = useState('');
  const [advancedDirty, setAdvancedDirty] = useState(false);
  const [advancedSaved, setAdvancedSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const soulContent = memoryContent['SOUL'] ?? '';
  const humanContent = memoryContent['HUMAN'] ?? '';

  useEffect(() => { onMemoryLoad('SOUL'); onMemoryLoad('HUMAN'); }, [onMemoryLoad]);

  useEffect(() => {
    if (!advancedDirty) setAdvancedDraft(soulContent);
  }, [soulContent, advancedDirty]);

  const identityContent = useMemo(() => getSectionContent(soulContent, 'Identity'), [soulContent]);
  const styleContent = useMemo(() => getSectionContent(soulContent, 'Response Style'), [soulContent]);
  const traits = useMemo(() => detectTraits(soulContent), [soulContent]);

  const subagents = useMemo<SubagentInfo[]>(() => {
    if (!appConfig?.agent.subagents) return [];
    return Object.entries(appConfig.agent.subagents).map(([name, def]) => ({
      name,
      description: def.description,
      model: def.model ?? 'sonnet',
      tools: def.tools ?? [],
    }));
  }, [appConfig]);

  const handleSectionSave = useCallback((sectionTitle: string, newContent: string) => {
    const updated = replaceSectionContent(soulContent, sectionTitle, '\n' + newContent);
    onMemorySave('SOUL', updated);
  }, [soulContent, onMemorySave]);

  const handleAdvancedSave = useCallback(() => {
    onMemorySave('SOUL', advancedDraft);
    setAdvancedDirty(false);
    setAdvancedSaved(true);
    setTimeout(() => setAdvancedSaved(false), 2000);
  }, [advancedDraft, onMemorySave]);

  const handleHumanSave = useCallback((content: string) => {
    onMemorySave('HUMAN', content);
  }, [onMemorySave]);

  const handleCopySessionId = useCallback(() => {
    navigator.clipboard.writeText('session-id').catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const status = connected ? (agent.isRunning ? 'WORKING' : 'ALIVE') : 'DISCONNECTED';
  const statusColor = connected ? (agent.isRunning ? 'text-c-amber' : 'text-c-green') : 'text-c-red';
  const agentName = appConfig?.name ?? 'Specter';
  const modelName = appConfig?.llm.model ?? 'claude-sonnet-4';
  const permMode = (appConfig?.agent.permissionMode ?? 'bypass').toUpperCase();
  const uptime = Date.now() - startTime;

  const soulCharCount = soulContent.length;
  const soulTokenEstimate = Math.round(soulCharCount / 4);

  return (
    <div className="h-full flex flex-col bg-c-panel overflow-hidden">
      {/* Header with tabs */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-c-border shrink-0">
        <span className="text-[12px] font-medium tracking-[0.15em] uppercase text-c-dim flex items-center gap-2">
          <Zap size={13} className="text-c-accent" />
          Persona
        </span>
        <div className="flex">
          <button
            onClick={() => setTab('agent')}
            className={`flex items-center gap-2 px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] transition-colors border-b-2 ${
              tab === 'agent'
                ? 'text-c-accent border-c-accent'
                : 'text-c-muted border-transparent hover:text-c-dim'
            }`}
          >
            <Bot size={13} /> Agent
          </button>
          <button
            onClick={() => setTab('human')}
            className={`flex items-center gap-2 px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] transition-colors border-b-2 ${
              tab === 'human'
                ? 'text-c-accent border-c-accent'
                : 'text-c-muted border-transparent hover:text-c-dim'
            }`}
          >
            <User size={13} /> Human
          </button>
        </div>
      </div>

      {/* Content — scrollable for agent tab, flex-fill for human tab */}
      <div className={`flex-1 min-h-0 ${tab === 'agent' ? 'overflow-y-auto' : 'flex flex-col'}`}>

        {tab === 'agent' && (
          <>
            {/* Identity Card */}
            <div className="px-6 pt-6 pb-5">
              <div className="mb-4">
                <div className="flex items-center gap-3">
                  <h1 className="text-[24px] font-medium tracking-[0.12em] text-c-text glow-text-strong">
                    {agentName.toUpperCase()}
                  </h1>
                  <div className={`w-2 h-2 ${connected ? (agent.isRunning ? 'bg-c-amber' : 'bg-c-green animate-pulse-live') : 'bg-c-red'}`} />
                  <span className={`text-[11px] font-medium uppercase tracking-[0.15em] ${statusColor}`}>
                    {status}
                  </span>
                </div>
              </div>

              {/* Badge row */}
              <div className="flex flex-wrap items-center gap-3 mb-5">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] px-2.5 py-1 border border-c-cyan/25 text-c-cyan">
                  {modelName}
                </span>
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] px-2.5 py-1 border border-c-amber/25 text-c-amber flex items-center gap-1.5">
                  <Shield size={11} />
                  {permMode}
                </span>
                <button
                  onClick={handleCopySessionId}
                  className="text-[11px] font-medium uppercase tracking-[0.06em] px-2.5 py-1 border border-c-border text-c-muted hover:text-c-dim hover:border-c-dim transition-colors flex items-center gap-1.5"
                >
                  {copied ? <Check size={11} className="text-c-accent" /> : <Copy size={11} />}
                  session
                </button>
              </div>

              {/* Stats row */}
              <div className="flex gap-8 text-[12px]">
                <div>
                  <span className="text-c-muted uppercase tracking-[0.08em]">tokens </span>
                  <span className="text-c-cyan font-medium">{formatTokens(agent.totalTokens.input + agent.totalTokens.output)}</span>
                </div>
                <div>
                  <span className="text-c-muted uppercase tracking-[0.08em]">cost </span>
                  <span className="text-c-amber font-medium">{estimateCost(agent.totalTokens.input, agent.totalTokens.output)}</span>
                </div>
                <div>
                  <span className="text-c-muted uppercase tracking-[0.08em]">uptime </span>
                  <span className="text-c-dim font-medium">{formatUptime(uptime)}</span>
                </div>
                <div>
                  <span className="text-c-muted uppercase tracking-[0.08em]">tools </span>
                  <span className="text-c-amber font-medium">{agent.toolCalls}</span>
                </div>
              </div>
            </div>

            {/* Personality Traits */}
            <div className="px-6 py-4 border-t border-c-border">
              <div className="flex flex-wrap gap-2">
                {traits.map(t => (
                  <span
                    key={t.label}
                    className={`text-[11px] font-medium uppercase tracking-[0.08em] px-2.5 py-1 border transition-all ${
                      t.active
                        ? 'text-c-accent border-c-accent/20 bg-c-accent/5'
                        : 'text-c-muted border-c-border opacity-40'
                    }`}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="border-t border-c-border" />

            {/* Identity & Personality Section */}
            <div className="px-6 py-5">
              <SectionEditor
                title="Identity & Personality"
                content={identityContent}
                onSave={(content) => handleSectionSave('Identity', content)}
                placeholder="Define who your agent is, its core role, and personality traits..."
              />
            </div>

            <div className="border-t border-c-border" />

            {/* Response Style Section */}
            <div className="px-6 py-5">
              <SectionEditor
                title="Response Style"
                content={styleContent}
                onSave={(content) => handleSectionSave('Response Style', content)}
                placeholder="How should your agent communicate? Tone, format, verbosity..."
              />
            </div>

            <div className="border-t border-c-border" />

            {/* Advanced: Full SOUL.md */}
            <div className="px-6 py-5">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 w-full text-left py-1.5 group"
              >
                {showAdvanced ? <ChevronDown size={13} className="text-c-muted" /> : <ChevronRight size={13} className="text-c-muted" />}
                <span className="text-[12px] font-medium uppercase tracking-[0.1em] text-c-muted group-hover:text-c-accent transition-colors">
                  Advanced: Full SOUL.md
                </span>
                <div className="flex-1 border-b border-c-border/50 ml-3 mb-0.5" />
                <span className="text-[11px] text-c-muted ml-3">
                  {soulCharCount} chars · ~{formatTokens(soulTokenEstimate)} tokens
                </span>
              </button>

              {showAdvanced && (
                <div className="mt-3 animate-fade-in">
                  <div className="flex items-center justify-end gap-3 mb-3">
                    {advancedDirty && (
                      <span className="text-[11px] text-c-amber font-medium uppercase tracking-wider">Modified</span>
                    )}
                    <button
                      onClick={handleAdvancedSave}
                      disabled={!advancedDirty}
                      className={`flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider px-3 py-1 border transition-all ${
                        advancedSaved
                          ? 'text-c-accent border-c-accent bg-c-accent/10'
                          : advancedDirty
                            ? 'text-c-accent border-c-accent/30 hover:bg-c-accent/5'
                            : 'text-c-muted border-c-border opacity-40'
                      }`}
                    >
                      <Save size={11} />
                      {advancedSaved ? 'Saved' : 'Save'}
                    </button>
                    {advancedDirty && (
                      <button
                        onClick={() => { setAdvancedDirty(false); setAdvancedDraft(soulContent); }}
                        className="flex items-center gap-1.5 text-[11px] text-c-muted border border-c-border px-3 py-1 hover:text-c-dim transition-colors uppercase tracking-wider"
                      >
                        <X size={11} /> Reset
                      </button>
                    )}
                  </div>
                  <textarea
                    value={advancedDraft}
                    onChange={e => { setAdvancedDraft(e.target.value); setAdvancedDirty(true); }}
                    className="w-full bg-c-surface border border-c-border p-4 text-c-text font-mono text-[13px] resize-none outline-none focus:border-c-accent/25 leading-[1.7]"
                    style={{ caretColor: 'var(--color-c-accent)', minHeight: 'calc(100vh - 520px)' }}
                    spellCheck={false}
                  />
                </div>
              )}
            </div>

            <div className="border-t border-c-border" />

            {/* Subagent Gallery */}
            <div className="px-6 py-5 pb-8">
              <div className="text-[11px] font-medium uppercase tracking-[0.15em] text-c-muted mb-4">
                Crew Manifest · {subagents.length} subagent{subagents.length !== 1 ? 's' : ''}
              </div>

              {subagents.length === 0 ? (
                <div className="text-c-muted text-[13px]">
                  No subagents configured. Define them in shade.config.yaml.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {subagents.map(sa => (
                    <SubagentCard key={sa.name} agent={sa} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'human' && (
          <HumanTab content={humanContent} onSave={handleHumanSave} />
        )}
      </div>
    </div>
  );
}
