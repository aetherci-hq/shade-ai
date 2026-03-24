import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { eventBus } from './events.js';
import { getConfig } from './config.js';

export interface DailyUsage {
  date: string; // YYYY-MM-DD
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  toolCalls: number;
  conversations: number;
}

export interface UsageData {
  lifetime: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    toolCalls: number;
    conversations: number;
    sessions: number;
    firstUsed: number;
  };
  daily: DailyUsage[];
  currentSession: {
    startedAt: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    toolCalls: number;
    conversations: Set<string>;
  };
}

interface UsageFile {
  lifetime: UsageData['lifetime'];
  daily: DailyUsage[];
}

const SHADE_DIR = resolve(homedir(), '.shade');
const USAGE_PATH = resolve(SHADE_DIR, 'usage.json');
const MAX_DAILY_ENTRIES = 90; // Keep 90 days of history
const LEGACY_DIR = resolve(homedir(), '.specter');

// Auto-migrate from ~/.specter to ~/.shade on first run
function migrateFromLegacy(): void {
  if (existsSync(USAGE_PATH)) return; // already have data
  const legacyPath = resolve(LEGACY_DIR, 'usage.json');
  if (existsSync(legacyPath)) {
    mkdirSync(SHADE_DIR, { recursive: true });
    try {
      const data = readFileSync(legacyPath, 'utf-8');
      writeFileSync(USAGE_PATH, data, 'utf-8');
      console.log('[shade] Migrated usage data from ~/.specter to ~/.shade');
    } catch {}
  }
}

function today(): string {
  try {
    const tz = getConfig().timezone;
    // Format as YYYY-MM-DD in the configured timezone
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const y = parts.find(p => p.type === 'year')!.value;
    const m = parts.find(p => p.type === 'month')!.value;
    const d = parts.find(p => p.type === 'day')!.value;
    return `${y}-${m}-${d}`;
  } catch {
    // Fallback to local time if config not loaded yet
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

function loadFromDisk(): UsageFile {
  try {
    if (existsSync(USAGE_PATH)) {
      return JSON.parse(readFileSync(USAGE_PATH, 'utf-8'));
    }
  } catch {}
  return {
    lifetime: {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      toolCalls: 0,
      conversations: 0,
      sessions: 0,
      firstUsed: Date.now(),
    },
    daily: [],
  };
}

function saveToDisk(data: UsageFile): void {
  mkdirSync(SHADE_DIR, { recursive: true });
  writeFileSync(USAGE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function getOrCreateDay(daily: DailyUsage[], date: string): DailyUsage {
  let entry = daily.find(d => d.date === date);
  if (!entry) {
    entry = { date, inputTokens: 0, outputTokens: 0, costUsd: 0, toolCalls: 0, conversations: 0 };
    daily.push(entry);
    // Keep only last N days
    if (daily.length > MAX_DAILY_ENTRIES) {
      daily.splice(0, daily.length - MAX_DAILY_ENTRIES);
    }
  }
  return entry;
}

let _data: UsageData | null = null;
let _dirty = false;
let _flushTimer: ReturnType<typeof setInterval> | null = null;

export function initUsageTracker(): void {
  migrateFromLegacy();
  const persisted = loadFromDisk();

  _data = {
    lifetime: persisted.lifetime,
    daily: persisted.daily,
    currentSession: {
      startedAt: Date.now(),
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      toolCalls: 0,
      conversations: new Set(),
    },
  };

  // Increment session count
  _data.lifetime.sessions++;
  _dirty = true;

  // Listen to events
  eventBus.on('stats:usage', ({ inputTokens, outputTokens, costUsd }) => {
    if (!_data) return;
    const cost = costUsd ?? 0;

    // Session
    _data.currentSession.inputTokens += inputTokens;
    _data.currentSession.outputTokens += outputTokens;
    _data.currentSession.costUsd += cost;

    // Lifetime
    _data.lifetime.inputTokens += inputTokens;
    _data.lifetime.outputTokens += outputTokens;
    _data.lifetime.costUsd += cost;

    // Daily
    const day = getOrCreateDay(_data.daily, today());
    day.inputTokens += inputTokens;
    day.outputTokens += outputTokens;
    day.costUsd += cost;

    _dirty = true;
  });

  eventBus.on('agent:tool_call', () => {
    if (!_data) return;
    _data.currentSession.toolCalls++;
    _data.lifetime.toolCalls++;
    const day = getOrCreateDay(_data.daily, today());
    day.toolCalls++;
    _dirty = true;
  });

  eventBus.on('agent:thinking', ({ conversationId }) => {
    if (!_data) return;
    if (!_data.currentSession.conversations.has(conversationId)) {
      _data.currentSession.conversations.add(conversationId);
      _data.lifetime.conversations++;
      const day = getOrCreateDay(_data.daily, today());
      day.conversations++;
      _dirty = true;
    }
  });

  // Flush to disk every 30 seconds if dirty
  _flushTimer = setInterval(() => {
    if (_dirty && _data) {
      saveToDisk({ lifetime: _data.lifetime, daily: _data.daily });
      _dirty = false;
    }
  }, 30000);

  // Initial flush (to persist session count)
  saveToDisk({ lifetime: _data.lifetime, daily: _data.daily });
}

export function getUsageData(): UsageData | null {
  return _data;
}

export function getUsageSummary() {
  if (!_data) return null;

  const todayEntry = _data.daily.find(d => d.date === today());
  const session = _data.currentSession;

  return {
    session: {
      startedAt: session.startedAt,
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      costUsd: session.costUsd,
      toolCalls: session.toolCalls,
      conversations: session.conversations.size,
    },
    today: todayEntry ?? { date: today(), inputTokens: 0, outputTokens: 0, costUsd: 0, toolCalls: 0, conversations: 0 },
    lifetime: _data.lifetime,
    daily: _data.daily.slice(-30), // Last 30 days for charts
  };
}

export function flushUsage(): void {
  if (_dirty && _data) {
    saveToDisk({ lifetime: _data.lifetime, daily: _data.daily });
    _dirty = false;
  }
  if (_flushTimer) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }
}
