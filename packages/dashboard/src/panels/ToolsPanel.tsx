import { useState, useEffect, useCallback } from 'react';
import { Panel } from '../components/Panel';
import { Wrench, Plus, Power, Package, Settings, Check, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import type { SocketEvent } from '../hooks/useSocket';
import { authFetch } from '../auth';

interface Props {
  events: SocketEvent[];
}

interface RegisteredTool {
  name: string;
  description: string;
  type: string;
}

interface UserTool {
  name: string;
  filename: string;
  content: string;
}

interface CustomTool {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; optional?: boolean }>;
  config: Record<string, { type: string; description: string; required?: boolean }>;
  filename: string;
  enabled: boolean;
  configured: boolean;
  source?: string;
}

interface WorkspaceFile {
  name: string;
  size: number;
}

// ─── Catalog (empty — populated from registry in the future) ────────

// ─── Tool Template ──────────────────────────────────────────────────

const TOOL_TEMPLATE = `export default {
  name: 'my_tool',
  description: 'What this tool does',
  parameters: {
    input: { type: 'string', description: 'The input value' },
  },
  async execute(params: { input: string }) {
    // Your tool logic here
    return { result: params.input };
  },
};
`;

export function ToolsPanel({ events }: Props) {
  const [registered, setRegistered] = useState<RegisteredTool[]>([]);
  const [userTools, setUserTools] = useState<UserTool[]>([]);
  const [customTools, setCustomTools] = useState<CustomTool[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedContent, setExpandedContent] = useState<string>('');
  const [showCatalog, setShowCatalog] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [setupTool, setSetupTool] = useState<string | null>(null);
  const [setupValues, setSetupValues] = useState<Record<string, string>>({});
  const [setupSaved, setSetupSaved] = useState(false);
  const [registryTools, setRegistryTools] = useState<{ name: string; description: string; version: string }[]>([]);
  const [registryLoaded, setRegistryLoaded] = useState(false);
  const [showBuiltIn, setShowBuiltIn] = useState(false);
  const [activityLog, setActivityLog] = useState<{ ts: number; type: string; tool?: string; input?: Record<string, unknown>; output?: string; error?: string }[]>([]);

  const refreshTools = useCallback(() => {
    authFetch('/api/tools')
      .then(r => r.json())
      .then(data => {
        setRegistered(data.registered ?? []);
        setUserTools(data.userTools ?? []);
        setCustomTools(data.customTools ?? []);
        setWorkspaceFiles(data.workspaceFiles ?? []);
      })
      .catch(() => {});
  }, []);

  const refreshActivity = useCallback(() => {
    authFetch('/api/activity?limit=200')
      .then(r => r.json())
      .then((entries: { ts: number; type: string; tool?: string; input?: Record<string, unknown>; output?: string; error?: string }[]) => {
        // Filter to tool_call and tool_result entries only
        const toolEntries = entries.filter(e => e.type === 'tool_call' || e.type === 'tool_result');
        setActivityLog(toolEntries);
      })
      .catch(() => {});
  }, []);

  // Initial load + auto-detect poll every 5s
  useEffect(() => {
    refreshTools();
    refreshActivity();
    const timer = setInterval(refreshTools, 5000);
    const actTimer = setInterval(refreshActivity, 15000);
    return () => { clearInterval(timer); clearInterval(actTimer); };
  }, [refreshTools, refreshActivity]);

  // Browse npm registry for specter-tool-* packages
  useEffect(() => {
    fetch('https://registry.npmjs.org/-/v1/search?text=specter-tool-&size=50')
      .then(r => r.json())
      .then((data: { objects?: { package: { name: string; description: string; version: string } }[] }) => {
        const tools = (data.objects ?? [])
          .map(o => o.package)
          .filter(p => p.name.startsWith('specter-tool-'));
        setRegistryTools(tools);
        setRegistryLoaded(true);
      })
      .catch(() => setRegistryLoaded(true));
  }, []);

  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[0];
    if (latest.type === 'agent:response') { refreshTools(); refreshActivity(); }
  }, [events, refreshTools, refreshActivity]);

  const handleSetupOpen = useCallback((tool: CustomTool) => {
    setSetupTool(tool.name);
    setSetupSaved(false);
    // Load existing config
    fetch(`/api/tools/config/${tool.name}`)
      .then(r => r.json())
      .then(values => setSetupValues(values ?? {}))
      .catch(() => setSetupValues({}));
  }, []);

  const handleSetupSave = useCallback(() => {
    if (!setupTool) return;
    fetch(`/api/tools/config/${setupTool}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(setupValues),
    })
      .then(() => {
        setSetupSaved(true);
        setTimeout(() => { setSetupTool(null); setSetupSaved(false); }, 1200);
        refreshTools();
      })
      .catch(() => {});
  }, [setupTool, setupValues, refreshTools]);

  function toggleExpand(key: string, fetchUrl: string) {
    if (expanded === key) {
      setExpanded(null);
      return;
    }
    setExpanded(key);
    setExpandedContent('Loading...');
    fetch(fetchUrl)
      .then(r => r.json())
      .then(data => setExpandedContent(data.content ?? ''))
      .catch(() => setExpandedContent('Error loading file'));
  }

  const toolEvents = events.filter(e => e.type === 'agent:tool_call' || e.type === 'agent:tool_result');

  const stats = new Map<string, { calls: number; errors: number; totalMs: number }>();
  for (const evt of toolEvents) {
    if (evt.type === 'agent:tool_result') {
      const name = evt.data['tool'] as string;
      const entry = stats.get(name) ?? { calls: 0, errors: 0, totalMs: 0 };
      entry.calls++;
      entry.totalMs += evt.data['durationMs'] as number ?? 0;
      if (evt.data['error']) entry.errors++;
      stats.set(name, entry);
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    return `${(bytes / 1024).toFixed(1)}KB`;
  }

  // Split tools by origin
  const bundledTools = customTools.filter(t => t.source === 'specter');
  const agentBuiltTools = customTools.filter(t => !t.source);
  const catalogTools = customTools.filter(t => t.source && t.source !== 'specter' && t.source.startsWith('specter-tool-'));

  // Shared tool card renderer
  function renderToolCard(tool: CustomTool) {
    const hasConfig = Object.keys(tool.config).length > 0;
    const needsSetup = hasConfig && !tool.configured;
    const isSettingUp = setupTool === tool.name;

    return (
      <div key={tool.filename} className={`bg-c-surface border p-3 ${needsSetup ? 'border-c-amber/40' : 'border-c-border'}`}>
        <div className="flex items-center gap-2.5 mb-1.5">
          {needsSetup ? (
            <AlertTriangle size={12} className="text-c-amber" />
          ) : (
            <Power size={11} className={tool.enabled ? 'text-c-green' : 'text-c-muted'} />
          )}
          <span className="text-c-accent font-medium text-[13px]">{tool.name}</span>
          {tool.source === 'specter' && (
            <span className="text-[9px] text-c-cyan font-medium uppercase tracking-wider px-1.5 py-px border border-c-cyan/20">Bundled</span>
          )}
          {!tool.source && (
            <span className="text-[9px] text-c-purple font-medium uppercase tracking-wider px-1.5 py-px border border-c-purple/20">Agent-built</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {needsSetup && !isSettingUp && (
              <span className="text-[10px] text-c-amber font-medium uppercase tracking-wider">Needs setup</span>
            )}
            {hasConfig && (
              <button
                onClick={() => isSettingUp ? setSetupTool(null) : handleSetupOpen(tool)}
                className="text-[10px] text-c-muted border border-c-border px-2 py-0.5 hover:text-c-accent hover:border-c-accent/25 transition-colors flex items-center gap-1 uppercase tracking-wider"
              >
                <Settings size={9} /> {isSettingUp ? 'Close' : tool.configured ? 'Configure' : 'Setup'}
              </button>
            )}
            {tool.source && (
              <span className="text-[9px] text-c-muted font-mono bg-c-hover px-1.5 py-0.5 border border-c-border">{tool.source}</span>
            )}
          </div>
        </div>
        <div className="text-[12px] text-c-dim mb-2">{tool.description}</div>

        {/* Setup form */}
        {isSettingUp && (
          <div className="mt-3 pt-3 border-t border-c-border animate-fade-in">
            <div className="text-[11px] text-c-text font-medium uppercase tracking-wider mb-3">Tool Configuration</div>
            <div className="space-y-2.5">
              {Object.entries(tool.config).map(([key, field]) => (
                <div key={key}>
                  <label className="text-[11px] text-c-dim mb-1 block">
                    {field.description} {field.required && <span className="text-c-amber">*</span>}
                  </label>
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={setupValues[key] ?? ''}
                    onChange={e => setSetupValues(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={key}
                    className="w-full bg-c-bg border border-c-border px-3 py-1.5 text-[12px] text-c-text font-mono outline-none focus:border-c-accent/30"
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleSetupSave}
                className={`flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider px-3 py-1 border transition-all ${
                  setupSaved
                    ? 'text-c-accent border-c-accent bg-c-accent/10'
                    : 'text-c-accent border-c-accent/30 hover:bg-c-accent/5'
                }`}
              >
                <Check size={10} /> {setupSaved ? 'Saved' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {/* Parameters */}
        {!isSettingUp && Object.keys(tool.parameters).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(tool.parameters).map(([key, p]) => (
              <span key={key} className="text-[10px] text-c-muted px-2 py-0.5 bg-c-hover border border-c-border">
                {key}{p.optional ? '?' : ''}: <span className="text-c-cyan">{p.type}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Panel title="Tools & Workspace" className="h-full">
      {/* Custom Tools — bundled + agent-created */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-c-accent flex items-center gap-2">
          <Wrench size={12} />
          Custom Tools
          <span className="text-c-dim font-normal">({bundledTools.length + agentBuiltTools.length})</span>
        </div>
        <button
          onClick={() => setShowTemplate(!showTemplate)}
          className="flex items-center gap-1.5 text-[11px] text-c-muted border border-c-border px-2.5 py-1 hover:text-c-accent hover:border-c-accent/25 transition-colors uppercase tracking-wider font-medium"
        >
          <Plus size={10} /> New Tool
        </button>
      </div>

      {showTemplate && (
        <div className="mb-4 animate-fade-in">
          <div className="text-[11px] text-c-dim mb-2">
            Create a new <code className="text-c-cyan bg-c-surface px-1">.ts</code> file in the <code className="text-c-cyan bg-c-surface px-1">tools/</code> directory with this format:
          </div>
          <pre className="bg-c-surface border border-c-border p-4 text-[12px] text-c-dim overflow-x-auto leading-relaxed">
            {TOOL_TEMPLATE}
          </pre>
          <div className="text-[11px] text-c-muted mt-2">
            The agent will discover it automatically and can call it via Bash.
          </div>
        </div>
      )}

      {bundledTools.length + agentBuiltTools.length === 0 ? (
        <div className="text-c-muted text-[12px] mb-5 bg-c-surface border border-c-border p-4">
          No custom tools yet. Drop <code className="text-c-cyan">.ts</code> files in <code className="text-c-cyan">tools/</code> or click New Tool above.
          <br /><span className="text-[11px]">Specter will also create tools here when you ask it to build a capability.</span>
        </div>
      ) : (
        <div className="space-y-2 mb-5">
          {bundledTools.map(renderToolCard)}
          {agentBuiltTools.map(renderToolCard)}
        </div>
      )}

      {/* Tool Catalog — npm ecosystem */}
      <div className="mb-3 mt-6 pt-4 border-t border-c-border">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-c-accent flex items-center gap-2 mb-2">
          <Package size={12} />
          Tool Catalog
        </div>
        <div className="text-[12px] text-c-dim leading-relaxed mb-3">
          Install tools from the ecosystem: <code className="text-c-cyan bg-c-hover px-1.5 py-0.5">npx specter-tool-&lt;name&gt;</code>
        </div>
      </div>

      {/* Installed catalog tools */}
      {catalogTools.length > 0 && (
        <div className="space-y-2 mb-4">
          {catalogTools.map(renderToolCard)}
        </div>
      )}

      {/* Available from registry (not yet installed) */}
      {registryLoaded && (() => {
        const installedSources = new Set(catalogTools.map(t => t.source));
        const available = registryTools.filter(r => !installedSources.has(r.name));
        if (available.length === 0 && catalogTools.length === 0) {
          return (
            <div className="text-c-muted text-[12px] mb-5 bg-c-surface border border-c-border p-4">
              No tools found on npm yet. Be the first to publish a <code className="text-c-cyan">specter-tool-*</code> package.
            </div>
          );
        }
        if (available.length === 0) return null;
        return (
          <div className="space-y-1.5 mb-5">
            <div className="text-[10px] text-c-muted uppercase tracking-wider mb-2">Available</div>
            {available.map(pkg => (
              <div key={pkg.name} className="bg-c-surface border border-c-border p-3 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-[13px] text-c-text font-medium">{pkg.name.replace('specter-tool-', '')}</div>
                  <div className="text-[11px] text-c-dim truncate">{pkg.description}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-4">
                  <span className="text-[9px] text-c-muted">v{pkg.version}</span>
                  <code className="text-[10px] text-c-cyan bg-c-hover px-2 py-0.5 border border-c-border font-mono">npx {pkg.name}</code>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Claude Agent SDK Tools — collapsible reference */}
      <div className="mt-6 pt-4 border-t border-c-border">
        <button
          onClick={() => setShowBuiltIn(!showBuiltIn)}
          className="flex items-center gap-2 w-full text-left py-1 group mb-2"
        >
          {showBuiltIn ? <ChevronDown size={11} className="text-c-muted" /> : <ChevronRight size={11} className="text-c-muted" />}
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-c-muted group-hover:text-c-dim transition-colors">
            Claude Agent SDK Tools
          </span>
          <span className="text-[10px] text-c-muted">({registered.length})</span>
          <div className="flex-1 border-b border-c-border/50 ml-3 mb-0.5" />
        </button>

        {showBuiltIn && (
          <div className="animate-fade-in">
            <div className="text-[11px] text-c-dim mb-3">
              Core tools provided by the Claude Agent SDK. Configured in <code className="text-c-cyan bg-c-surface px-1">shade.config.yaml</code> under <code className="text-c-cyan bg-c-surface px-1">tools.allowed</code>.
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {registered.map(tool => {
                const s = stats.get(tool.name);
                return (
                  <span key={tool.name} className="text-[11px] text-c-cyan px-2.5 py-1 bg-c-surface border border-c-border flex items-center gap-1.5">
                    {tool.name}
                    {s && <span className="text-[9px] text-c-muted">{s.calls}</span>}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Workspace Files */}
      {workspaceFiles.length > 0 && (
        <div className="mt-4 pt-4 border-t border-c-border">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-c-muted mb-3">
            Agent-Created Files <span className="text-c-dim">({workspaceFiles.length})</span>
          </div>
          <div className="space-y-1.5">
            {workspaceFiles.map(file => (
              <div key={`ws-${file.name}`} className="bg-c-surface border border-c-border">
                <button
                  onClick={() => toggleExpand(`ws-${file.name}`, `/api/workspace/${file.name}`)}
                  className="w-full flex items-center justify-between p-2.5 text-[12px] hover:bg-c-hover transition-colors"
                >
                  <span className="text-c-amber font-medium">{file.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-c-muted text-[11px]">{formatSize(file.size)}</span>
                    <span className="text-c-muted text-[11px]">{expanded === `ws-${file.name}` ? 'collapse' : 'view'}</span>
                  </div>
                </button>
                {expanded === `ws-${file.name}` && (
                  <pre className="p-3 border-t border-c-border text-[11px] text-c-dim overflow-x-auto max-h-64 overflow-y-auto whitespace-pre leading-relaxed">
                    {expandedContent}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Execution History — persisted from activity log */}
      <div className="mt-6 pt-4 border-t border-c-border">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-c-muted mb-3">
          Execution History
          {activityLog.length > 0 && <span className="text-c-dim font-normal ml-1">({activityLog.length})</span>}
        </div>
        {activityLog.length === 0 ? (
          <div className="text-c-muted text-[12px]">No tool calls recorded yet.</div>
        ) : (
          <div className="space-y-1">
            {activityLog.slice(0, 100).map((entry, i) => (
              <div key={`${entry.ts}-${i}`} className="flex gap-2.5 text-[12px]">
                <span className="text-c-muted shrink-0 w-20">
                  {new Date(entry.ts).toLocaleString('en-US', { hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                {entry.type === 'tool_call' ? (
                  <>
                    <span className="text-c-cyan font-medium shrink-0">{entry.tool}</span>
                    <span className="text-c-dim truncate">{entry.input ? JSON.stringify(entry.input).slice(0, 80) : ''}</span>
                  </>
                ) : (
                  <>
                    <span className={`font-medium shrink-0 ${entry.error ? 'text-c-red' : 'text-c-green'}`}>
                      {entry.error ? 'FAIL' : 'OK'}
                    </span>
                    <span className="text-c-cyan font-medium shrink-0">{entry.tool}</span>
                    <span className="text-c-dim truncate">{entry.output?.slice(0, 60) ?? ''}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
