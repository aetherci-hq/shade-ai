import { eventBus } from '@specter/core';
import { ElevenLabsClient, ElevenLabsError } from './elevenlabs.js';
import type { VoiceConfig } from './types.js';

const COST_PER_1K_CHARS = 0.30;

export class VoiceEngine {
  private client: ElevenLabsClient;
  private triggers: Set<string>;
  private maxCharsPerHour: number;
  private maxCostPerDay: number;
  private charsThisHour = 0;
  private costToday = 0;
  private disabled = false;
  private speaking = false;
  private hourResetTimer: ReturnType<typeof setInterval> | null = null;
  private pendingText = '';  // accumulated text from streaming deltas

  constructor(config: VoiceConfig) {
    this.client = new ElevenLabsClient(config.apiKey, config.voiceId, config.model);
    this.triggers = new Set(config.triggers);
    this.maxCharsPerHour = config.maxCharsPerHour;
    this.maxCostPerDay = config.maxCostPerDay;
  }

  start(): void {
    if (this.triggers.has('responses')) {
      // Accumulate streaming text deltas
      eventBus.on('agent:text_delta', ({ conversationId, delta }) => {
        if (conversationId.startsWith('heartbeat')) return;
        this.pendingText += delta;
      });

      // When a tool call arrives, speak the accumulated intermediate text block
      eventBus.on('agent:tool_call', ({ conversationId }) => {
        if (conversationId.startsWith('heartbeat')) return;
        this.flushPendingText();
      });

      // Final response — speak any remaining accumulated text (the last text block)
      eventBus.on('agent:response', ({ conversationId }) => {
        if (conversationId.startsWith('heartbeat')) return;
        this.flushPendingText();
      });

      // Reset accumulator when agent starts thinking
      eventBus.on('agent:thinking', () => {
        this.pendingText = '';
      });
    }

    if (this.triggers.has('heartbeat')) {
      eventBus.on('heartbeat:decision', ({ action, reason }) => {
        if (action !== 'idle') {
          this.speak(reason).catch(err => console.error('[voice] Error:', err));
        }
      });
    }

    if (this.triggers.has('errors')) {
      eventBus.on('agent:error', ({ error }) => {
        this.speak(`Error: ${error}`).catch(err => console.error('[voice] Error:', err));
      });
    }

    // Reset hourly char count
    this.hourResetTimer = setInterval(() => {
      this.charsThisHour = 0;
    }, 3600_000);

    console.log(`[voice] Listening for: ${[...this.triggers].join(', ')}`);
  }

  private flushPendingText(): void {
    const text = this.pendingText.trim();
    this.pendingText = '';
    if (text && text !== 'IDLE') {
      this.speak(text).catch(err => console.error('[voice] Error:', err));
    }
  }

  async speak(text: string): Promise<void> {
    if (this.disabled || this.speaking) return;

    const narration = truncateForSpeech(text, 2000);
    if (!narration) return;

    // Budget checks
    if (this.charsThisHour + narration.length > this.maxCharsPerHour) {
      console.log('[voice] Hourly character limit reached, skipping');
      return;
    }

    const estimatedCost = (narration.length / 1000) * COST_PER_1K_CHARS;
    if (this.costToday + estimatedCost > this.maxCostPerDay) {
      console.log('[voice] Daily cost limit reached, skipping');
      return;
    }

    // Track usage
    this.charsThisHour += narration.length;
    this.costToday += estimatedCost;
    this.speaking = true;

    try {
      for await (const chunk of this.client.stream(narration)) {
        eventBus.emit('voice:audio' as any, { chunk });
      }
      eventBus.emit('voice:done' as any, {});
    } catch (err) {
      if (err instanceof ElevenLabsError) {
        if (err.kind === 'auth') {
          console.error('[voice] Invalid API key — disabling voice for this session');
          this.disabled = true;
        } else if (err.kind === 'rate_limit') {
          console.warn('[voice] Rate limited, skipping');
        } else {
          console.error('[voice] API error:', err.message);
        }
      } else {
        console.error('[voice] Network error, skipping');
      }
    } finally {
      this.speaking = false;
    }
  }

  stop(): void {
    if (this.hourResetTimer) {
      clearInterval(this.hourResetTimer);
      this.hourResetTimer = null;
    }
  }
}

/**
 * Prepare text for speech: strip markdown, truncate on sentence boundary.
 */
function truncateForSpeech(text: string, maxLen: number): string {
  let clean = text
    // Remove code blocks entirely
    .replace(/```[\s\S]*?```/g, ' code block omitted ')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Remove markdown headers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic markers
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    // Remove links, keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove bullet markers
    .replace(/^[-*]\s+/gm, '')
    // Collapse multiple newlines
    .replace(/\n{2,}/g, '\n')
    // Collapse multiple spaces
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (clean.length <= maxLen) return clean;

  // Truncate on sentence boundary
  const truncated = clean.slice(0, maxLen);
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('. '),
    truncated.lastIndexOf('! '),
    truncated.lastIndexOf('? '),
  );

  if (lastSentenceEnd > maxLen * 0.4) {
    return truncated.slice(0, lastSentenceEnd + 1);
  }

  return truncated.trim();
}
