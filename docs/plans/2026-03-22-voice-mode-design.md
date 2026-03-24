# Voice Mode — Design

**Date:** 2026-03-22
**Status:** Approved
**Supersedes:** Voice narration (TTS-over-chat) approach

## Overview

A dedicated conversational voice interface for Specter. Full-screen overlay with a single animated orb, speech-to-text input via browser SpeechRecognition API, ElevenLabs streaming audio output via MediaSource API, and conversational agent responses. Not TTS bolted onto chat — a fundamentally different interaction pattern.

## Key Decisions

- **Access:** Full-screen overlay (like focus mode), triggered from mic button
- **UI:** Single animated orb with four states (idle/listening/thinking/speaking)
- **Speech input:** Tap-to-toggle with silence detection via browser SpeechRecognition
- **Agent style:** System prompt modifier for conversational 1-2 sentence responses
- **Audio playback:** Streaming via MediaSource API (not full-buffer) for minimal latency
- **Thinking state:** Amber pulsing orb, no spoken status updates (future enhancement)

## Architecture

### Components

```
Dashboard:
  hooks/useVoiceMode.ts    — Orchestrates the voice conversation loop
  hooks/useSpeechInput.ts  — Browser SpeechRecognition wrapper
  components/VoiceMode.tsx — Full-screen overlay with orb animation

Server/Voice (existing packages/voice reused):
  ElevenLabs streaming client
  Binary WebSocket frame broadcasting
```

### Conversation Loop

```
1. User taps orb → mic starts (cyan)
2. User speaks → SpeechRecognition captures text
3. Silence detected (~1.5s) → text sent via WebSocket chat:send with voiceMode: true
4. Orb goes amber (thinking)
5. Agent responds with concise conversational text
6. Response sent to ElevenLabs streaming API
7. Audio chunks stream over WebSocket as binary frames
8. MediaSource API plays audio as chunks arrive (~300ms TTFB)
9. Orb goes copper with audio-reactive glow
10. Audio ends → orb returns to idle
```

### Shared Conversation

Same `conversationId` as text chat. Switch between voice mode and text chat freely — full context preserved. Transcripts written to same JSONL files. Memory auto-capture works on voice responses too.

## Orb States

| State | Size | Color | Animation | Label |
|-------|------|-------|-----------|-------|
| Idle | 80px | Dim copper | Slow breathing glow | "Tap to speak" |
| Listening | 120px | Cyan | Pulse with mic amplitude | "Listening..." |
| Thinking | 100px | Amber | Slow pulse | (none) |
| Speaking | 140px | Copper | Audio-reactive bloom | (none) |

Transitions: 300ms CSS transitions on size, color, and box-shadow.

## Speech Input (useSpeechInput)

- Browser-native `SpeechRecognition` / `webkitSpeechRecognition`
- `continuous: false` — one utterance per activation
- `interimResults: true` — faint text below orb as you speak
- Silence detection via `onspeechend` (~1.5s)
- Tap orb or press Space to start/stop
- Returns `{ listening, transcript, supported, start, stop }`
- Unsupported browsers: show "Voice mode requires Chrome or Edge"

## Audio Playback (MediaSource API)

Stream audio chunks for minimal latency instead of buffering:

```typescript
const mediaSource = new MediaSource();
const audio = new Audio();
audio.src = URL.createObjectURL(mediaSource);

mediaSource.onsourceopen = () => {
  const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
  // Append each binary WebSocket frame to sourceBuffer as it arrives
  // On voice:done, call mediaSource.endOfStream()
};
```

This gives ~300ms time-to-first-audio vs ~1-2s with full buffering.

## System Prompt Modifier

When `voiceMode: true` in the chat:send payload:

```
## Voice Mode
The user is speaking to you by voice. Respond conversationally in 1-2
sentences. Be concise, warm, and natural. No markdown, no code blocks,
no lists, no formatting. Speak as you would to a friend.
```

Appended to existing system prompt (SOUL.md + HUMAN.md + memory). Agent retains full personality, memory, and tool access.

## Server Changes

- `agent.run()` accepts optional `voiceMode: boolean`
- WebSocket handler passes `voiceMode` flag from `chat:send`
- Voice engine triggers on voice-mode responses same as before
- No new endpoints needed

## Layout

```
┌─────────────────────────────────┐
│ [accent line]                   │
│  SPECTER · Voice Mode      dim  │
│                                 │
│           ╭──────╮              │
│           │      │              │
│           │  ◉   │              │
│           │      │              │
│           ╰──────╯              │
│        "Tap to speak"           │
│                                 │
│  ─────────────────────────────  │
│  Press Esc to exit    🔊        │
└─────────────────────────────────┘
```

## Controls

- Click orb or Space → toggle listening
- Esc → exit voice mode
- Mute button in bottom bar
- Access: mic button in Chat header + status bar

## What Does NOT Change

- Conversation infrastructure (same conversationId, transcripts, memory)
- Voice package (ElevenLabs client, binary streaming)
- Agent capabilities (tools, subagents, memory all work in voice mode)
- Existing text chat (unaffected)
