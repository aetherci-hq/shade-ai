export { VoiceEngine } from './engine.js';
export { ElevenLabsClient, ElevenLabsError } from './elevenlabs.js';
export type { VoiceConfig } from './types.js';

import { getConfig } from '@specter/core';
import { VoiceEngine } from './engine.js';
import type { VoiceConfig } from './types.js';

let _engine: VoiceEngine | null = null;

export function initVoice(): VoiceEngine | null {
  const config = getConfig();
  const voice = config.voice;

  if (!voice.enabled || !voice.apiKey) {
    return null;
  }

  const engine = new VoiceEngine(voice as VoiceConfig);
  engine.start();
  _engine = engine;
  return engine;
}

export function getVoiceEngine(): VoiceEngine | null {
  return _engine;
}
