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
  llm: {
    provider: string;
    model: string;
    maxTokens: number;
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
  };
  server: {
    port: number;
    host: string;
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
