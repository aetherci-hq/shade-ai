import { useState, useEffect } from 'react';
import { Panel } from '../components/Panel';
import type { SocketEvent } from '../hooks/useSocket';

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

interface WorkspaceFile {
  name: string;
  size: number;
}

export function ToolsPanel({ events }: Props) {
  const [registered, setRegistered] = useState<RegisteredTool[]>([]);
  const [userTools, setUserTools] = useState<UserTool[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedContent, setExpandedContent] = useState<string>('');

  function refreshTools() {
    fetch('/api/tools')
      .then(r => r.json())
      .then(data => {
        setRegistered(data.registered ?? []);
        setUserTools(data.userTools ?? []);
        setWorkspaceFiles(data.workspaceFiles ?? []);
      })
      .catch(() => {});
  }

  useEffect(() => { refreshTools(); }, []);

  // Refresh when agent finishes
  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[0];
    if (latest.type === 'agent:response') refreshTools();
  }, [events]);

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

  // Build tool stats
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

  return (
    <Panel title="Tools & Workspace" className="h-full">
      {/* Registered Tools */}
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-c-muted mb-2">Registered Tools</div>
      <div className="space-y-1 mb-4">
        {registered.map(tool => {
          const s = stats.get(tool.name);
          return (
            <div key={tool.name} className="bg-c-surface border border-c-border p-2">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-c-cyan font-semibold">{tool.name}</span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-c-muted border border-c-border px-1.5 py-px">
                  {tool.type}
                </span>
                {s && (
                  <span className="ml-auto text-c-dim text-[10px]">
                    {s.calls} calls | {Math.round(s.totalMs / s.calls)}ms avg
                    {s.errors > 0 && <span className="text-c-red ml-1">{s.errors} err</span>}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-c-dim mt-1">{tool.description}</div>
            </div>
          );
        })}
      </div>

      {/* User Tools */}
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-c-muted mb-2">
        User Tools <span className="text-c-dim">({userTools.length} in tools/)</span>
      </div>
      {userTools.length === 0 ? (
        <div className="text-c-muted text-[11px] mb-4">No user tools yet. Drop .ts files in the tools/ directory.</div>
      ) : (
        <div className="space-y-1 mb-4">
          {userTools.map(tool => (
            <div key={`tool-${tool.filename}`} className="bg-c-surface border border-c-border">
              <button
                onClick={() => toggleExpand(`tool-${tool.filename}`, `/api/tools/${tool.filename}`)}
                className="w-full flex items-center justify-between p-2 text-[11px] hover:bg-c-hover transition-colors"
              >
                <span className="text-c-green font-medium">{tool.filename}</span>
                <span className="text-c-muted text-[10px]">{expanded === `tool-${tool.filename}` ? 'collapse' : 'view source'}</span>
              </button>
              {expanded === `tool-${tool.filename}` && (
                <pre className="p-2 border-t border-c-border text-[10px] text-c-dim overflow-x-auto max-h-64 overflow-y-auto whitespace-pre">
                  {expandedContent}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Workspace Files */}
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-c-muted mb-2">
        Agent-Created Files <span className="text-c-dim">({workspaceFiles.length} in workspace)</span>
      </div>
      {workspaceFiles.length === 0 ? (
        <div className="text-c-muted text-[11px] mb-4">No agent-created files yet.</div>
      ) : (
        <div className="space-y-1 mb-4">
          {workspaceFiles.map(file => (
            <div key={`ws-${file.name}`} className="bg-c-surface border border-c-border">
              <button
                onClick={() => toggleExpand(`ws-${file.name}`, `/api/workspace/${file.name}`)}
                className="w-full flex items-center justify-between p-2 text-[11px] hover:bg-c-hover transition-colors"
              >
                <span className="text-c-amber font-medium">{file.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-c-muted text-[10px]">{formatSize(file.size)}</span>
                  <span className="text-c-muted text-[10px]">{expanded === `ws-${file.name}` ? 'collapse' : 'view source'}</span>
                </div>
              </button>
              {expanded === `ws-${file.name}` && (
                <pre className="p-2 border-t border-c-border text-[10px] text-c-dim overflow-x-auto max-h-64 overflow-y-auto whitespace-pre">
                  {expandedContent}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Execution History */}
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-c-muted mb-2">Execution History</div>
      {toolEvents.length === 0 ? (
        <div className="text-c-muted text-[11px]">No tool calls yet.</div>
      ) : (
        <div className="space-y-1">
          {toolEvents.slice(0, 50).map((evt, i) => (
            <div key={`${evt.ts}-${i}`} className="flex gap-2 text-[11px]">
              <span className="text-c-muted shrink-0">
                {new Date(evt.ts).toLocaleTimeString('en-US', { hour12: false })}
              </span>
              {evt.type === 'agent:tool_call' ? (
                <>
                  <span className="text-c-cyan font-medium shrink-0">{evt.data['tool'] as string}</span>
                  <span className="text-c-dim truncate">{JSON.stringify(evt.data['input']).slice(0, 80)}</span>
                </>
              ) : (
                <>
                  <span className={`font-medium shrink-0 ${evt.data['error'] ? 'text-c-red' : 'text-c-green'}`}>
                    {evt.data['error'] ? 'FAIL' : 'OK'}
                  </span>
                  <span className="text-c-muted shrink-0">{evt.data['durationMs'] as number}ms</span>
                  <span className="text-c-dim truncate">{(evt.data['output'] as string)?.slice(0, 60)}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
