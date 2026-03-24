import type { ReactNode } from 'react';

interface PanelProps {
  title: string;
  status?: ReactNode;
  children: ReactNode;
  className?: string;
  scroll?: boolean;
}

export function Panel({ title, status, children, className = '', scroll = true }: PanelProps) {
  return (
    <div className={`bg-c-panel flex flex-col min-h-0 overflow-hidden ${className}`}>
      <div className="flex justify-between items-center px-3 py-1.5 border-b border-c-border shrink-0">
        <span className="text-[10px] font-medium tracking-[0.15em] uppercase text-c-dim">
          {title}
        </span>
        {status && <div className="flex items-center gap-2 text-[10px]">{status}</div>}
      </div>
      {scroll ? (
        <div className="flex-1 overflow-y-auto px-3 py-2.5 text-xs">
          {children}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col px-3 py-2.5 text-xs">
          {children}
        </div>
      )}
    </div>
  );
}
