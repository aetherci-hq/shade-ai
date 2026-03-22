import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

let _baseDir = '';

export function initKeys(baseDir: string): void {
  _baseDir = baseDir;
}

/** Known API keys Specter manages */
const MANAGED_KEYS = [
  'ANTHROPIC_API_KEY',
  'ELEVENLABS_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
] as const;

export type ManagedKey = (typeof MANAGED_KEYS)[number];

export interface KeyStatus {
  key: string;
  set: boolean;
  masked: string; // '•••••abc12' or '' if not set
  label: string;
  group: string;
}

const KEY_META: Record<string, { label: string; group: string }> = {
  ANTHROPIC_API_KEY: { label: 'Anthropic API Key', group: 'Core' },
  ELEVENLABS_API_KEY: { label: 'ElevenLabs API Key', group: 'Voice' },
  TWILIO_ACCOUNT_SID: { label: 'Account SID', group: 'Twilio' },
  TWILIO_AUTH_TOKEN: { label: 'Auth Token', group: 'Twilio' },
  TWILIO_PHONE_NUMBER: { label: 'Phone Number', group: 'Twilio' },
  TELEGRAM_BOT_TOKEN: { label: 'Bot Token', group: 'Telegram' },
  TELEGRAM_CHAT_ID: { label: 'Chat ID', group: 'Telegram' },
};

function envPath(): string {
  return resolve(_baseDir, '.env');
}

function readEnvFile(): Map<string, string> {
  const path = envPath();
  const entries = new Map<string, string>();
  if (!existsSync(path)) return entries;

  const lines = readFileSync(path, 'utf-8').split('\n');
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
    entries.set(key, value);
  }
  return entries;
}

function writeEnvFile(entries: Map<string, string>): void {
  const path = envPath();
  const lines: string[] = [];

  // Preserve comments and non-managed keys from existing file
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf-8').split('\n');
    for (const line of existing) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        lines.push(line);
        continue;
      }
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) {
        lines.push(line);
        continue;
      }
      const key = trimmed.slice(0, eqIndex).trim();
      // Skip managed keys — we'll write them fresh below
      if (entries.has(key)) continue;
      // Keep non-managed keys as-is
      lines.push(line);
    }
  }

  // Append managed keys
  for (const [key, value] of entries) {
    lines.push(`${key}=${value}`);
  }

  writeFileSync(path, lines.join('\n') + '\n', 'utf-8');
}

function maskValue(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return '•'.repeat(Math.min(value.length - 4, 12)) + value.slice(-4);
}

/** Get status of all managed keys */
export function getKeyStatuses(): KeyStatus[] {
  const env = readEnvFile();

  return MANAGED_KEYS.map(key => {
    const value = env.get(key) ?? process.env[key] ?? '';
    const meta = KEY_META[key] ?? { label: key, group: 'Other' };
    return {
      key,
      set: !!value,
      masked: maskValue(value),
      label: meta.label,
      group: meta.group,
    };
  });
}

/** Set one or more keys. Writes to .env and updates process.env. */
export function setKeys(updates: Record<string, string>): void {
  const env = readEnvFile();

  for (const [key, value] of Object.entries(updates)) {
    if (!MANAGED_KEYS.includes(key as ManagedKey)) continue;
    if (value) {
      env.set(key, value);
      process.env[key] = value;
    } else {
      env.delete(key);
      delete process.env[key];
    }
  }

  writeEnvFile(env);
}
