export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface HeartbeatState {
  lastRun: number;
  decision: 'idle' | 'acted';
  summary: string;
  nextRun: number;
}

export interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
  maxTurns?: number;
}

export interface SpecterConfig {
  name: string;
  timezone: string;
  llm: {
    provider: string;       // 'claude' | 'local' (local LLM support planned)
    model: string;
    maxTokens: number;
    baseUrl?: string;       // For local LLM: OpenAI-compatible endpoint (e.g. http://localhost:11434/v1)
  };
  models: {
    default: string;
    advanced: string;
    heartbeat: string;
  };
  agent: {
    maxTurns: number;
    maxBudgetUsd?: number;
    permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
    subagents?: Record<string, AgentDefinition>;
  };
  heartbeat: {
    enabled: boolean;
    intervalMinutes: number;
    model?: string;
  };
  server: {
    port: number;
    host: string;
    authToken?: string;     // API key for remote access. If set, all routes require Authorization header.
  };
  memory: {
    dir: string;
    stateDir: string;
    embedModel: string;
    autoCapture: boolean;
    maxEntries: number;
    contextLimit: number;
  };
  tools: {
    allowed: string[];
    disallowed: string[];
    userDir: string;
  };
  voice: {
    enabled: boolean;
    provider: string;
    apiKey: string;
    voiceId: string;
    model: string;
    triggers: string[];
    maxCharsPerHour: number;
    maxCostPerDay: number;
  };
  guardrails: {
    blockedCommands: string[];
    blockedPaths: string[];
    maxShellTimeout: number;
    allowedHosts: string[];
    maxFileSize: number;
  };
}
