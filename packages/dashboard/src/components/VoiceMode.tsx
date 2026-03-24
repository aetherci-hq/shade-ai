import { useEffect, useCallback, useState } from 'react';
import { Mic, MicOff, Volume2, VolumeX, X } from 'lucide-react';
import { useSpeechInput } from '../hooks/useSpeechInput';

type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface Props {
  agentName: string;
  isRunning: boolean;
  speaking: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onSend: (text: string) => void;
  onClose: () => void;
}

const ORB_STYLES: Record<OrbState, { size: number; color: string; glow: string; borderColor: string }> = {
  idle: {
    size: 80,
    color: 'rgba(191, 149, 107, 0.15)',
    glow: '0 0 30px rgba(191, 149, 107, 0.1), 0 0 60px rgba(191, 149, 107, 0.05)',
    borderColor: 'rgba(191, 149, 107, 0.25)',
  },
  listening: {
    size: 120,
    color: 'rgba(123, 141, 166, 0.2)',
    glow: '0 0 40px rgba(123, 141, 166, 0.2), 0 0 80px rgba(123, 141, 166, 0.1)',
    borderColor: 'rgba(123, 141, 166, 0.4)',
  },
  thinking: {
    size: 100,
    color: 'rgba(181, 152, 92, 0.15)',
    glow: '0 0 35px rgba(181, 152, 92, 0.15), 0 0 70px rgba(181, 152, 92, 0.07)',
    borderColor: 'rgba(181, 152, 92, 0.3)',
  },
  speaking: {
    size: 140,
    color: 'rgba(191, 149, 107, 0.2)',
    glow: '0 0 50px rgba(191, 149, 107, 0.25), 0 0 100px rgba(191, 149, 107, 0.12)',
    borderColor: 'rgba(191, 149, 107, 0.45)',
  },
};

const STATE_LABELS: Record<OrbState, string> = {
  idle: 'Tap to speak',
  listening: 'Listening...',
  thinking: 'Thinking...',
  speaking: 'Speaking...',
};

export function VoiceMode({ agentName, isRunning, speaking, muted, onToggleMute, onSend, onClose }: Props) {
  const speech = useSpeechInput();
  const [orbState, setOrbState] = useState<OrbState>('idle');

  useEffect(() => {
    if (speaking) {
      setOrbState('speaking');
    } else if (isRunning) {
      setOrbState('thinking');
    } else if (speech.listening) {
      setOrbState('listening');
    } else {
      setOrbState('idle');
    }
  }, [speaking, isRunning, speech.listening]);

  const handleOrbClick = useCallback(() => {
    if (orbState === 'thinking' || orbState === 'speaking') return;

    if (speech.listening) {
      speech.stop();
    } else {
      speech.start((text) => {
        if (text.trim()) {
          onSend(text.trim());
        }
      });
    }
  }, [orbState, speech, onSend]);

  // Keyboard shortcuts (desktop)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
        handleOrbClick();
      }
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleOrbClick, onClose]);

  const style = ORB_STYLES[orbState];
  const label = STATE_LABELS[orbState];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-c-bg">
      {/* Top accent line */}
      <div className="h-px w-full bg-c-accent opacity-30 shrink-0" />

      {/* Header — big touch targets for mobile */}
      <div className="flex items-center justify-between px-5 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[14px] font-medium tracking-[0.15em] uppercase text-c-text glow-text">{agentName}</span>
          <span className="text-[11px] text-c-muted uppercase tracking-wider">Voice</span>
        </div>
        <button
          onClick={onClose}
          className="p-2 text-c-muted hover:text-c-accent transition-colors"
          title="Exit voice mode"
        >
          <X size={22} />
        </button>
      </div>

      {/* Orb area */}
      <div className="flex-1 flex flex-col items-center justify-center select-none">
        <button
          onClick={handleOrbClick}
          disabled={orbState === 'thinking' || orbState === 'speaking'}
          className="relative focus:outline-none transition-all duration-300 ease-out"
          style={{
            width: style.size,
            height: style.size,
            borderRadius: '50%',
            background: style.color,
            boxShadow: style.glow,
            border: `1px solid ${style.borderColor}`,
            cursor: orbState === 'thinking' || orbState === 'speaking' ? 'default' : 'pointer',
          }}
        >
          {/* Inner pulse */}
          <div
            className={`absolute inset-0 rounded-full ${
              orbState === 'idle' ? 'animate-pulse-slow' :
              orbState === 'listening' ? 'animate-pulse-live' :
              orbState === 'thinking' ? 'animate-pulse-slow' :
              'animate-pulse-live'
            }`}
            style={{ background: style.color, borderRadius: '50%' }}
          />

          {/* Icon */}
          <div className="absolute inset-0 flex items-center justify-center">
            {orbState === 'listening' ? (
              <Mic className="text-c-cyan" size={style.size * 0.25} />
            ) : orbState === 'idle' ? (
              <MicOff className="text-c-accent/50" size={style.size * 0.25} />
            ) : null}
          </div>
        </button>

        {/* Label / Transcript */}
        <div className="mt-8 h-16 flex flex-col items-center justify-start px-6">
          {speech.transcript && orbState === 'listening' ? (
            <p className="text-c-cyan/70 text-[15px] text-center max-w-md animate-fade-in">
              {speech.transcript}
            </p>
          ) : label ? (
            <p className="text-c-muted text-[13px] uppercase tracking-[0.15em]">{label}</p>
          ) : null}

          {!speech.supported && (
            <p className="text-c-red text-[12px] uppercase tracking-wider mt-2">Speech not supported in this browser</p>
          )}
        </div>
      </div>

      {/* Bottom bar — big touch targets */}
      <div className="shrink-0 bg-c-bg border-t border-c-border flex items-center justify-center px-6 py-4 gap-6">
        <button
          onClick={onToggleMute}
          className={`flex items-center gap-2 px-4 py-2 border transition-colors ${
            muted
              ? 'text-c-muted/50 border-c-border'
              : 'text-c-muted border-c-border hover:text-c-accent hover:border-c-accent/30'
          }`}
          title={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          <span className="text-[12px] uppercase tracking-wider">{muted ? 'Muted' : 'Sound'}</span>
        </button>

        <button
          onClick={onClose}
          className="flex items-center gap-2 px-4 py-2 border border-c-border text-c-muted hover:text-c-accent hover:border-c-accent/30 transition-colors"
        >
          <X size={18} />
          <span className="text-[12px] uppercase tracking-wider">Exit</span>
        </button>
      </div>
    </div>
  );
}
