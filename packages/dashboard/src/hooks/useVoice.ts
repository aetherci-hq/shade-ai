import { useEffect, useRef, useState, useCallback } from 'react';
import { registerBinaryHandler } from './useSocket';

// Check if MediaSource is available (not supported on iOS Safari)
const hasMediaSource = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported?.('audio/mpeg');

// Mobile audio unlock — browsers require a user gesture before audio can play.
// We create a silent audio element and play it on first touch/click to unlock the context.
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  const silence = new Audio('data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7v/////////////////////////////////////////////////////AAAAAExhdmM1OC4xMwAAAAAAAAAAAAAAACQAAAAAAAAAAAGGOjQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7v/////////////////////////////////////////////////////AAAAAExhdmM1OC4xMwAAAAAAAAAAAAAAACQAAAAAAAAAAAGGOjQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  silence.play().then(() => {
    audioUnlocked = true;
    silence.pause();
  }).catch(() => {});
}

// Listen for first user interaction globally
if (typeof window !== 'undefined') {
  const unlock = () => {
    unlockAudio();
    window.removeEventListener('touchstart', unlock);
    window.removeEventListener('click', unlock);
  };
  window.addEventListener('touchstart', unlock, { once: true });
  window.addEventListener('click', unlock, { once: true });
}

export function useVoice() {
  // Default to muted — user opts in to voice. Persist preference.
  const [muted, setMuted] = useState(() => {
    const saved = localStorage.getItem('specter_voice_muted');
    return saved !== null ? saved === 'true' : true; // muted by default
  });
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const pendingChunks = useRef<Uint8Array[]>([]);
  const streamActive = useRef(false);
  const mutedRef = useRef(false);
  const blobChunks = useRef<Uint8Array[]>([]);

  mutedRef.current = muted;

  const appendNextChunk = useCallback(() => {
    const sb = sourceBufferRef.current;
    if (!sb || sb.updating || pendingChunks.current.length === 0) return;
    const chunk = pendingChunks.current.shift()!;
    try {
      sb.appendBuffer(chunk);
    } catch { /* SourceBuffer may be closed */ }
  }, []);

  const playBlob = useCallback(() => {
    if (blobChunks.current.length === 0) {
      setSpeaking(false);
      streamActive.current = false;
      return;
    }
    const blob = new Blob(blobChunks.current, { type: 'audio/mpeg' });
    blobChunks.current = [];
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.addEventListener('ended', () => {
      setSpeaking(false);
      streamActive.current = false;
      URL.revokeObjectURL(url);
    });
    audio.addEventListener('error', () => {
      setSpeaking(false);
      streamActive.current = false;
      URL.revokeObjectURL(url);
    });
    audio.play().catch(() => {
      setSpeaking(false);
      streamActive.current = false;
      URL.revokeObjectURL(url);
    });
  }, []);

  const endStream = useCallback(() => {
    if (hasMediaSource) {
      const ms = mediaSourceRef.current;
      const sb = sourceBufferRef.current;
      if (ms && ms.readyState === 'open') {
        const tryEnd = () => {
          if (sb && sb.updating) { setTimeout(tryEnd, 50); return; }
          if (pendingChunks.current.length > 0) { appendNextChunk(); setTimeout(tryEnd, 50); return; }
          try { if (ms.readyState === 'open') ms.endOfStream(); } catch {}
        };
        tryEnd();
      }
    } else {
      playBlob();
    }
  }, [appendNextChunk, playBlob]);

  const startNewStream = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
    }

    // Try to unlock audio on stream start
    unlockAudio();

    if (hasMediaSource) {
      const mediaSource = new MediaSource();
      mediaSourceRef.current = mediaSource;
      pendingChunks.current = [];
      streamActive.current = true;

      const audio = new Audio();
      audio.src = URL.createObjectURL(mediaSource);
      audioRef.current = audio;

      mediaSource.addEventListener('sourceopen', () => {
        try {
          const sb = mediaSource.addSourceBuffer('audio/mpeg');
          sourceBufferRef.current = sb;
          sb.addEventListener('updateend', () => {
            appendNextChunk();
            if (audio.paused && sb.buffered.length > 0) {
              audio.play().catch(() => {});
            }
          });
        } catch (err) {
          console.error('[voice] MediaSource error:', err);
        }
      });

      audio.addEventListener('ended', () => {
        setSpeaking(false);
        streamActive.current = false;
      });
    } else {
      // Blob fallback — collect chunks, play on endStream
      blobChunks.current = [];
      streamActive.current = true;
    }

    setSpeaking(true);
  }, [appendNextChunk]);

  // Register for binary data from the shared WebSocket
  useEffect(() => {
    const unregister = registerBinaryHandler((data: ArrayBuffer) => {
      if (mutedRef.current) return;

      if (data.byteLength === 0) {
        endStream();
        return;
      }

      if (!streamActive.current) {
        startNewStream();
      }

      if (hasMediaSource) {
        pendingChunks.current.push(new Uint8Array(data));
        appendNextChunk();
      } else {
        blobChunks.current.push(new Uint8Array(data));
      }
    });

    return () => {
      unregister();
      if (audioRef.current) audioRef.current.pause();
      streamActive.current = false;
    };
  }, [startNewStream, appendNextChunk, endStream]);

  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev;
      localStorage.setItem('specter_voice_muted', String(next));
      if (next) {
        if (audioRef.current) audioRef.current.pause();
        streamActive.current = false;
        pendingChunks.current = [];
        blobChunks.current = [];
        setSpeaking(false);
      }
      return next;
    });
  }, []);

  return { muted, speaking, toggleMute };
}
