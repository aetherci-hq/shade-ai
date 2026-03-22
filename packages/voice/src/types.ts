export interface VoiceConfig {
  enabled: boolean;
  provider: string;
  apiKey: string;
  voiceId: string;
  model: string;
  triggers: string[];
  maxCharsPerHour: number;
  maxCostPerDay: number;
}
