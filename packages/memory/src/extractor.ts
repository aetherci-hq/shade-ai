import { eventBus } from '@specter/core';
import type { MemoryStore } from './store.js';

const NOISY_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const MAX_TOOL_OUTPUT = 1024;

export function startAutoCapture(store: MemoryStore): void {
  eventBus.on('agent:response', async ({ conversationId, text }) => {
    if (!text || text.length < 20) return;

    const chunks = chunkText(text, 500);
    for (const chunk of chunks) {
      try {
        await store.store({
          content: chunk,
          type: 'auto',
          source: conversationId,
          importance: 0.4,
        });
      } catch (err) {
        console.error('[memory] Auto-capture error:', err);
      }
    }
  });

  eventBus.on('agent:tool_result', async ({ conversationId, tool, output }) => {
    // Skip noisy/large tool results
    if (NOISY_TOOLS.has(tool)) return;
    if (!output || output.length > MAX_TOOL_OUTPUT || output.length < 10) return;

    try {
      await store.store({
        content: `[${tool}] ${output}`,
        type: 'auto',
        source: conversationId,
        importance: 0.3,
      });
    } catch (err) {
      console.error('[memory] Auto-capture error:', err);
    }
  });
}

export function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  // Split on double newlines (paragraph boundaries) first
  const paragraphs = text.split(/\n\n+/);
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxLen && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }

    if (para.length > maxLen) {
      // Paragraph itself is too long — split on sentences
      if (current.length > 0) {
        chunks.push(current.trim());
        current = '';
      }
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (current.length + sentence.length + 1 > maxLen && current.length > 0) {
          chunks.push(current.trim());
          current = '';
        }
        current += (current ? ' ' : '') + sentence;
      }
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks;
}
