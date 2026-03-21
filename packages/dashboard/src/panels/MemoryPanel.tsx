import { useState, useEffect } from 'react';
import { Panel } from '../components/Panel';

type MemoryFile = 'MEMORY' | 'HEARTBEAT';
const FILES: MemoryFile[] = ['MEMORY', 'HEARTBEAT'];

interface Props {
  onSave: (file: string, content: string) => void;
  onLoad: (file: string) => void;
  memoryContent: Record<string, string>;
}

export function MemoryPanel({ onSave, onLoad, memoryContent }: Props) {
  const [activeFile, setActiveFile] = useState<MemoryFile>('MEMORY');
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    onLoad(activeFile);
  }, [activeFile, onLoad]);

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
    <Panel
      title="Memory Files"
      status={dirty ? <span className="text-c-amber font-medium uppercase tracking-wider">Unsaved</span> : undefined}
      className="h-full flex flex-col"
    >
      {/* Tab bar */}
      <div className="flex gap-px mb-2 border-b border-c-border">
        {FILES.map(file => (
          <button
            key={file}
            onClick={() => setActiveFile(file)}
            className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors ${
              activeFile === file
                ? 'text-c-green border-b-2 border-c-green bg-c-green/5'
                : 'text-c-muted hover:text-c-dim'
            }`}
          >
            {file}.md
          </button>
        ))}
      </div>

      {/* Editor */}
      <textarea
        value={content}
        onChange={e => { setContent(e.target.value); setDirty(true); }}
        className="w-full bg-c-surface border border-c-border p-3 text-c-text font-mono text-xs resize-none outline-none focus:border-c-green/30"
        style={{ caretColor: 'var(--color-c-green)', minHeight: 'calc(100vh - 200px)', flex: '1 1 0' }}
        spellCheck={false}
      />

      {/* Save */}
      <div className="flex justify-end mt-2">
        <button
          onClick={handleSave}
          disabled={!dirty}
          className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] border transition-colors disabled:opacity-30 disabled:cursor-not-allowed border-c-green text-c-green bg-c-green/10 hover:bg-c-green/15"
        >
          Save
        </button>
      </div>
    </Panel>
  );
}
