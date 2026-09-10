import React from 'react';
import {
  Activity,
  Box,
  Layers,
  Search,
  Server,
  Zap,
  HelpCircle,
  FileCode,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Play,
  Cpu,
} from 'lucide-react';
import { ClusterStats } from '../types';

interface HeaderStatsProps {
  stats: ClusterStats | null;
  namespaces: string[];
  selectedNamespace: string;
  onSelectNamespace: (ns: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  showContainers: boolean;
  onToggleContainers: () => void;
  showTraffic: boolean;
  onToggleTraffic: () => void;
  onResetZoom: () => void;
  onOpenLegend: () => void;
  onOpenManifests: () => void;
  onSimulate: (action: 'restart_pod' | 'crash_pod' | 'add_pod' | 'delete_pod' | 'simulate_traffic') => void;
  wsConnected: boolean;
}

export const HeaderStats: React.FC<HeaderStatsProps> = ({
  stats,
  namespaces,
  selectedNamespace,
  onSelectNamespace,
  searchQuery,
  onSearchChange,
  showContainers,
  onToggleContainers,
  showTraffic,
  onToggleTraffic,
  onResetZoom,
  onOpenLegend,
  onOpenManifests,
  onSimulate,
  wsConnected,
}) => {
  const [showSimMenu, setShowSimMenu] = React.useState(false);

  const hasErrors = (stats?.errorPods || 0) > 0;
  const hasPending = (stats?.pendingPods || 0) > 0;

  return (
    <header className="relative z-20 flex flex-col bg-slate-900/90 backdrop-blur-md border-b border-slate-800 text-slate-200">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 gap-3 flex-wrap sm:flex-nowrap">
        {/* Brand & Connection Badge */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Activity className="w-4 h-4 text-white animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-white">KubeMind</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400">
                  k3s
                </span>
              </div>
              <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    wsConnected ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'
                  }`}
                />
                <span>
                  {wsConnected
                    ? stats?.isLiveCluster
                      ? 'Live In-Cluster Watcher'
                      : 'Live Watcher • Tailscale (100.82.72.81)'
                    : 'Connecting...'}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Aggregate Stats Cards */}
        {stats && (
          <div className="hidden lg:flex items-center gap-3">
            {/* Cluster Health Pill */}
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${
                hasErrors
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  : hasPending
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              }`}
            >
              {hasErrors ? (
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              )}
              <span className="font-medium">
                {hasErrors ? 'Cluster Degraded' : hasPending ? 'Cluster Updating' : 'Cluster Healthy'}
              </span>
            </div>

            {/* Nodes */}
            <div className="flex items-center gap-2 px-2.5 py-1 bg-slate-800/80 border border-slate-700/60 rounded-md text-xs">
              <Server className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-slate-400">Nodes:</span>
              <span className="font-semibold text-white">
                {stats.readyNodes}/{stats.totalNodes}
              </span>
            </div>

            {/* Pods */}
            <div className="flex items-center gap-2 px-2.5 py-1 bg-slate-800/80 border border-slate-700/60 rounded-md text-xs">
              <Box className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-slate-400">Pods:</span>
              <span className="font-semibold text-emerald-400">{stats.runningPods}</span>
              {stats.pendingPods > 0 && (
                <span className="text-amber-400 font-medium">({stats.pendingPods} pend)</span>
              )}
              {stats.errorPods > 0 && (
                <span className="text-rose-400 font-bold">({stats.errorPods} err)</span>
              )}
            </div>

            {/* CPU & Memory Gauges */}
            <div className="flex items-center gap-3 px-2.5 py-1 bg-slate-800/80 border border-slate-700/60 rounded-md text-xs font-mono">
              <div className="flex items-center gap-1.5">
                <Cpu className="w-3 h-3 text-indigo-400" />
                <span className="text-slate-400">CPU:</span>
                <span className="text-slate-200">{stats.cpuUsedPercent || 35}%</span>
              </div>
              <div className="w-px h-3 bg-slate-700" />
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">RAM:</span>
                <span className="text-slate-200">{stats.memUsedPercent || 52}%</span>
              </div>
            </div>
          </div>
        )}

        {/* Actions & Utilities */}
        <div className="flex items-center gap-2 ml-auto">
          {/* Search Bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter pods, nodes, ports..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-40 sm:w-56 pl-8 pr-2.5 py-1 bg-slate-800 border border-slate-700 rounded-md text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-500 transition-colors"
            />
          </div>

          {/* Reset Camera Button */}
          <button
            onClick={onResetZoom}
            title="Reset Graph Zoom & Center"
            className="p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Toggle Container Nodes */}
          <button
            onClick={onToggleContainers}
            title={showContainers ? 'Hide Containers (Clean Overview)' : 'Show Containers inside Pods'}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border transition-colors ${
              showContainers
                ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Containers</span>
          </button>

          {/* Toggle Traffic Pulses */}
          <button
            onClick={onToggleTraffic}
            title={showTraffic ? 'Hide Traffic Pulses' : 'Show Live Traffic Pulses'}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border transition-colors ${
              showTraffic
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Traffic</span>
          </button>

          {/* Simulation Trigger Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowSimMenu(!showSimMenu)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-600/80 hover:bg-indigo-600 text-white text-xs font-medium border border-indigo-500/40 shadow-sm transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
              <span>Simulate</span>
            </button>

            {showSimMenu && (
              <div
                className="absolute right-0 mt-2 w-52 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl py-1 text-xs z-50 animate-in fade-in zoom-in-95 duration-100"
                onClick={() => setShowSimMenu(false)}
              >
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase text-slate-400 tracking-wider border-b border-slate-800">
                  Live Event Simulator
                </div>
                <button
                  onClick={() => onSimulate('restart_pod')}
                  className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-2 text-slate-200"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                  <span>Rolling Pod Restart</span>
                </button>
                <button
                  onClick={() => onSimulate('crash_pod')}
                  className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-2 text-rose-300"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                  <span>CrashLoopBackOff (OOM)</span>
                </button>
                <button
                  onClick={() => onSimulate('add_pod')}
                  className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-2 text-emerald-300"
                >
                  <Play className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Scale Up +1 New Pod</span>
                </button>
                <button
                  onClick={() => onSimulate('delete_pod')}
                  className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-2 text-slate-400"
                >
                  <Box className="w-3.5 h-3.5 text-slate-400" />
                  <span>Scale Down Pod</span>
                </button>
                <button
                  onClick={() => onSimulate('simulate_traffic')}
                  className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-2 text-cyan-300"
                >
                  <Zap className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Burst Network Traffic</span>
                </button>
              </div>
            )}
          </div>

          {/* Legend Button */}
          <button
            onClick={onOpenLegend}
            title="Mind-Map Legend"
            className="p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          {/* Manifests & Deploy info */}
          <button
            onClick={onOpenManifests}
            title="View Kubernetes Manifests & Deploy Instructions"
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs transition-colors"
          >
            <FileCode className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden md:inline">Deploy YAML</span>
          </button>
        </div>
      </div>

      {/* Namespace Filter Pills Bar */}
      <div className="flex items-center gap-1.5 px-4 py-1.5 bg-slate-950/60 border-t border-slate-800/60 overflow-x-auto text-xs no-scrollbar">
        <span className="text-[11px] font-medium text-slate-400 mr-1 flex items-center gap-1">
          <Layers className="w-3 h-3 text-slate-400" /> Namespaces:
        </span>
        <button
          onClick={() => onSelectNamespace('all')}
          className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
            selectedNamespace === 'all'
              ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
              : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 border border-slate-700/50'
          }`}
        >
          All ({stats?.totalPods || 0})
        </button>

        {namespaces.map((ns) => (
          <button
            key={ns}
            onClick={() => onSelectNamespace(ns)}
            className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
              selectedNamespace === ns
                ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 border border-slate-700/50'
            }`}
          >
            {ns}
          </button>
        ))}
      </div>
    </header>
  );
};
