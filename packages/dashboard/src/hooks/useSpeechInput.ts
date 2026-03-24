import { useState, useRef, useCallback, useEffect } from 'react';

// Browser SpeechRecognition types
type SpeechRecognitionType = typeof window extends { SpeechRecognition: infer T } ? T : unknown;

interface SpeechRecognitionEvent {
  results: { [index: number]: { [index: number]: { transcript: string }; isFinal: boolean }; length: number };
  resultIndex: number;
}

function getSpeechRecognition(): (new () => {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onspeechend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as ReturnType<typeof getSpeechRecognition>;
}

export function useSpeechInput() {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<ReturnType<ReturnType<typeof getSpeechRecognition>> | null>(null);
  const onResultRef = useRef<((text: string) => void) | null>(null);

  const supported = typeof window !== 'undefined' && getSpeechRecognition() !== null;

  const start = useCallback((onResult: (text: string) => void) => {
    const SR = getSpeechRecognition();
    if (!SR) return;

    // Stop any existing recognition
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    onResultRef.current = onResult;
    recognitionRef.current = recognition;

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      setTranscript(final || interim);

      if (final) {
        onResultRef.current?.(final.trim());
        setListening(false);
        setTranscript('');
      }
    };

    recognition.onspeechend = () => {
      // Silence detected — recognition will fire final result then end
    };

    recognition.onerror = (e: { error: string }) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.error('[speech] Error:', e.error);
      }
      setListening(false);
      setTranscript('');
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognition.start();
    setListening(true);
    setTranscript('');
  }, []);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    setListening(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }
    };
  }, []);

  return { listening, transcript, supported, start, stop };
}
