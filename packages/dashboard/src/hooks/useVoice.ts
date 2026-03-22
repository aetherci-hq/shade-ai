import { useEffect, useRef, useState, useCallback } from 'react';

export function useVoice() {
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceQueueRef = useRef<AudioBufferSourceNode[]>([]);
  const nextStartTimeRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);

  // Initialize AudioContext lazily (browsers require user gesture)
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onmessage = (event) => {
      // Binary frame = audio chunk
      if (event.data instanceof ArrayBuffer) {
        if (muted) return;

        setSpeaking(true);
        const ctx = getAudioContext();

        ctx.decodeAudioData(event.data.slice(0))
          .then(audioBuffer => {
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(ctx.destination);

            // Schedule playback sequentially
            const now = ctx.currentTime;
            const startTime = Math.max(now, nextStartTimeRef.current);
            source.start(startTime);
            nextStartTimeRef.current = startTime + audioBuffer.duration;

            source.onended = () => {
              sourceQueueRef.current = sourceQueueRef.current.filter(s => s !== source);
            };
            sourceQueueRef.current.push(source);
          })
          .catch(() => {
            // MP3 decode can fail on partial chunks — skip silently
          });
        return;
      }

      // JSON frame — check for voice:done
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'voice:done') {
          // Wait for queued audio to finish, then clear speaking state
          const remaining = nextStartTimeRef.current - (audioContextRef.current?.currentTime ?? 0);
          setTimeout(() => setSpeaking(false), Math.max(0, remaining * 1000) + 100);
        }
      } catch {}
    };

    ws.onclose = () => {
      setSpeaking(false);
    };

    return () => {
      ws.close();
      // Stop all queued sources
      for (const source of sourceQueueRef.current) {
        try { source.stop(); } catch {}
      }
      sourceQueueRef.current = [];
    };
  }, [muted, getAudioContext]);

  const toggleMute = useCallback(() => {
    setMuted(prev => {
      if (!prev) {
        // Muting — stop all current playback
        for (const source of sourceQueueRef.current) {
          try { source.stop(); } catch {}
        }
        sourceQueueRef.current = [];
        nextStartTimeRef.current = 0;
        setSpeaking(false);
      }
      return !prev;
    });
  }, []);

  return { muted, speaking, toggleMute };
}
