import { useState, useEffect } from 'react';
import { Panel } from '../components/Panel';

export function ConfigPanel() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  return (
    <Panel title="Configuration" className="h-full">
      {config ? (
        <pre className="text-[11px] text-c-dim whitespace-pre-wrap">
          {JSON.stringify(config, null, 2)}
        </pre>
      ) : (
        <div className="text-c-muted">Loading config...</div>
      )}
    </Panel>
  );
}
