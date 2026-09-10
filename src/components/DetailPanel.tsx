import React from 'react';
import {
  X,
  Box,
  Server,
  Layers,
  Cpu,
  HardDrive,
  Clock,
  RotateCcw,
  CheckCircle,
  AlertTriangle,
  Tag,
  Network,
  ExternalLink,
} from 'lucide-react';
import { GraphNode, K8sContainer, K8sNode, K8sPod, K8sService } from '../types';

interface DetailPanelProps {
  node: GraphNode | null;
  onClose: () => void;
  onSimulateRestart?: (podName: string) => void;
}

export const DetailPanel: React.FC<DetailPanelProps> = ({ node, onClose, onSimulateRestart }) => {
  if (!node) return null;

  const isPod = node.type === 'pod';
  const isNode = node.type === 'node';
  const isContainer = node.type === 'container';
  const isService = node.type === 'service';

  return (
    <aside className="fixed top-14 bottom-8 right-0 w-full sm:w-96 bg-slate-900/95 backdrop-blur-xl border-l border-slate-800 shadow-2xl z-30 flex flex-col text-slate-100 overflow-hidden animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/40">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-2 rounded-lg bg-slate-800 border border-slate-700">
            {isPod && <Box className="w-5 h-5 text-emerald-400" />}
            {isNode && <Server className="w-5 h-5 text-cyan-400" />}
            {isContainer && <Layers className="w-5 h-5 text-indigo-400" />}
            {isService && <Network className="w-5 h-5 text-amber-400" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700">
                {node.type}
              </span>
              <span
                className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                  node.status === 'running' || node.status === 'ready'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : node.status === 'pending'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                }`}
              >
                {node.status}
              </span>
            </div>
            <h3 className="font-mono text-sm font-semibold truncate text-white mt-0.5">
              {node.name}
            </h3>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content Scrollable */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* POD DETAILS */}
        {isPod && (() => {
          const pod = node.data as K8sPod;
          return (
            <>
              {/* Metadata Overview */}
              <div className="grid grid-cols-2 gap-2 bg-slate-950/50 p-3 rounded-lg border border-slate-800/80">
                <div>
                  <span className="text-slate-400 text-[11px]">Namespace</span>
                  <p className="font-mono font-medium text-slate-200">{pod.namespace}</p>
                </div>
                <div>
                  <span className="text-slate-400 text-[11px]">Host Node</span>
                  <p className="font-mono font-medium text-cyan-400">{pod.nodeName || 'Unscheduled'}</p>
                </div>
                <div>
                  <span className="text-slate-400 text-[11px]">Pod IP</span>
                  <p className="font-mono font-medium text-slate-200">{pod.podIP || 'Pending'}</p>
                </div>
                <div>
                  <span className="text-slate-400 text-[11px]">Restarts</span>
                  <p
                    className={`font-mono font-medium ${
                      pod.totalRestarts > 0 ? 'text-amber-400' : 'text-slate-200'
                    }`}
                  >
                    {pod.totalRestarts}
                  </p>
                </div>
              </div>

              {/* Containers List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-indigo-400" />
                    Containers ({pod.containers.length})
                  </span>
                </div>

                {pod.containers.map((c, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-mono font-medium text-slate-200">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            c.ready ? 'bg-emerald-400' : 'bg-rose-400'
                          }`}
                        />
                        <span>{c.name}</span>
                      </div>
                      <span className="text-[10px] text-slate-400">
                        Restarts: {c.restartCount}
                      </span>
                    </div>

                    <div className="text-[11px] font-mono text-slate-400 truncate">
                      <span className="text-slate-500">image: </span>
                      {c.image}
                    </div>

                    {/* Ports */}
                    {c.ports.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] text-slate-400">Ports:</span>
                        {c.ports.map((p, pIdx) => (
                          <span
                            key={pIdx}
                            className="px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-mono text-[10px]"
                          >
                            {p.containerPort}/{p.protocol || 'TCP'} {p.name && `(${p.name})`}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Resources */}
                    {c.resources && (
                      <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-slate-800/80 text-[11px]">
                        <div>
                          <span className="text-slate-400">Requests:</span>
                          <p className="font-mono text-slate-300">
                            CPU: {c.resources.requests?.cpu || 'none'}, Mem:{' '}
                            {c.resources.requests?.memory || 'none'}
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-400">Limits:</span>
                          <p className="font-mono text-slate-300">
                            CPU: {c.resources.limits?.cpu || 'none'}, Mem:{' '}
                            {c.resources.limits?.memory || 'none'}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Conditions */}
              {pod.conditions.length > 0 && (
                <div className="space-y-1.5">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    Status Conditions
                  </span>
                  <div className="space-y-1">
                    {pod.conditions.map((cond, cIdx) => (
                      <div
                        key={cIdx}
                        className="flex items-center justify-between px-2.5 py-1.5 bg-slate-950/40 rounded border border-slate-800/60"
                      >
                        <span className="font-mono text-slate-300">{cond.type}</span>
                        <span
                          className={`font-semibold ${
                            cond.status === 'True' ? 'text-emerald-400' : 'text-amber-400'
                          }`}
                        >
                          {cond.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Labels */}
              {Object.keys(pod.labels).length > 0 && (
                <div className="space-y-1.5">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-cyan-400" />
                    Labels
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(pod.labels).map(([k, v]) => (
                      <span
                        key={k}
                        className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[10px]"
                      >
                        {k}: <span className="text-cyan-300">{v}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          );
        })()}

        {/* NODE DETAILS */}
        {isNode && (() => {
          const kNode = node.data as K8sNode;
          return (
            <>
              {/* Machine Specs */}
              <div className="grid grid-cols-2 gap-2 bg-slate-950/50 p-3 rounded-lg border border-slate-800/80">
                <div>
                  <span className="text-slate-400 text-[11px]">Internal IP</span>
                  <p className="font-mono font-medium text-cyan-400">{kNode.internalIP || 'Unknown'}</p>
                </div>
                <div>
                  <span className="text-slate-400 text-[11px]">Roles</span>
                  <p className="font-mono font-medium text-slate-200">
                    {kNode.roles.join(', ') || 'worker'}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400 text-[11px]">Kubelet</span>
                  <p className="font-mono font-medium text-slate-200">{kNode.kubeletVersion}</p>
                </div>
                <div>
                  <span className="text-slate-400 text-[11px]">OS Image</span>
                  <p className="font-mono font-medium text-slate-200 truncate">{kNode.osImage}</p>
                </div>
              </div>

              {/* Resource Gauges */}
              <div className="space-y-3 p-3 bg-slate-950/60 rounded-lg border border-slate-800">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                  Resource Allocation
                </span>

                <div>
                  <div className="flex justify-between text-slate-300 mb-1">
                    <span>CPU Usage</span>
                    <span className="font-mono">{kNode.cpuUsagePercent || 35}%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-500 rounded-full transition-all duration-500"
                      style={{ width: `${kNode.cpuUsagePercent || 35}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-slate-300 mb-1">
                    <span>Memory Usage</span>
                    <span className="font-mono">{kNode.memUsagePercent || 50}%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                      style={{ width: `${kNode.memUsagePercent || 50}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Running Pods count */}
              <div className="p-3 bg-slate-950/40 rounded-lg border border-slate-800 flex items-center justify-between">
                <span className="text-slate-300">Hosted Pods:</span>
                <span className="font-mono font-bold text-emerald-400 text-sm">
                  {kNode.podCount} Pods
                </span>
              </div>
            </>
          );
        })()}

        {/* SERVICE DETAILS */}
        {isService && (() => {
          const svc = node.data as K8sService;
          return (
            <>
              <div className="grid grid-cols-2 gap-2 bg-slate-950/50 p-3 rounded-lg border border-slate-800/80">
                <div>
                  <span className="text-slate-400 text-[11px]">Namespace</span>
                  <p className="font-mono font-medium text-slate-200">{svc.namespace}</p>
                </div>
                <div>
                  <span className="text-slate-400 text-[11px]">Service Type</span>
                  <p className="font-mono font-medium text-amber-400">{svc.type}</p>
                </div>
                <div>
                  <span className="text-slate-400 text-[11px]">ClusterIP</span>
                  <p className="font-mono font-medium text-slate-200">{svc.clusterIP || 'None'}</p>
                </div>
                <div>
                  <span className="text-slate-400 text-[11px]">Endpoints</span>
                  <p className="font-mono font-medium text-emerald-400">
                    {svc.targetPods.length} Target Pods
                  </p>
                </div>
              </div>

              {/* Service Ports */}
              <div className="space-y-2">
                <span className="font-semibold text-slate-300">Service Ports</span>
                <div className="space-y-1">
                  {svc.ports.map((p, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2 rounded bg-slate-950/60 border border-slate-800 font-mono text-[11px]"
                    >
                      <span className="text-slate-300">{p.name || 'default'}</span>
                      <span className="text-cyan-400">
                        {p.port} → {p.targetPort} / {p.protocol}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Endpoints Pods */}
              {svc.targetPods.length > 0 && (
                <div className="space-y-2">
                  <span className="font-semibold text-slate-300">Target Pods (Endpoints)</span>
                  <div className="space-y-1">
                    {svc.targetPods.map((tPod, idx) => (
                      <div
                        key={idx}
                        className="px-2.5 py-1.5 rounded bg-slate-950/40 border border-slate-800 font-mono text-[11px] text-slate-300 truncate"
                      >
                        {tPod}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          );
        })()}

        {/* CONTAINER DETAILS */}
        {isContainer && (() => {
          const c = node.data as K8sContainer;
          return (
            <div className="space-y-3">
              <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 space-y-2">
                <div className="text-[11px] font-mono text-slate-400">
                  <span className="text-slate-500">Image: </span>
                  {c.image}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">State:</span>
                  <span className="font-mono font-medium text-emerald-400">{c.state}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Restarts:</span>
                  <span className="font-mono font-medium text-slate-200">{c.restartCount}</span>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </aside>
  );
};
