const BASE_URL = 'https://api.elevenlabs.io/v1';

export class ElevenLabsClient {
  private apiKey: string;
  private voiceId: string;
  private model: string;

  constructor(apiKey: string, voiceId: string, model: string) {
    this.apiKey = apiKey;
    this.voiceId = voiceId;
    this.model = model;
  }

  async *stream(text: string): AsyncGenerator<Buffer> {
    const url = `${BASE_URL}/text-to-speech/${this.voiceId}/stream`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: this.model,
        output_format: 'mp3_44100_128',
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 401) {
        throw new ElevenLabsError('Invalid API key', 'auth');
      }
      if (status === 429) {
        throw new ElevenLabsError('Rate limited', 'rate_limit');
      }
      throw new ElevenLabsError(`API error: ${status}`, 'api');
    }

    const body = response.body;
    if (!body) {
      throw new ElevenLabsError('No response body', 'api');
    }

    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield Buffer.from(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export class ElevenLabsError extends Error {
  kind: 'auth' | 'rate_limit' | 'api';

  constructor(message: string, kind: 'auth' | 'rate_limit' | 'api') {
    super(message);
    this.kind = kind;
  }
}
