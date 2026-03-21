export { MemoryStore } from './store.js';
export { startAutoCapture, chunkText } from './extractor.js';
export { embed, embedBatch, EMBEDDING_DIM } from './embedder.js';
export type { MemoryEntry, NewMemory, ScoredMemory, SearchOpts, MemoryStats } from './types.js';

import { resolve } from 'path';
import { mkdirSync } from 'fs';
import { getConfig } from '@specter/core';
import { MemoryStore } from './store.js';
import { startAutoCapture } from './extractor.js';

let _store: MemoryStore | null = null;

export async function initMemory(): Promise<MemoryStore> {
  if (_store) return _store;

  const config = getConfig();
  const dbDir = resolve(config.memory.stateDir);
  mkdirSync(dbDir, { recursive: true });

  const dbPath = resolve(dbDir, 'memory.db');
  const store = new MemoryStore();
  await store.init(dbPath);

  // Start auto-capture if enabled
  const memConfig = config.memory as Record<string, unknown>;
  if (memConfig.autoCapture !== false) {
    startAutoCapture(store);
  }

  _store = store;
  return store;
}

export function getMemoryStore(): MemoryStore {
  if (!_store) throw new Error('Memory not initialized. Call initMemory() first.');
  return _store;
}
