import React from 'react';
import { X, CheckCircle, AlertTriangle, Box, Server, Layers, Network, Zap } from 'lucide-react';

interface LegendModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LegendModal: React.FC<LegendModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-lg w-full overflow-hidden text-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-cyan-400" />
            <h3 className="font-bold text-white text-base">How to Read the Mind-Map</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5 text-xs">
          {/* Topology Hierarchy */}
          <div>
            <h4 className="font-semibold text-slate-100 uppercase tracking-wider text-[11px] mb-3">
              1. Visual Hierarchy
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-950/50 border border-slate-800">
                <div className="w-7 h-7 rounded-full bg-cyan-950 border border-cyan-500/60 flex items-center justify-center shrink-0">
                  <Server className="w-3.5 h-3.5 text-cyan-400" />
                </div>
                <div>
                  <span className="font-bold text-white block">Cluster Nodes</span>
                  <p className="text-slate-400 text-[11px]">
                    Large outer halos representing physical or VM machines in your cluster.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-950/50 border border-slate-800">
                <div className="w-7 h-7 rounded-full bg-emerald-950 border border-emerald-500/60 flex items-center justify-center shrink-0">
                  <Box className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <div>
                  <span className="font-bold text-white block">Pods</span>
                  <p className="text-slate-400 text-[11px]">
                    Medium circles nested inside their host node, representing running apps.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-950/50 border border-slate-800">
                <div className="w-7 h-7 rounded-md bg-amber-950/80 border border-amber-500/60 flex items-center justify-center shrink-0 rotate-45">
                  <Network className="w-3.5 h-3.5 text-amber-400 -rotate-45" />
                </div>
                <div>
                  <span className="font-bold text-white block">Services</span>
                  <p className="text-slate-400 text-[11px]">
                    Diamond hubs that distribute network traffic across matching backend pods.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-950/50 border border-slate-800">
                <div className="w-7 h-7 rounded-full bg-indigo-950 border border-indigo-500/60 flex items-center justify-center shrink-0">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                </div>
                <div>
                  <span className="font-bold text-white block">Containers</span>
                  <p className="text-slate-400 text-[11px]">
                    Small nested dots inside pods running the actual container images.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Color Codes */}
          <div>
            <h4 className="font-semibold text-slate-100 uppercase tracking-wider text-[11px] mb-2.5">
              2. Status Colors
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2 p-2 rounded bg-slate-950/40 border border-slate-800">
                <span className="w-3 h-3 rounded-full bg-emerald-400 shadow-sm shadow-emerald-500/50" />
                <div>
                  <span className="font-semibold text-emerald-300">Running / Ready</span>
                  <p className="text-slate-400 text-[10px]">Healthy and accepting traffic</p>
                </div>
              </div>

              <div className="flex items-center gap-2 p-2 rounded bg-slate-950/40 border border-slate-800">
                <span className="w-3 h-3 rounded-full bg-amber-400 shadow-sm shadow-amber-500/50 animate-pulse" />
                <div>
                  <span className="font-semibold text-amber-300">Pending / Starting</span>
                  <p className="text-slate-400 text-[10px]">Creating containers or scheduling</p>
                </div>
              </div>

              <div className="flex items-center gap-2 p-2 rounded bg-slate-950/40 border border-slate-800">
                <span className="w-3 h-3 rounded-full bg-rose-500 shadow-sm shadow-rose-500/50 animate-ping" />
                <div>
                  <span className="font-semibold text-rose-300">Error / CrashLoop</span>
                  <p className="text-slate-400 text-[10px]">OOMKilled or failing containers</p>
                </div>
              </div>

              <div className="flex items-center gap-2 p-2 rounded bg-slate-950/40 border border-slate-800">
                <span className="w-3 h-3 rounded-full bg-slate-500" />
                <div>
                  <span className="font-semibold text-slate-400">Terminating / Done</span>
                  <p className="text-slate-400 text-[10px]">Gracefully shutting down</p>
                </div>
              </div>
            </div>
          </div>

          {/* Network Connections */}
          <div>
            <h4 className="font-semibold text-slate-100 uppercase tracking-wider text-[11px] mb-2">
              3. Service Connections & Traffic Pulses
            </h4>
            <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 text-slate-300 space-y-1.5">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-cyan-400" />
                <span className="font-semibold text-white">Derived without eBPF / Cilium</span>
              </div>
              <p className="text-slate-400 leading-relaxed text-[11px]">
                Connections are derived from Kubernetes <span className="font-mono text-cyan-300">Service</span> → <span className="font-mono text-cyan-300">Endpoints</span> → <span className="font-mono text-cyan-300">Pod</span> mappings and container port definitions.
                Port labels (such as <span className="font-mono text-cyan-400">:80</span> or <span className="font-mono text-cyan-400">:8080</span>) show the exact destination port.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-950/60 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
