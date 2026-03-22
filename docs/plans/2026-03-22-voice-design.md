# ElevenLabs Voice Narration — Design

**Date:** 2026-03-22
**Status:** Approved
**Package:** `packages/voice`

## Overview

Purpose-built ElevenLabs integration that gives Specter a voice. The agent narrates responses, announces heartbeat results, and speaks errors — streaming audio chunks over WebSocket to the dashboard for real-time playback.

## Key Decisions

- **Triggers**: Configurable per-event type (responses, heartbeat, errors). Default: responses + heartbeat.
- **Audio delivery**: Stream via WebSocket binary frames. ~300ms time-to-first-byte using ElevenLabs Turbo v2.5.
- **Cost control**: Budget guards — `maxCharsPerHour` and `maxCostPerDay`. Auto-mutes when limits hit.
- **Text prep**: Truncate to ~500 chars on sentence boundary, strip markdown. Code blocks replaced with "code block omitted."
- **No SDK dependency**: Pure fetch against ElevenLabs REST API.

## Architecture

### Package: `packages/voice`

```
packages/voice/
  src/
    index.ts          — Public API, initVoice(), getVoiceEngine()
    engine.ts         — VoiceEngine class (orchestrates TTS)
    elevenlabs.ts     — ElevenLabs streaming API client
    types.ts          — VoiceConfig, audio chunk types
  package.json
```

### Data Flow

```
Event triggers (response, heartbeat, error)
  → VoiceEngine.speak(text)
  → Truncate to ~500 chars, strip markdown
  → Check budget guards
  → ElevenLabs streaming TTS API (POST, stream response body)
  → Audio chunks (MP3) emitted via eventBus 'voice:audio'
  → Server WebSocket broadcasts binary frames
  → Dashboard Web Audio API decodes and plays chunks
  → 'voice:done' JSON event signals end of utterance
```

## ElevenLabs Client

- Endpoint: `POST /v1/text-to-speech/{voiceId}/stream`
- Format: `mp3_44100_128`
- Model: `eleven_turbo_v2_5` (fastest, ~300ms TTFB)
- AsyncGenerator yields Buffer chunks as they arrive
- Error handling: 401 → disable voice, 429 → back off, network → skip silently

## VoiceEngine

- Subscribes to eventBus based on configured triggers
- `responses` → `agent:response` → speak response text
- `heartbeat` → `heartbeat:decision` → speak summary (only when acted, not idle)
- `errors` → `agent:error` → speak error message
- Budget tracking: chars/hour (resets hourly), cost/day (persisted to ~/.specter/usage.json)
- `truncateForSpeech()`: paragraph-split, ~500 char limit, sentence-boundary cut, markdown stripped

## WebSocket Audio

- Binary frames for audio chunks (separate from JSON events)
- JSON `voice:done` event marks end of utterance
- Dashboard `useVoice` hook: AudioContext, decodeAudioData, sequential queue playback
- Mute toggle in status bar (local only — server still generates for budget accuracy)

## Config

```yaml
voice:
  enabled: false
  provider: elevenlabs
  apiKey: ${ELEVENLABS_API_KEY}
  voiceId: "21m00Tcm4TlvDq8ikWAM"
  model: "eleven_turbo_v2_5"
  triggers: [responses, heartbeat]
  maxCharsPerHour: 5000
  maxCostPerDay: 1.00
```

## Integration Points

| Package | Change |
|---------|--------|
| `core/types.ts` | Add `voice` to SpecterConfig |
| `core/config.ts` | Add voice defaults |
| `core/events.ts` | Add `voice:audio`, `voice:done` events |
| `server/index.ts` | Init voice engine at startup |
| `server/ws.ts` | Broadcast binary frames for voice:audio |
| `dashboard` | useVoice hook, mute toggle in status bar |

## What Does NOT Change

- All existing functionality untouched
- When voice disabled: zero overhead, no API calls, no binary frames
- Dashboard works without voice (chunks never arrive)
- API key in .env, never exposed to frontend
