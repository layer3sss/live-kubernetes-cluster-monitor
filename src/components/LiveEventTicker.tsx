import React from 'react';
import { Activity, Bell, CheckCircle2, AlertTriangle, Zap, Radio } from 'lucide-react';

export interface LiveEventItem {
  id: string;
  timestamp: number;
  text: string;
  type: 'info' | 'warn' | 'error' | 'traffic';
}

interface LiveEventTickerProps {
  events: LiveEventItem[];
  cni: string;
  ingress: string;
}

export const LiveEventTicker: React.FC<LiveEventTickerProps> = ({ events, cni, ingress }) => {
  const latestEvent = events[0];

  return (
    <div className="fixed bottom-0 left-0 right-0 h-8 bg-slate-950/95 border-t border-slate-800/80 px-4 flex items-center justify-between text-xs text-slate-400 z-20 backdrop-blur-md">
      {/* Latest Real-time Event */}
      <div className="flex items-center gap-2 overflow-hidden truncate">
        <div className="flex items-center gap-1.5 text-cyan-400 font-mono text-[11px] font-semibold shrink-0">
          <Radio className="w-3 h-3 text-cyan-400 animate-pulse" />
          <span>LIVE WATCH:</span>
        </div>

        {latestEvent ? (
          <div className="flex items-center gap-2 truncate text-slate-300 font-mono text-[11px]">
            {latestEvent.type === 'traffic' && <Zap className="w-3 h-3 text-cyan-400 shrink-0" />}
            {latestEvent.type === 'info' && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
            {latestEvent.type === 'warn' && <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />}
            {latestEvent.type === 'error' && <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />}
            <span className="truncate">{latestEvent.text}</span>
            <span className="text-[10px] text-slate-500">
              ({new Date(latestEvent.timestamp).toLocaleTimeString()})
            </span>
          </div>
        ) : (
          <span className="text-slate-500 italic text-[11px]">Watching Kubernetes cluster events...</span>
        )}
      </div>

      {/* CNI & Ingress Badges */}
      <div className="hidden sm:flex items-center gap-3 shrink-0 font-mono text-[10px] text-slate-400">
        <div className="flex items-center gap-1">
          <span className="text-slate-400">CNI:</span>
          <span className="text-slate-300">{cni || 'Flannel'}</span>
        </div>
        <div className="w-px h-3 bg-slate-800" />
        <div className="flex items-center gap-1">
          <span className="text-slate-400">Ingress:</span>
          <span className="text-slate-300">{ingress || 'Traefik'}</span>
        </div>
      </div>
    </div>
  );
};
