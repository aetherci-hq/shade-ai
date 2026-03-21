import { useState, useEffect, useCallback } from 'react';
import { Panel } from '../components/Panel';
import { Search, Plus, Trash2, Brain, FileText, BarChart3, X } from 'lucide-react';

type Tab = 'notes' | 'recall' | 'stats';
type MemoryFile = 'MEMORY' | 'HEARTBEAT';
const FILES: MemoryFile[] = ['MEMORY', 'HEARTBEAT'];

interface MemoryEntry {
  id: string;
  content: string;
  type: 'auto' | 'agent' | 'user';
  source: string;
  tags: string[];
  importance: number;
  score?: number;
  createdAt: number;
}

interface MemoryStats {
  total: number;
  byType: { auto: number; agent: number; user: number };
  dbSizeBytes: number;
  oldestEntry: number | null;
  newestEntry: number | null;
}

interface Props {
  onSave: (file: string, content: string) => void;
  onLoad: (file: string) => void;
  memoryContent: Record<string, string>;
}

const TYPE_COLORS: Record<string, string> = {
  auto: 'text-c-cyan border-c-cyan/30 bg-c-cyan/5',
  agent: 'text-c-accent border-c-accent/30 bg-c-accent/5',
  user: 'text-c-purple border-c-purple/30 bg-c-purple/5',
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// --- Notes Tab (existing editor) ---

function NotesTab({ onSave, onLoad, memoryContent }: Props) {
  const [activeFile, setActiveFile] = useState<MemoryFile>('MEMORY');
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => { onLoad(activeFile); }, [activeFile, onLoad]);

  useEffect(() => {
    const loaded = memoryContent[activeFile];
    if (loaded !== undefined && !dirty) {
      setContent(loaded);
    }
  }, [memoryContent, activeFile, dirty]);

  function handleSave() {
    onSave(activeFile, content);
    setDirty(false);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-px border-b border-c-border">
          {FILES.map(file => (
            <button
              key={file}
              onClick={() => { setActiveFile(file); setDirty(false); }}
              className={`px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.1em] transition-colors ${
                activeFile === file
                  ? 'text-c-accent border-b border-c-accent bg-c-accent/5'
                  : 'text-c-muted hover:text-c-dim'
              }`}
            >
              {file}.md
            </button>
          ))}
        </div>
        {dirty && <span className="text-c-amber text-[9px] font-medium uppercase tracking-wider">Unsaved</span>}
      </div>

      <textarea
        value={content}
        onChange={e => { setContent(e.target.value); setDirty(true); }}
        className="w-full bg-c-surface border border-c-border p-3 text-c-text font-mono text-xs resize-none outline-none focus:border-c-accent/25 flex-1"
        style={{ caretColor: 'var(--color-c-accent)', minHeight: '200px' }}
        spellCheck={false}
      />

      <div className="flex justify-end mt-2">
        <button
          onClick={handleSave}
          disabled={!dirty}
          className="px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.15em] border transition-colors disabled:opacity-30 disabled:cursor-not-allowed border-c-accent text-c-accent bg-c-accent/5 hover:bg-c-accent/10"
        >
          Save
        </button>
      </div>
    </div>
  );
}

// --- Recall Tab ---

function RecallTab() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Load recent on mount
  useEffect(() => {
    fetch('/api/memories?limit=20')
      .then(r => r.json())
      .then(setResults)
      .catch(() => {});
  }, []);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) {
      setHasSearched(false);
      fetch('/api/memories?limit=20')
        .then(r => r.json())
        .then(setResults)
        .catch(() => {});
      return;
    }
    setLoading(true);
    setHasSearched(true);
    try {
      const res = await fetch(`/api/memories/search?q=${encodeURIComponent(query)}&limit=15`);
      const data = await res.json();
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  };

  const handleForget = async (id: string) => {
    try {
      await fetch(`/api/memories/${id}`, { method: 'DELETE' });
      setResults(prev => prev.filter(m => m.id !== id));
    } catch {}
  };

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Search bar */}
      <div className="flex gap-1.5">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-c-muted" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search memories..."
            className="w-full bg-c-surface border border-c-border pl-8 pr-3 py-1.5 text-[11px] text-c-text outline-none focus:border-c-accent/25 placeholder:text-c-muted"
            style={{ caretColor: 'var(--color-c-accent)' }}
          />
        </div>
        <button
          onClick={handleSearch}
          className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider border border-c-accent text-c-accent bg-c-accent/5 hover:bg-c-accent/10 transition-colors"
        >
          Recall
        </button>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto space-y-1.5">
        {loading && (
          <div className="text-c-muted text-[10px] text-center py-8 uppercase tracking-wider">Searching...</div>
        )}
        {!loading && results.length === 0 && (
          <div className="text-c-muted text-[10px] text-center py-8">
            {hasSearched ? 'No memories match that query.' : 'No memories yet. Start chatting — Specter remembers.'}
          </div>
        )}
        {!loading && results.map(entry => (
          <div key={entry.id} className="bg-c-surface border border-c-border p-2.5 group hover:border-c-border/80 transition-colors">
            {/* Header row */}
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className={`text-[8px] font-medium uppercase tracking-wider px-1.5 py-0.5 border ${TYPE_COLORS[entry.type]}`}>
                  {entry.type}
                </span>
                <span className="text-c-muted text-[9px]">{timeAgo(entry.createdAt)}</span>
                {entry.score !== undefined && hasSearched && (
                  <span className="text-c-cyan text-[9px] font-mono">{entry.score.toFixed(2)}</span>
                )}
              </div>
              <button
                onClick={() => handleForget(entry.id)}
                className="opacity-0 group-hover:opacity-100 text-c-muted hover:text-c-red transition-all p-0.5"
                title="Forget this memory"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>

            {/* Content */}
            <div className="text-c-text text-[11px] leading-relaxed">
              {entry.content.length > 300 ? entry.content.slice(0, 300) + '...' : entry.content}
            </div>

            {/* Tags & meta */}
            {(entry.tags.length > 0 || entry.source !== 'agent') && (
              <div className="flex items-center gap-2 mt-1.5">
                {entry.tags.map(tag => (
                  <span key={tag} className="text-[8px] text-c-dim uppercase tracking-wider">#{tag}</span>
                ))}
                {entry.source && entry.source !== 'agent' && entry.source !== 'dashboard' && (
                  <span className="text-[8px] text-c-muted font-mono">{entry.source}</span>
                )}
              </div>
            )}

            {/* Importance bar */}
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-px bg-c-border">
                <div
                  className="h-px bg-c-accent/40"
                  style={{ width: `${entry.importance * 100}%` }}
                />
              </div>
              <span className="text-[8px] text-c-muted font-mono">{entry.importance.toFixed(1)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Stats Tab ---

function StatsTab() {
  const [stats, setStats] = useState<MemoryStats | null>(null);

  useEffect(() => {
    fetch('/api/memories/stats')
      .then(r => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  if (!stats) {
    return <div className="text-c-muted text-[10px] text-center py-8 uppercase tracking-wider">Loading...</div>;
  }

  const total = stats.total || 1; // avoid division by zero

  return (
    <div className="space-y-4">
      {/* Total count */}
      <div className="bg-c-surface border border-c-border p-3">
        <div className="text-c-muted text-[9px] uppercase tracking-wider mb-1">Total Memories</div>
        <div className="text-c-accent text-[24px] font-medium">{stats.total}</div>
      </div>

      {/* Type breakdown */}
      <div className="grid grid-cols-3 gap-1.5">
        {(['auto', 'agent', 'user'] as const).map(type => (
          <div key={type} className="bg-c-surface border border-c-border p-2.5">
            <div className="text-c-muted text-[8px] uppercase tracking-wider mb-1">{type}</div>
            <div className={`text-[18px] font-medium ${type === 'auto' ? 'text-c-cyan' : type === 'agent' ? 'text-c-accent' : 'text-c-purple'}`}>
              {stats.byType[type]}
            </div>
            <div className="mt-1.5 h-px bg-c-border">
              <div
                className={`h-px ${type === 'auto' ? 'bg-c-cyan/50' : type === 'agent' ? 'bg-c-accent/50' : 'bg-c-purple/50'}`}
                style={{ width: `${(stats.byType[type] / total) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Details */}
      <div className="bg-c-surface border border-c-border p-3 space-y-2">
        <div className="flex justify-between text-[10px]">
          <span className="text-c-muted uppercase tracking-wider">Database size</span>
          <span className="text-c-text font-mono">{formatBytes(stats.dbSizeBytes)}</span>
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-c-muted uppercase tracking-wider">Oldest memory</span>
          <span className="text-c-text font-mono">
            {stats.oldestEntry ? new Date(stats.oldestEntry).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
          </span>
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-c-muted uppercase tracking-wider">Newest memory</span>
          <span className="text-c-text font-mono">
            {stats.newestEntry ? timeAgo(stats.newestEntry) : '—'}
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[9px]">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 bg-c-cyan/50" />
          <span className="text-c-dim uppercase tracking-wider">Auto-captured</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 bg-c-accent/50" />
          <span className="text-c-dim uppercase tracking-wider">Agent-remembered</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 bg-c-purple/50" />
          <span className="text-c-dim uppercase tracking-wider">User-added</span>
        </div>
      </div>
    </div>
  );
}

// --- Add Memory Modal ---

function AddMemoryForm({ onClose }: { onClose: () => void }) {
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
      await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, tags: tagList.length ? tagList : undefined }),
      });
      onClose();
    } catch {} finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-c-surface border border-c-accent/20 p-3 mb-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-c-accent font-medium uppercase tracking-wider">Add Memory</span>
        <button onClick={onClose} className="text-c-muted hover:text-c-dim"><X className="w-3 h-3" /></button>
      </div>
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="What should Specter remember?"
        className="w-full bg-c-bg border border-c-border p-2 text-[11px] text-c-text outline-none focus:border-c-accent/25 resize-none h-20"
        style={{ caretColor: 'var(--color-c-accent)' }}
        autoFocus
      />
      <input
        type="text"
        value={tags}
        onChange={e => setTags(e.target.value)}
        placeholder="Tags (comma-separated, optional)"
        className="w-full bg-c-bg border border-c-border px-2 py-1.5 text-[10px] text-c-text outline-none focus:border-c-accent/25 placeholder:text-c-muted"
      />
      <div className="flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={!content.trim() || saving}
          className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider border border-c-accent text-c-accent bg-c-accent/5 hover:bg-c-accent/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Remember'}
        </button>
      </div>
    </div>
  );
}

// --- Main Panel ---

export function MemoryPanel({ onSave, onLoad, memoryContent }: Props) {
  const [tab, setTab] = useState<Tab>('recall');
  const [showAddForm, setShowAddForm] = useState(false);

  const tabs: { id: Tab; label: string; icon: typeof Brain }[] = [
    { id: 'recall', label: 'Recall', icon: Brain },
    { id: 'notes', label: 'Notes', icon: FileText },
    { id: 'stats', label: 'Stats', icon: BarChart3 },
  ];

  return (
    <Panel
      title="Memory"
      status={
        <button
          onClick={() => { setTab('recall'); setShowAddForm(true); }}
          className="flex items-center gap-1 text-[9px] text-c-accent hover:text-c-accent/80 uppercase tracking-wider transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add
        </button>
      }
      className="h-full flex flex-col"
    >
      {/* Tab bar */}
      <div className="flex gap-px mb-2 border-b border-c-border">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.1em] transition-colors ${
                tab === t.id
                  ? 'text-c-accent border-b border-c-accent bg-c-accent/5'
                  : 'text-c-muted hover:text-c-dim'
              }`}
            >
              <Icon className="w-3 h-3" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Add memory form */}
      {showAddForm && tab === 'recall' && (
        <AddMemoryForm onClose={() => setShowAddForm(false)} />
      )}

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {tab === 'notes' && <NotesTab onSave={onSave} onLoad={onLoad} memoryContent={memoryContent} />}
        {tab === 'recall' && <RecallTab />}
        {tab === 'stats' && <StatsTab />}
      </div>
    </Panel>
  );
}
