# 10x Analysis: Specter — Post-Memory, Post-Voice
Session 2 | Date: 2026-03-22

## What's Changed Since Session 1

Session 1 identified: **Memory → Presence → Voice → Platform**

Since then, we've shipped:
- **Persistent vector memory** (SQLite + local embeddings, auto-capture, semantic retrieval) — DONE
- **ElevenLabs voice** (streaming TTS, rate limiting, cost caps) — DONE
- **Human persona** (HUMAN.md, injected into system prompt) — DONE
- **Agent persona builder** (structured SOUL.md editing, Agent/Human tabs) — DONE
- **Budget tracking** (usage.json, cost per conversation) — DONE
- **Conversation persistence** (transcript storage, resume on reload) — DONE

The session 1 thesis was right. Memory and voice are shipped. The question now: **what's the next 10x move?**

## The User's Question

IFTTT/Zapier integration to extend capabilities without building integrations, or plugin infrastructure?

## The Answer: Neither — MCP Server Integration

### Why MCP Beats Both Options

| Factor | Zapier/IFTTT | Custom Plugins | MCP Servers |
|--------|-------------|----------------|-------------|
| **Latency** | High (webhooks, polling) | Low | Low (direct) |
| **Cost** | $20-50/mo subscription | Free | Free |
| **Agent control** | Trigger→action only | Full bidirectional | Full bidirectional |
| **Ecosystem** | 5000+ apps (not AI-native) | Build your own | Growing fast, AI-native |
| **Setup** | OAuth flows, web UI | Write code | Config in YAML |
| **Offline** | No | Yes | Yes (local servers) |
| **Designed for** | Deterministic automation | Custom code | LLM tool use |

**Zapier/IFTTT** is "when X happens, do Y" — deterministic pipes. Specter needs "here are tools, accomplish this goal" — agentic reasoning. Wrong abstraction.

**Custom plugin system** requires designing a plugin API, package format, loader, registry, and SDK before anyone can extend Specter. Heavy upfront investment, empty ecosystem.

**MCP** is purpose-built for giving LLMs access to external tools and data. The ecosystem already has servers for GitHub, Slack, Gmail, databases, filesystems, and hundreds more. Specter becomes an MCP client, gains access to everything, zero integration code per service.

---

## Recommended Priority

### Do Now (This week)

#### 1. Standing Orders Templates
HEARTBEAT.md is empty for every user. Ship 5-10 example templates ("Monitor a log file," "Check GitHub PRs," "Summarize RSS feeds"). One-click install from HeartbeatPanel. This activates Specter's most unique feature immediately.
- **Effort**: Low — Just markdown files + template picker
- **Score**: Must do

#### 2. Budget Forecasting in StatsPanel
Usage data exists but users can't see projected monthly cost. Add daily/weekly/monthly aggregation + forecast. Cost anxiety is the #1 blocker to enabling autonomous operation.
- **Effort**: Low — Data exists, needs chart + projection math
- **Score**: Must do

#### 3. Fix Custom Tools
`tools/*.ts` files exist on disk but aren't wired into the agent. They're display-only in the API. Fix: load, validate, register as SDK tools at startup.
- **Effort**: Medium
- **Score**: Must do — Existing broken feature

#### 4. Heartbeat Context in Chat
When user opens chat after heartbeat ran, inject recent heartbeat summaries: "While you were away, I checked X and found Y." Currently heartbeat actions log to activity but don't surface in conversation.
- **Effort**: Low — Inject last heartbeat summary into next chat prompt
- **Score**: Strong — Makes autonomous work visible

### Do Next (2-4 weeks)

#### 5. MCP Client Integration
Make Specter an MCP client. Config surface:
```yaml
mcp:
  servers:
    - name: github
      command: npx @mcp/github-server
      env:
        GITHUB_TOKEN: ${GITHUB_TOKEN}
    - name: slack
      command: npx @mcp/slack-server
      env:
        SLACK_TOKEN: ${SLACK_TOKEN}
```
Start with 3 servers: filesystem-extended, GitHub, one comms tool.
- **Effort**: Medium — Check if Claude Agent SDK already supports MCP tool providers natively
- **Unlocks**: Specter goes from 9 tools to unlimited tools
- **Score**: Must do — Single highest-leverage capability expansion

#### 6. Event-Driven Triggers
Expand heartbeat from fixed timer to reactive triggers: file watchers, cron schedules, webhooks, MCP event subscriptions.
```
"When a new PR opens on my repo, review it"
"Every weekday at 8am, prepare my brief"
"When this log file changes, analyze for errors"
```
- **Effort**: Medium-High
- **Unlocks**: Real autonomy. Heartbeat becomes reactive, not periodic.
- **Score**: Must do — The heartbeat is already the hook, this makes it smart

#### 7. Daily Brief System
First-class digest: at a configured time, agent compiles what it did overnight, what's on calendar, unread messages, PR statuses. Delivered to dashboard + spoken aloud.
- **Effort**: Low-Medium — Infrastructure exists (heartbeat, voice, memory)
- **Unlocks**: Daily habit → retention → value
- **Score**: Strong

### Explore (Month+)

#### 8. Multi-Channel Presence (Telegram)
Specter breaks out of localhost. Telegram bot that lets the agent message you and you message it. "That deploy you asked me to watch? It failed."
- **Effort**: Medium
- **Score**: Strong — but MCP + triggers come first

#### 9. Multi-Agent Orchestration
Multiple Specter agents (code assistant, infra monitor, calendar manager) that coordinate.
- **Effort**: Very High
- **Score**: Explore — Get single-agent + MCP right first

---

## Open Questions

- Does Claude Agent SDK support MCP tool providers natively?
- What's the user's primary use case — dev workflow, personal productivity, or both?
- Acceptable monthly cost ceiling for autonomous operation?

## Strategic Thesis (Updated)

Session 1: Memory → Presence → Voice → Platform
Session 2: **Memory ✓ → Voice ✓ → MCP (tools) → Triggers (autonomy) → Presence (reach)**

MCP is the platform move without building a platform. Triggers make the heartbeat intelligent. Together they turn Specter from "agent I chat with" into "agent that works for me while I sleep."
