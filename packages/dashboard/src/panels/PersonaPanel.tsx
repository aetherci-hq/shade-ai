import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Zap, Eye, Pencil, Save, X, ChevronDown, ChevronRight, Search, Code, Copy, Check, Shield } from 'lucide-react';
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

function detectTraits(content: string): { label: string; active: boolean }[] {
  const lower = content.toLowerCase();
  return [
    { label: 'Humor', active: /humor|snarky|witty|joke/i.test(lower) },
    { label: 'Autonomous', active: /autonomous|independent|without.*permission/i.test(lower) },
    { label: 'Concise', active: /concise|direct|brief/i.test(lower) },
    { label: 'Persistent', active: /persistent|resourceful|don.t give up/i.test(lower) },
    { label: 'Memory', active: /memory\.md|persistent memory/i.test(lower) },
    { label: 'Subagents', active: /subagent|spawn.*agent/i.test(lower) },
    { label: 'Web Access', active: /web.*fetch|web.*search/i.test(lower) },
    { label: 'Shell Access', active: /bash|shell|command/i.test(lower) },
  ];
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

  const icon = agent.name === 'researcher' ? <Search size={12} /> : <Code size={12} />;

  return (
    <div className={`bg-c-surface border ${borderColor} p-3`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={accentColor}>{icon}</span>
        <span className="text-c-text font-medium text-[11px] uppercase tracking-[0.06em]">{agent.name}</span>
        <span className={`ml-auto text-[9px] font-medium uppercase tracking-[0.1em] px-1.5 py-px border ${borderColor} ${accentColor}`}>
          {agent.model}
        </span>
      </div>
      <div className="text-[10px] text-c-dim mb-2 leading-relaxed">{agent.description}</div>
      <div className="flex flex-wrap gap-1">
        {agent.tools.map(tool => (
          <span key={tool} className="text-[9px] text-c-muted px-1.5 py-px bg-c-hover border border-c-border">
            {tool}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Soul Section (collapsible) ─────────────────────────────────────

function SoulSectionView({ section }: { section: SoulSection }) {
  const [collapsed, setCollapsed] = useState(section.level > 2);

  const rendered = useMemo(() => {
    return section.content
      .split('\n')
      .map((line, i) => {
        const boldProcessed = line.replace(/\*\*(.+?)\*\*/g, '<b class="text-c-text font-medium">$1</b>');
        const codeProcessed = boldProcessed.replace(/`([^`]+)`/g, '<code class="text-c-cyan text-[10px] bg-c-surface px-1">$1</code>');
        if (line.match(/^[-*]\s/)) {
          return <div key={i} className="flex gap-1.5 py-px"><span className="text-c-accent shrink-0">-</span><span className="text-c-dim" dangerouslySetInnerHTML={{ __html: codeProcessed.replace(/^[-*]\s/, '') }} /></div>;
        }
        if (line.match(/^\d+\.\s/)) {
          const num = line.match(/^(\d+)\./)?.[1];
          return <div key={i} className="flex gap-1.5 py-px"><span className="text-c-muted shrink-0 w-3 text-right">{num}.</span><span className="text-c-dim" dangerouslySetInnerHTML={{ __html: codeProcessed.replace(/^\d+\.\s*/, '') }} /></div>;
        }
        if (!line.trim()) return <div key={i} className="h-1.5" />;
        return <div key={i} className="text-c-dim py-px" dangerouslySetInnerHTML={{ __html: codeProcessed }} />;
      });
  }, [section.content]);

  const indentClass = section.level === 3 ? 'ml-3' : '';

  return (
    <div className={`${indentClass} animate-fade-in`}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 w-full text-left py-1 group"
      >
        {collapsed ? <ChevronRight size={10} className="text-c-muted shrink-0" /> : <ChevronDown size={10} className="text-c-muted shrink-0" />}
        <span className={`font-medium uppercase tracking-[0.08em] group-hover:text-c-accent transition-colors ${
          section.level === 2 ? 'text-[11px] text-c-text' : 'text-[10px] text-c-dim'
        }`}>
          {section.title}
        </span>
        <div className="flex-1 border-b border-c-border/50 ml-2 mb-0.5" />
      </button>
      {!collapsed && (
        <div className="pl-4 pb-2 text-[11px] leading-relaxed">
          {rendered}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export function PersonaPanel({ agent, connected, memoryContent, onMemorySave, onMemoryLoad, startTime }: Props) {
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [editingPreamble, setEditingPreamble] = useState(false);
  const [preambleDraft, setPreambleDraft] = useState('');
  const preambleRef = useRef<HTMLTextAreaElement>(null);

  const soulContent = memoryContent['SOUL'] ?? '';

  useEffect(() => { onMemoryLoad('SOUL'); }, [onMemoryLoad]);

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(setConfig)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!dirty) setDraft(soulContent);
  }, [soulContent, dirty]);

  const sections = useMemo(() => parseSections(soulContent), [soulContent]);
  const traits = useMemo(() => detectTraits(soulContent), [soulContent]);

  const preamble = useMemo(() => {
    const lines = soulContent.split('\n');
    const firstSection = lines.findIndex(l => l.match(/^#{1,3}\s/));
    if (firstSection <= 0) return '';
    return lines.slice(0, firstSection).join('\n').trim();
  }, [soulContent]);

  const subagents = useMemo<SubagentInfo[]>(() => {
    if (!config) return [];
    const agentConfig = config['agent'] as Record<string, unknown> | undefined;
    const subagentNames = agentConfig?.['subagents'] as string[] | undefined;
    if (!subagentNames || !Array.isArray(subagentNames)) return [];

    const defaults: Record<string, SubagentInfo> = {
      researcher: {
        name: 'researcher',
        description: 'Research agent for web searches, information gathering, and analysis.',
        model: 'haiku',
        tools: ['WebSearch', 'WebFetch', 'Read', 'Grep', 'Glob'],
      },
      coder: {
        name: 'coder',
        description: 'Coding agent for writing, editing, and debugging code.',
        model: 'sonnet',
        tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      },
    };

    return subagentNames.map(name => defaults[name] ?? {
      name,
      description: 'Custom subagent',
      model: 'sonnet',
      tools: [],
    });
  }, [config]);

  const handleSave = useCallback(() => {
    onMemorySave('SOUL', draft);
    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [draft, onMemorySave]);

  const handleCopySessionId = useCallback(() => {
    navigator.clipboard.writeText('session-id').catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const handlePreambleEdit = useCallback(() => {
    setPreambleDraft(preamble);
    setEditingPreamble(true);
    setTimeout(() => preambleRef.current?.focus(), 0);
  }, [preamble]);

  const handlePreambleSave = useCallback(() => {
    // Replace the preamble in SOUL.md (text before first ## heading)
    const lines = soulContent.split('\n');
    const firstSection = lines.findIndex(l => l.match(/^#{1,3}\s/));
    const rest = firstSection > 0 ? lines.slice(firstSection).join('\n') : lines.join('\n');
    const updated = preambleDraft.trim() + '\n\n' + rest;
    onMemorySave('SOUL', updated);
    setEditingPreamble(false);
  }, [soulContent, preambleDraft, onMemorySave]);

  const handlePreambleCancel = useCallback(() => {
    setEditingPreamble(false);
    setPreambleDraft(preamble);
  }, [preamble]);

  const status = connected ? (agent.isRunning ? 'WORKING' : 'ALIVE') : 'DISCONNECTED';
  const statusColor = connected ? (agent.isRunning ? 'text-c-amber' : 'text-c-green') : 'text-c-red';

  const modelName = (config?.['llm'] as Record<string, unknown>)?.['model'] as string ?? 'claude-sonnet-4';
  const permMode = ((config?.['agent'] as Record<string, unknown>)?.['permissionMode'] as string ?? 'bypass').toUpperCase();
  const uptime = Date.now() - startTime;
  const charCount = soulContent.length;
  const tokenEstimate = Math.round(charCount / 4);

  return (
    <div className="h-full flex flex-col bg-c-panel overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center px-3 py-1.5 border-b border-c-border shrink-0">
        <span className="text-[10px] font-medium tracking-[0.15em] uppercase text-c-dim flex items-center gap-1.5">
          <Zap size={11} className="text-c-accent" />
          Agent Persona
        </span>
        <div className="flex items-center gap-2">
          {mode === 'edit' && (
            <span className="text-[9px] text-c-amber font-medium uppercase tracking-wider">
              {dirty ? 'MODIFIED' : 'EDITING'}
            </span>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">

        {/* Identity Card */}
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center gap-3 mb-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[20px] font-medium tracking-[0.12em] text-c-text glow-text-strong">
                  SPECTER
                </h1>
                <div className={`w-1.5 h-1.5 ${connected ? (agent.isRunning ? 'bg-c-amber' : 'bg-c-green animate-pulse-live') : 'bg-c-red'}`} />
                <span className={`text-[9px] font-medium uppercase tracking-[0.15em] ${statusColor}`}>
                  {status}
                </span>
              </div>
              {editingPreamble ? (
                <div className="mt-1.5 max-w-xl">
                  <textarea
                    ref={preambleRef}
                    value={preambleDraft}
                    onChange={e => setPreambleDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Escape') handlePreambleCancel();
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePreambleSave();
                    }}
                    className="w-full bg-c-surface border border-c-accent/25 p-2 text-[11px] text-c-text font-mono resize-none outline-none leading-relaxed"
                    style={{ caretColor: 'var(--color-c-accent)', minHeight: 60 }}
                    spellCheck={false}
                  />
                  <div className="flex gap-2 mt-1.5">
                    <button
                      onClick={handlePreambleSave}
                      className="text-[9px] px-2 py-0.5 border border-c-accent text-c-accent uppercase tracking-wider font-medium hover:bg-c-accent/10 transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={handlePreambleCancel}
                      className="text-[9px] px-2 py-0.5 border border-c-border text-c-muted uppercase tracking-wider hover:text-c-text transition-colors"
                    >
                      Cancel
                    </button>
                    <span className="text-[9px] text-c-muted self-center ml-1">Ctrl+Enter to save</span>
                  </div>
                </div>
              ) : (
                <div
                  className="group flex items-start gap-1.5 mt-1 max-w-xl cursor-pointer"
                  onClick={handlePreambleEdit}
                  title="Click to edit description"
                >
                  <div className="text-[10px] text-c-dim leading-relaxed">
                    {preamble ? preamble.split('\n').filter(l => l.trim()).slice(0, 2).join(' ') : 'No description set. Click to add one.'}
                  </div>
                  <Pencil size={9} className="text-c-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                </div>
              )}
            </div>
          </div>

          {/* Badge row */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-[9px] font-medium uppercase tracking-[0.08em] px-2 py-0.5 border border-c-cyan/25 text-c-cyan">
              {modelName}
            </span>
            <span className="text-[9px] font-medium uppercase tracking-[0.08em] px-2 py-0.5 border border-c-amber/25 text-c-amber flex items-center gap-1">
              <Shield size={8} />
              {permMode}
            </span>
            <button
              onClick={handleCopySessionId}
              className="text-[9px] font-medium uppercase tracking-[0.06em] px-2 py-0.5 border border-c-border text-c-muted hover:text-c-dim hover:border-c-dim transition-colors flex items-center gap-1"
            >
              {copied ? <Check size={8} className="text-c-accent" /> : <Copy size={8} />}
              session
            </button>
          </div>

          {/* Stats row */}
          <div className="flex gap-6 text-[10px]">
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
        <div className="px-4 py-2 border-t border-c-border">
          <div className="flex flex-wrap gap-1.5">
            {traits.map(t => (
              <span
                key={t.label}
                className={`text-[9px] font-medium uppercase tracking-[0.08em] px-2 py-0.5 border transition-all ${
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

        {/* Soul Editor */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="text-[9px] font-medium uppercase tracking-[0.15em] text-c-muted">
                SOUL.md
              </div>
              <span className="text-[9px] text-c-muted">
                {charCount} chars · ~{formatTokens(tokenEstimate)} tokens
              </span>
            </div>
            <div className="flex items-center gap-2">
              {mode === 'edit' && (
                <>
                  <button
                    onClick={handleSave}
                    disabled={!dirty}
                    className={`flex items-center gap-1 text-[9px] font-medium uppercase tracking-wider px-2 py-0.5 border transition-all ${
                      saved
                        ? 'text-c-accent border-c-accent bg-c-accent/10'
                        : dirty
                          ? 'text-c-accent border-c-accent/30 hover:bg-c-accent/5'
                          : 'text-c-muted border-c-border opacity-40'
                    }`}
                  >
                    <Save size={8} />
                    {saved ? 'Saved' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setMode('preview'); setDirty(false); setDraft(soulContent); }}
                    className="flex items-center gap-1 text-[9px] text-c-muted border border-c-border px-2 py-0.5 hover:text-c-dim transition-colors uppercase tracking-wider"
                  >
                    <X size={8} />
                    Cancel
                  </button>
                </>
              )}
              <button
                onClick={() => setMode(mode === 'preview' ? 'edit' : 'preview')}
                className={`flex items-center gap-1 text-[9px] font-medium uppercase tracking-wider px-2 py-0.5 border transition-all ${
                  mode === 'edit'
                    ? 'text-c-amber border-c-amber/25 bg-c-amber/5'
                    : 'text-c-muted border-c-border hover:text-c-accent hover:border-c-accent/25'
                }`}
              >
                {mode === 'preview' ? <><Pencil size={8} /> Edit</> : <><Eye size={8} /> Preview</>}
              </button>
            </div>
          </div>

          {mode === 'edit' ? (
            <textarea
              value={draft}
              onChange={e => { setDraft(e.target.value); setDirty(true); }}
              className="w-full bg-c-surface border border-c-border p-3 text-c-text font-mono text-[11px] resize-none outline-none focus:border-c-accent/25 leading-relaxed"
              style={{ caretColor: 'var(--color-c-accent)', minHeight: 'calc(100vh - 420px)' }}
              spellCheck={false}
            />
          ) : (
            <div className="bg-c-surface border border-c-border p-3 space-y-1" style={{ minHeight: 200 }}>
              {sections.length === 0 ? (
                <div className="text-c-muted text-[11px] py-4 text-center">
                  SOUL.md is empty. Click Edit to define the agent's personality.
                </div>
              ) : (
                sections.map((section, i) => (
                  <SoulSectionView key={`${section.title}-${i}`} section={section} />
                ))
              )}
            </div>
          )}
        </div>

        <div className="border-t border-c-border" />

        {/* Subagent Gallery */}
        <div className="px-4 py-3 pb-6">
          <div className="text-[9px] font-medium uppercase tracking-[0.15em] text-c-muted mb-3">
            Crew Manifest · {subagents.length} subagent{subagents.length !== 1 ? 's' : ''}
          </div>

          {subagents.length === 0 ? (
            <div className="text-c-muted text-[11px]">
              No subagents configured. Define them in specter.config.yaml.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {subagents.map(sa => (
                <SubagentCard key={sa.name} agent={sa} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
