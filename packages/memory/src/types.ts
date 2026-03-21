export interface MemoryEntry {
  id: string;
  content: string;
  type: 'auto' | 'agent' | 'user';
  source: string;
  tags: string[];
  embedding: Float32Array;
  createdAt: number;
  accessedAt: number;
  importance: number;
}

export interface NewMemory {
  content: string;
  type: 'auto' | 'agent' | 'user';
  source: string;
  tags?: string[];
  importance?: number;
}

export interface ScoredMemory extends MemoryEntry {
  score: number;
}

export interface SearchOpts {
  limit?: number;
  minScore?: number;
  type?: 'auto' | 'agent' | 'user';
}

export interface MemoryStats {
  total: number;
  byType: { auto: number; agent: number; user: number };
  dbSizeBytes: number;
  oldestEntry: number | null;
  newestEntry: number | null;
}
