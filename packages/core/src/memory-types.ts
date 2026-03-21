// Shared memory types used by both @specter/core and @specter/memory
// Defined here to avoid circular dependencies (core cannot depend on memory)

export interface ScoredMemory {
  id: string;
  content: string;
  type: 'auto' | 'agent' | 'user';
  source: string;
  tags: string[];
  createdAt: number;
  accessedAt: number;
  importance: number;
  score: number;
}
