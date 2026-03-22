# Multi-Channel Messaging — Design

**Date:** 2026-03-21
**Status:** Draft (pending review)
**Package:** `packages/channels`

## Overview

Add bidirectional messaging channels to Specter so the agent can reach you (notifications) and you can reach the agent (inbound commands) from anywhere. SMS via Twilio and Telegram bot as first two channels, with a channel adapter abstraction for future expansion.

## Key Decisions

- **Outbound triggers**: Heartbeat results + explicit `notify()` — high-signal only
- **Inbound sessions**: Sticky with 30-minute timeout — natural conversational feel
- **Config**: All in `specter.config.yaml` with env var interpolation for secrets
- **Package**: New `packages/channels` with `setNotifier()` pattern (same as memory)
- **Broadcast**: `notify()` sends to all enabled channels — agent stays channel-agnostic

## Architecture

### New Package: `packages/channels`

```
packages/channels/
  src/
    index.ts          — Public API, initChannels(), getNotifier()
    types.ts          — Channel interface, message types
    adapter.ts        — ChannelManager (routes messages, manages sessions)
    sms.ts            — Twilio SMS implementation
    telegram.ts       — Telegram Bot API implementation
    webhooks.ts       — Fastify route factory for inbound webhooks
  package.json        — twilio (no telegram dep — pure fetch)
```

### Channel Interface

```typescript
interface Channel {
  name: string;
  enabled: boolean;
  send(message: string): Promise<void>;
  onMessage(handler: (text: string) => void): void;
  init(): Promise<void>;
  destroy(): void;
}
```

### Three Message Flows

1. **Heartbeat → notify** — Heartbeat cycle acts → ChannelManager broadcasts to all enabled channels
2. **Agent → notify** — Agent writes "NOTIFY: message" in response → server detects, routes through ChannelManager
3. **Inbound → agent** — User texts → webhook/poll → ChannelManager → `agent.run()` → response sent back via same channel

## Channel Manager & Sessions

ChannelManager orchestrates all channels with sticky session handling:

- Sessions keyed by channel name (one user, one session per channel)
- ConversationId prefixed with channel: `sms-{timestamp}`, `tg-{timestamp}`
- Timeout configurable: `channels.sessionTimeoutMinutes` (default 30)
- On `agent:response`, check if conversationId matches an active inbound session → route response back

## SMS via Twilio

- Outbound: `client.messages.create()` with message splitting at 1500 chars
- Inbound: Webhook at `/webhooks/sms`, returns TwiML response
- Requires public URL (ngrok/Cloudflare Tunnel for local dev)
- Plain text only — strip markdown from agent responses
- Cost tracking: log per-SMS cost to usage tracker
- Rate limit: `maxMessagesPerHour` config (default 10)

## Telegram Bot

- Outbound: Direct `fetch()` to Bot API — no npm dependency
- Inbound: Long polling via `getUpdates` — **works from localhost, no tunnel needed**
- Markdown formatting preserved (Telegram renders it natively)
- 4096 char limit (vs SMS 160) — better for detailed responses
- Chat ID discovery: logs instructions on first run if chatId not configured

## Config

```yaml
channels:
  sessionTimeoutMinutes: 30
  sms:
    enabled: false
    provider: twilio
    accountSid: ${TWILIO_ACCOUNT_SID}
    authToken: ${TWILIO_AUTH_TOKEN}
    from: "${TWILIO_PHONE_NUMBER}"
    to: "${YOUR_PHONE_NUMBER}"
    webhookPath: /webhooks/sms
    maxMessagesPerHour: 10
  telegram:
    enabled: false
    botToken: ${TELEGRAM_BOT_TOKEN}
    chatId: ${TELEGRAM_CHAT_ID}
```

## Core Integration

- `setNotifier()` in `core/agent.ts` (same pattern as `setMemoryStore()`)
- New event: `agent:notify` on eventBus
- Heartbeat calls `channelManager.notify(summary)` after acting
- Server initializes channels at startup, destroys on shutdown
- Zero overhead when no channels enabled

## Future State

- PWA with push notifications (no native app yet)
- Android native only if PWA proves insufficient
- Additional channels (Discord, Slack) use same adapter interface
