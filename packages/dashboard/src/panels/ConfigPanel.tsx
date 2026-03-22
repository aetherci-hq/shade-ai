import { useState, useEffect, useCallback } from 'react';
import { Panel } from '../components/Panel';
import { Save, RotateCcw, Check, AlertTriangle, Plus, Copy, Trash2, ChevronDown, ChevronRight } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────

interface SubagentDef {
  description: string;
  prompt: string;
  model: string;
  tools: string[];
  maxTurns?: number;
}

interface ConfigData {
  name: string;
  llm: { provider: string; model: string };
  agent: {
    maxTurns: number;
    maxBudgetUsd?: number;
    permissionMode: string;
    subagents: Record<string, SubagentDef>;
  };
  heartbeat: { enabled: boolean; intervalMinutes: number };
  tools: { allowed: string[]; disallowed: string[] };
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// ─── Constants ──────────────────────────────────────────────────────

const MODELS = [
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-haiku-4-5-20251001',
];

const SUBAGENT_MODELS: { value: string; label: string }[] = [
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'inherit', label: 'Inherit' },
];

const PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];

const ALL_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent'];

// ─── Main Component ─────────────────────────────────────────────────

export function ConfigPanel() {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [draft, setDraft] = useState<ConfigData | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then((data: ConfigData) => {
        setConfig(data);
        setDraft(data);
      })
      .catch(() => setConfig(null));
  }, []);

  const hasChanges = config && draft && JSON.stringify(config) !== JSON.stringify(draft);

  const handleSave = useCallback(async () => {
    if (!draft || !hasChanges) return;
    setSaveState('saving');
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          llm: { model: draft.llm.model },
          agent: {
            maxTurns: draft.agent.maxTurns,
            maxBudgetUsd: draft.agent.maxBudgetUsd,
            permissionMode: draft.agent.permissionMode,
            subagents: draft.agent.subagents,
          },
          heartbeat: draft.heartbeat,
          tools: { allowed: draft.tools.allowed, disallowed: draft.tools.disallowed },
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      const updated = await res.json() as ConfigData;
      setConfig(updated);
      setDraft(updated);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3000);
    }
  }, [draft, hasChanges]);

  const handleReset = useCallback(() => {
    if (config) setDraft(config);
  }, [config]);

  const updateDraft = useCallback((updater: (d: ConfigData) => ConfigData) => {
    setDraft(prev => prev ? updater(prev) : prev);
  }, []);

  const toggleTool = useCallback((tool: string) => {
    updateDraft(d => {
      const allowed = d.tools.allowed.includes(tool)
        ? d.tools.allowed.filter(t => t !== tool)
        : [...d.tools.allowed, tool];
      return { ...d, tools: { ...d.tools, allowed } };
    });
  }, [updateDraft]);

  // ─── Subagent operations ────────────────────────────────────────

  const updateSubagent = useCallback((name: string, updater: (s: SubagentDef) => SubagentDef) => {
    updateDraft(d => ({
      ...d,
      agent: {
        ...d.agent,
        subagents: {
          ...d.agent.subagents,
          [name]: updater(d.agent.subagents[name]),
        },
      },
    }));
  }, [updateDraft]);

  const addSubagent = useCallback(() => {
    const existing = draft?.agent.subagents ?? {};
    let name = 'agent';
    let i = 1;
    while (existing[name]) { name = `agent${++i}`; }

    updateDraft(d => ({
      ...d,
      agent: {
        ...d.agent,
        subagents: {
          ...d.agent.subagents,
          [name]: {
            description: '',
            prompt: '',
            model: 'sonnet',
            tools: ['Read', 'Glob', 'Grep'],
          },
        },
      },
    }));
  }, [draft, updateDraft]);

  const duplicateSubagent = useCallback((srcName: string) => {
    if (!draft) return;
    const src = draft.agent.subagents[srcName];
    let name = `${srcName}-copy`;
    let i = 1;
    while (draft.agent.subagents[name]) { name = `${srcName}-copy${++i}`; }

    updateDraft(d => ({
      ...d,
      agent: {
        ...d.agent,
        subagents: {
          ...d.agent.subagents,
          [name]: { ...src },
        },
      },
    }));
  }, [draft, updateDraft]);

  const deleteSubagent = useCallback((name: string) => {
    updateDraft(d => {
      const { [name]: _, ...rest } = d.agent.subagents;
      return { ...d, agent: { ...d.agent, subagents: rest } };
    });
  }, [updateDraft]);

  const renameSubagent = useCallback((oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) return;
    const sanitized = newName.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!sanitized || draft?.agent.subagents[sanitized]) return;

    updateDraft(d => {
      const entries = Object.entries(d.agent.subagents).map(([k, v]) =>
        k === oldName ? [sanitized, v] : [k, v]
      );
      return { ...d, agent: { ...d.agent, subagents: Object.fromEntries(entries) } };
    });
  }, [draft, updateDraft]);

  // ─── Render ─────────────────────────────────────────────────────

  if (!draft) {
    return (
      <Panel title="Configuration" className="h-full">
        <div className="text-c-muted">Loading config...</div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Configuration"
      status={
        <div className="flex items-center gap-2">
          {saveState === 'saved' && (
            <span className="text-c-green flex items-center gap-1 text-[9px] uppercase tracking-wider">
              <Check size={10} /> Saved
            </span>
          )}
          {saveState === 'error' && (
            <span className="text-c-red flex items-center gap-1 text-[9px] uppercase tracking-wider">
              <AlertTriangle size={10} /> Error
            </span>
          )}
          {hasChanges && (
            <>
              <button
                onClick={handleReset}
                className="text-c-muted hover:text-c-text transition-colors p-0.5"
                title="Discard changes"
              >
                <RotateCcw size={11} />
              </button>
              <button
                onClick={handleSave}
                disabled={saveState === 'saving'}
                className="text-c-accent hover:text-c-accent/80 transition-colors p-0.5"
                title="Save & apply"
              >
                <Save size={11} />
              </button>
            </>
          )}
        </div>
      }
      className="h-full"
    >
      <div className="space-y-4">
        {/* Agent Name */}
        <Section label="Identity">
          <Field label="Name">
            <input
              type="text"
              value={draft.name}
              onChange={e => updateDraft(d => ({ ...d, name: e.target.value }))}
              className="cfg-input w-40"
            />
          </Field>
        </Section>

        {/* LLM */}
        <Section label="LLM">
          <Field label="Model">
            <select
              value={draft.llm.model}
              onChange={e => updateDraft(d => ({ ...d, llm: { ...d.llm, model: e.target.value } }))}
              className="cfg-input w-56"
            >
              {MODELS.map(m => <option key={m} value={m}>{m.replace('claude-', '').replace(/-\d+$/, '')}</option>)}
            </select>
          </Field>
        </Section>

        {/* Agent */}
        <Section label="Agent">
          <Field label="Max Turns">
            <input
              type="number"
              value={draft.agent.maxTurns}
              onChange={e => updateDraft(d => ({ ...d, agent: { ...d.agent, maxTurns: parseInt(e.target.value) || 1 } }))}
              className="cfg-input w-20"
              min={1}
              max={200}
            />
          </Field>
          <Field label="Budget Cap">
            <div className="flex items-center gap-1">
              <span className="text-c-muted text-[10px]">$</span>
              <input
                type="number"
                value={draft.agent.maxBudgetUsd ?? ''}
                onChange={e => {
                  const val = e.target.value ? parseFloat(e.target.value) : undefined;
                  updateDraft(d => ({ ...d, agent: { ...d.agent, maxBudgetUsd: val } }));
                }}
                className="cfg-input w-20"
                min={0}
                step={0.1}
                placeholder="none"
              />
            </div>
          </Field>
          <Field label="Permissions">
            <select
              value={draft.agent.permissionMode}
              onChange={e => updateDraft(d => ({ ...d, agent: { ...d.agent, permissionMode: e.target.value } }))}
              className="cfg-input w-40"
            >
              {PERMISSION_MODES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        </Section>

        {/* Heartbeat */}
        <Section label="Heartbeat">
          <Field label="Enabled">
            <button
              onClick={() => updateDraft(d => ({ ...d, heartbeat: { ...d.heartbeat, enabled: !d.heartbeat.enabled } }))}
              className={`w-8 h-4 flex items-center transition-colors border ${
                draft.heartbeat.enabled
                  ? 'bg-c-accent/20 border-c-accent/40 justify-end'
                  : 'bg-c-surface border-c-border justify-start'
              }`}
            >
              <div className={`w-3 h-3 mx-px ${draft.heartbeat.enabled ? 'bg-c-accent' : 'bg-c-muted'}`} />
            </button>
          </Field>
          <Field label="Interval">
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={draft.heartbeat.intervalMinutes}
                onChange={e => updateDraft(d => ({
                  ...d,
                  heartbeat: { ...d.heartbeat, intervalMinutes: parseInt(e.target.value) || 1 },
                }))}
                className="cfg-input w-16"
                min={1}
                max={1440}
              />
              <span className="text-c-muted text-[10px]">min</span>
            </div>
          </Field>
        </Section>

        {/* Tools */}
        <Section label="Tools">
          <div className="flex flex-wrap gap-1.5 mt-1">
            {ALL_TOOLS.map(tool => {
              const enabled = draft.tools.allowed.includes(tool);
              return (
                <button
                  key={tool}
                  onClick={() => toggleTool(tool)}
                  className={`text-[9px] px-2 py-0.5 border uppercase tracking-wider transition-colors ${
                    enabled
                      ? 'border-c-cyan/30 text-c-cyan bg-c-cyan/[0.06]'
                      : 'border-c-border text-c-muted hover:text-c-dim'
                  }`}
                >
                  {tool}
                </button>
              );
            })}
          </div>
        </Section>

        {/* Subagents */}
        <Section
          label="Subagents"
          action={
            <button
              onClick={addSubagent}
              className="text-c-muted hover:text-c-accent transition-colors"
              title="Add subagent"
            >
              <Plus size={11} />
            </button>
          }
        >
          {Object.keys(draft.agent.subagents).length === 0 && (
            <div className="text-[10px] text-c-muted py-2">
              No subagents configured.{' '}
              <button onClick={addSubagent} className="text-c-accent hover:underline">Add one</button>
            </div>
          )}
          {Object.entries(draft.agent.subagents).map(([name, def]) => (
            <SubagentCard
              key={name}
              name={name}
              def={def}
              onUpdate={updater => updateSubagent(name, updater)}
              onDuplicate={() => duplicateSubagent(name)}
              onDelete={() => deleteSubagent(name)}
              onRename={newName => renameSubagent(name, newName)}
            />
          ))}
        </Section>
      </div>
    </Panel>
  );
}

// ─── Subagent Card ──────────────────────────────────────────────────

function SubagentCard({
  name,
  def,
  onUpdate,
  onDuplicate,
  onDelete,
  onRename,
}: {
  name: string;
  def: SubagentDef;
  onUpdate: (updater: (s: SubagentDef) => SubagentDef) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRename: (newName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggleTool = (tool: string) => {
    onUpdate(s => ({
      ...s,
      tools: s.tools.includes(tool)
        ? s.tools.filter(t => t !== tool)
        : [...s.tools, tool],
    }));
  };

  const handleNameSubmit = () => {
    onRename(nameInput);
    setEditingName(false);
  };

  return (
    <div className="border border-c-border bg-c-surface/30 mb-1.5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 group">
        <button onClick={() => setExpanded(!expanded)} className="text-c-muted shrink-0">
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>

        {editingName ? (
          <input
            type="text"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={e => { if (e.key === 'Enter') handleNameSubmit(); if (e.key === 'Escape') { setNameInput(name); setEditingName(false); } }}
            className="cfg-input w-28 text-[10px] font-medium"
            autoFocus
          />
        ) : (
          <button
            onClick={() => { setEditingName(true); setNameInput(name); }}
            className="text-[10px] font-medium text-c-accent uppercase tracking-wider hover:text-c-accent/80 transition-colors"
            title="Click to rename"
          >
            {name}
          </button>
        )}

        <span className="text-[9px] text-c-muted">{def.model}</span>
        <span className="text-[9px] text-c-dim truncate flex-1">{def.description}</span>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onDuplicate} className="text-c-muted hover:text-c-cyan transition-colors p-0.5" title="Duplicate">
            <Copy size={10} />
          </button>
          {confirmDelete ? (
            <button
              onClick={() => { onDelete(); setConfirmDelete(false); }}
              className="text-[8px] text-c-red border border-c-red/30 px-1.5 py-px uppercase tracking-wider hover:bg-c-red/10 transition-colors"
            >
              Confirm
            </button>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              onBlur={() => setTimeout(() => setConfirmDelete(false), 200)}
              className="text-c-muted hover:text-c-red transition-colors p-0.5"
              title="Delete"
            >
              <Trash2 size={10} />
            </button>
          )}
        </div>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="px-2.5 pb-2.5 pt-1 border-t border-c-border/50 space-y-2">
          {/* Description */}
          <Field label="Description">
            <input
              type="text"
              value={def.description}
              onChange={e => onUpdate(s => ({ ...s, description: e.target.value }))}
              className="cfg-input flex-1"
              placeholder="What does this agent do?"
            />
          </Field>

          {/* Model */}
          <Field label="Model">
            <select
              value={def.model}
              onChange={e => onUpdate(s => ({ ...s, model: e.target.value }))}
              className="cfg-input w-28"
            >
              {SUBAGENT_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>

          {/* Max Turns */}
          <Field label="Max Turns">
            <input
              type="number"
              value={def.maxTurns ?? ''}
              onChange={e => {
                const val = e.target.value ? parseInt(e.target.value) : undefined;
                onUpdate(s => ({ ...s, maxTurns: val }));
              }}
              className="cfg-input w-16"
              min={1}
              max={200}
              placeholder="default"
            />
          </Field>

          {/* Tools */}
          <div>
            <span className="text-[10px] text-c-dim block mb-1">Tools</span>
            <div className="flex flex-wrap gap-1">
              {ALL_TOOLS.map(tool => {
                const enabled = def.tools.includes(tool);
                return (
                  <button
                    key={tool}
                    onClick={() => toggleTool(tool)}
                    className={`text-[8px] px-1.5 py-px border uppercase tracking-wider transition-colors ${
                      enabled
                        ? 'border-c-cyan/30 text-c-cyan bg-c-cyan/[0.06]'
                        : 'border-c-border text-c-muted hover:text-c-dim'
                    }`}
                  >
                    {tool}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Prompt */}
          <div>
            <span className="text-[10px] text-c-dim block mb-1">Prompt</span>
            <textarea
              value={def.prompt}
              onChange={e => onUpdate(s => ({ ...s, prompt: e.target.value }))}
              className="cfg-input w-full"
              rows={4}
              placeholder="System prompt for this subagent..."
              style={{ minHeight: 60, maxHeight: 200, resize: 'vertical' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function Section({ label, children, action }: { label: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[9px] font-medium uppercase tracking-[0.15em] text-c-muted mb-1.5 border-b border-c-border/50 pb-1">
        <span>{label}</span>
        {action}
      </div>
      <div className="space-y-1.5 pl-1">
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] text-c-dim w-20 shrink-0">{label}</span>
      {children}
    </div>
  );
}
