# Local LLM Support — Intent Document

## Status: Planned (config placeholder in place)

## What
Support running Specter with a local LLM (Ollama, llama.cpp, LM Studio, etc.) instead of Claude, for privacy and cost savings.

## Config
```yaml
llm:
  provider: local                          # 'claude' or 'local'
  model: llama3.1:70b                      # model name for local provider
  baseUrl: http://localhost:11434/v1       # OpenAI-compatible endpoint
```

## Why Not Now
The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) handles tool execution, streaming, subagents, and continuations internally. It only works with Anthropic's API. Local LLMs would require:

1. **Replacing the SDK with direct API calls** — lose tool execution, subagent management, continuation logic
2. **Tool-use reliability** — as of early 2026, local models (even 70B+) still hallucinate tool calls, miss parameters, and don't follow schemas reliably. Fine for chat, broken for autonomous agent work with 9+ tools.
3. **Dual execution path** — maintaining both SDK and direct API paths adds complexity

## When
- When local models reach reliable tool-use (structured outputs, function calling with validation)
- When the Claude Agent SDK supports custom base URLs, OR we've already abstracted the agent loop
- When a user validates the use case (privacy-first deployment where Claude API is not acceptable)

## Path Forward
1. Config fields `llm.provider` and `llm.baseUrl` are already in SpecterConfig
2. Agent.run() can check provider and branch:
   - `claude` → use SDK as today
   - `local` → direct OpenAI-compatible API calls with manual tool dispatch
3. Start with chat-only (no tool use) for local models
4. Add tool use when models support it reliably
