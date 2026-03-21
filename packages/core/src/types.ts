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
  };
  tools: {
    allowed: string[];
    disallowed: string[];
    userDir: string;
  };
  guardrails: {
    blockedCommands: string[];
    blockedPaths: string[];
    maxShellTimeout: number;
    allowedHosts: string[];
    maxFileSize: number;
  };
}
