import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { getConfig } from './config.js';
import { eventBus } from './events.js';

type MemoryFile = 'MEMORY' | 'HEARTBEAT' | 'SOUL' | 'HUMAN';

const DEFAULTS: Record<MemoryFile, string> = {
  MEMORY: '# Shade Memory\n\n_No memories yet. Your agent will write notes here as it works._\n',
  HEARTBEAT: '# Standing Orders\n\n_No standing orders yet. Add tasks here for your agent to execute on each heartbeat cycle._\n',
  HUMAN: '# About Me\n\nTell your agent about yourself here. This helps it tailor responses to your context.\n',
  SOUL: '# Identity\n\nYou are Shade, a lightweight autonomous AI agent. Run `npx shade-ai init` to generate a personalized system prompt.\n',
};

function filePath(file: MemoryFile): string {
  const config = getConfig();
  return resolve(config.memory.dir, `${file}.md`);
}

export function readMemory(file: MemoryFile): string {
  const path = filePath(file);
  if (!existsSync(path)) {
    // Auto-create from defaults so the file exists for the user to customize
    const content = DEFAULTS[file];
    writeFileSync(path, content, 'utf-8');
    return content;
  }
  return readFileSync(path, 'utf-8');
}

export function writeMemory(file: MemoryFile, content: string): void {
  const path = filePath(file);
  writeFileSync(path, content, 'utf-8');
  eventBus.emit('memory:updated', { file: `${file}.md` });
}

export function appendMemory(file: MemoryFile, content: string): void {
  const path = filePath(file);
  appendFileSync(path, '\n' + content, 'utf-8');
  eventBus.emit('memory:updated', { file: `${file}.md` });
}

// Activity log (JSONL)
export function appendActivity(entry: Record<string, unknown>): void {
  const config = getConfig();
  const logPath = resolve(config.memory.stateDir, 'activity.jsonl');
  mkdirSync(dirname(logPath), { recursive: true });
  const line = JSON.stringify({ ts: Date.now(), ...entry });
  appendFileSync(logPath, line + '\n', 'utf-8');
}

export function readActivity(limit = 100): Record<string, unknown>[] {
  const config = getConfig();
  const logPath = resolve(config.memory.stateDir, 'activity.jsonl');
  if (!existsSync(logPath)) return [];
  const lines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
  return lines.slice(-limit).map(line => JSON.parse(line)).reverse();
}

// Transcript management
export function appendTranscript(conversationId: string, entry: Record<string, unknown>): void {
  const config = getConfig();
  const dir = resolve(config.memory.stateDir, 'transcripts');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${conversationId}.jsonl`);
  appendFileSync(path, JSON.stringify(entry) + '\n', 'utf-8');
}

export function readTranscript(conversationId: string): Record<string, unknown>[] {
  const config = getConfig();
  const path = resolve(config.memory.stateDir, 'transcripts', `${conversationId}.jsonl`);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

export interface ConversationInfo {
  id: string;
  messageCount: number;
  lastActivity: number;
  firstActivity: number;
}

export function listConversations(): ConversationInfo[] {
  const config = getConfig();
  const dir = resolve(config.memory.stateDir, 'transcripts');
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter(f => f.endsWith('.jsonl'));
  const conversations: ConversationInfo[] = [];

  for (const file of files) {
    const filePath = resolve(dir, file);
    const id = basename(file, '.jsonl');

    try {
      const content = readFileSync(filePath, 'utf-8').trim();
      if (!content) continue;
      const lines = content.split('\n').filter(Boolean);
      const first = JSON.parse(lines[0]);
      const last = JSON.parse(lines[lines.length - 1]);

      conversations.push({
        id,
        messageCount: lines.length,
        firstActivity: first.ts ?? statSync(filePath).birthtimeMs,
        lastActivity: last.ts ?? statSync(filePath).mtimeMs,
      });
    } catch {
      continue;
    }
  }

  // Sort by most recent first
  conversations.sort((a, b) => b.lastActivity - a.lastActivity);
  return conversations;
}
