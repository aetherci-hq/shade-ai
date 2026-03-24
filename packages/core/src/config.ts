import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { SpecterConfig } from './types.js';
import { eventBus } from './events.js';

function loadDotenv(baseDir: string): void {
  const envPath = resolve(baseDir, '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const DEFAULTS: SpecterConfig = {
  name: 'Shade',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  llm: { provider: 'claude', model: 'claude-sonnet-4-20250514', maxTokens: 4096 },
  models: {
    default: 'claude-sonnet-4-20250514',
    advanced: 'claude-opus-4-20250514',
    heartbeat: 'haiku',
  },
  agent: {
    maxTurns: 25,
    permissionMode: 'bypassPermissions',
    subagents: {
      researcher: {
        description: 'Research agent for web searches, information gathering, and analysis.',
        prompt: 'You are a research specialist. Search the web, gather information, and report findings concisely.',
        tools: ['WebSearch', 'WebFetch', 'Read', 'Grep', 'Glob'],
        model: 'haiku',
      },
      coder: {
        description: 'Coding agent for writing, editing, and debugging code.',
        prompt: 'You are a coding specialist. Write clean, correct code. Read existing code before modifying it.',
        tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
        model: 'sonnet',
      },
    },
  },
  heartbeat: { enabled: true, intervalMinutes: 15, model: 'haiku' },
  server: { port: 3700, host: '127.0.0.1' },
  memory: { dir: '.', stateDir: './state', embedModel: 'Xenova/all-MiniLM-L6-v2', autoCapture: true, maxEntries: 10000, contextLimit: 8 },
  tools: {
    allowed: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent'],
    disallowed: [],
    userDir: './tools',
  },
  voice: {
    enabled: false,
    provider: 'elevenlabs',
    apiKey: '',
    voiceId: '21m00Tcm4TlvDq8ikWAM',
    model: 'eleven_turbo_v2_5',
    triggers: ['responses', 'heartbeat'],
    maxCharsPerHour: 5000,
    maxCostPerDay: 1.00,
  },
  guardrails: {
    blockedCommands: ['rm -rf /', 'format', 'shutdown', 'reboot'],
    blockedPaths: ['/etc', '/System', 'C:\\Windows'],
    maxShellTimeout: 30000,
    allowedHosts: ['*'],
    maxFileSize: 1048576,
  },
};

function interpolateEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? '');
}

function deepInterpolate(obj: unknown): unknown {
  if (typeof obj === 'string') return interpolateEnv(obj);
  if (Array.isArray(obj)) return obj.map(deepInterpolate);
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = deepInterpolate(v);
    }
    return result;
  }
  return obj;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
      target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

let _config: SpecterConfig | null = null;
let _baseDir: string = '';
let _envVarRefs: Map<string, string> = new Map(); // dotpath → original "${VAR}" string

/**
 * Scan an object for string values containing ${...} env var references.
 * Records them as dotpath → original value so we can restore on write.
 */
function collectEnvVarRefs(obj: unknown, prefix = ''): void {
  if (typeof obj === 'string') {
    if (/\$\{\w+\}/.test(obj)) {
      _envVarRefs.set(prefix, obj);
    }
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => collectEnvVarRefs(item, `${prefix}.${i}`));
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      collectEnvVarRefs(v, prefix ? `${prefix}.${k}` : k);
    }
  }
}

/**
 * Restore env var references in a writeable config object before persisting to YAML.
 */
function restoreEnvVarRefs(obj: Record<string, unknown>): void {
  for (const [dotpath, original] of _envVarRefs) {
    const parts = dotpath.split('.');
    let target: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = target[parts[i]];
      if (!next || typeof next !== 'object') break;
      target = next as Record<string, unknown>;
    }
    const lastKey = parts[parts.length - 1];
    if (lastKey in target) {
      target[lastKey] = original;
    }
  }
}

export function loadConfig(baseDir: string): SpecterConfig {
  if (_config) return _config;
  _baseDir = baseDir;
  loadDotenv(baseDir);

  const configPath = resolve(baseDir, 'shade.config.yaml');
  let userConfig: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8');
    userConfig = (parseYaml(raw) as Record<string, unknown>) ?? {};
  }

  // Collect env var references before interpolation so we can restore them on write
  _envVarRefs = new Map();
  collectEnvVarRefs(userConfig);

  const interpolated = deepInterpolate(userConfig) as Record<string, unknown>;
  const merged = deepMerge(DEFAULTS as unknown as Record<string, unknown>, interpolated);

  // Resolve relative paths against baseDir (where the config file lives)
  const cfg = merged as unknown as SpecterConfig;
  cfg.memory.dir = resolve(baseDir, cfg.memory.dir);
  cfg.memory.stateDir = resolve(baseDir, cfg.memory.stateDir);
  cfg.tools.userDir = resolve(baseDir, cfg.tools.userDir);

  _config = cfg;
  return _config;
}

export function getConfig(): SpecterConfig {
  if (!_config) throw new Error('Config not loaded. Call loadConfig() first.');
  return _config;
}

/** Apply partial config updates, persist to YAML, and emit config:updated */
export function updateConfig(partial: Record<string, unknown>): SpecterConfig {
  if (!_config) throw new Error('Config not loaded. Call loadConfig() first.');

  const oldName = _config.name;

  // Deep merge partial into current config
  const updated = deepMerge(_config as unknown as Record<string, unknown>, partial) as unknown as SpecterConfig;

  // Re-resolve paths against baseDir
  updated.memory.dir = resolve(_baseDir, updated.memory.dir);
  updated.memory.stateDir = resolve(_baseDir, updated.memory.stateDir);
  updated.tools.userDir = resolve(_baseDir, updated.tools.userDir);

  _config = updated;

  // Write back to YAML (use a clean copy without resolved absolute paths)
  const configPath = resolve(_baseDir, 'shade.config.yaml');
  const writeable = JSON.parse(JSON.stringify(updated)) as Record<string, unknown>;

  // Convert absolute paths back to relative for persistence
  const mem = writeable['memory'] as Record<string, unknown>;
  if (mem) {
    mem['dir'] = relativeTo(_baseDir, updated.memory.dir);
    mem['stateDir'] = relativeTo(_baseDir, updated.memory.stateDir);
  }
  const tools = writeable['tools'] as Record<string, unknown>;
  if (tools) {
    tools['userDir'] = relativeTo(_baseDir, updated.tools.userDir);
  }

  // Restore env var references (e.g., ${ELEVENLABS_API_KEY}) so they survive writes
  restoreEnvVarRefs(writeable);

  writeFileSync(configPath, stringifyYaml(writeable, { lineWidth: 120 }), 'utf-8');

  // Emit event with list of changed top-level fields (include old name if it changed)
  const nameChanged = typeof partial['name'] === 'string' && partial['name'] !== oldName;
  eventBus.emit('config:updated', {
    fields: Object.keys(partial),
    ...(nameChanged ? { oldName, newName: _config.name } : {}),
  });

  return _config;
}

function relativeTo(base: string, absolute: string): string {
  const rel = absolute.replace(base, '').replace(/^[\\/]+/, '');
  return rel || '.';
}
