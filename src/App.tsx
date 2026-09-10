/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ClusterGraph, GraphNode, WSServerMessage, WSClientMessage } from './types';
import { HeaderStats } from './components/HeaderStats';
import { ClusterGraphCanvas } from './components/ClusterGraphCanvas';
import { DetailPanel } from './components/DetailPanel';
import { LegendModal } from './components/LegendModal';
import { ManifestModal } from './components/ManifestModal';
import { LiveEventTicker, LiveEventItem } from './components/LiveEventTicker';
import { Loader2 } from 'lucide-react';

export default function App() {
  const [graph, setGraph] = useState<ClusterGraph | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showContainers, setShowContainers] = useState<boolean>(false);
  const [showTraffic, setShowTraffic] = useState<boolean>(true);
  const [resetZoomTrigger, setResetZoomTrigger] = useState<number>(0);
  const [isLegendOpen, setIsLegendOpen] = useState<boolean>(false);
  const [isManifestsOpen, setIsManifestsOpen] = useState<boolean>(false);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [events, setEvents] = useState<LiveEventItem[]>([]);

  const wsRef = useRef<WebSocket | null>(null);

  // Helper to push real-time event into ticker
  const pushEvent = useCallback((text: string, type: 'info' | 'warn' | 'error' | 'traffic' = 'info') => {
    setEvents((prev) => [
      {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: Date.now(),
        text,
        type,
      },
      ...prev.slice(0, 19),
    ]);
  }, []);

  // Initialize WebSocket and REST fallback
  useEffect(() => {
    let reconnectTimer: NodeJS.Timeout | null = null;
    let isCancelled = false;

    // 1. Immediate REST fetch for instant zero-latency render
    fetch('/api/cluster/graph')
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error('Initial REST fetch failed');
      })
      .then((initialGraph: ClusterGraph) => {
        if (!isCancelled) {
          setGraph(initialGraph);
          pushEvent('Cluster snapshot synchronized from Kubernetes watcher', 'info');
        }
      })
      .catch(() => {
        // Fallback or still booting
      });

    // 2. WebSocket Connection
    const connectWS = () => {
      if (isCancelled) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (isCancelled) return;
          setWsConnected(true);
          pushEvent('Connected to real-time Kubernetes Watch stream', 'info');
        };

        ws.onmessage = (event) => {
          if (isCancelled) return;
          try {
            const msg = JSON.parse(event.data) as WSServerMessage;
            if (msg.type === 'init' || msg.type === 'graph_update') {
              setGraph(msg.data);
            } else if (msg.type === 'pod_event') {
              pushEvent(
                `Pod ${msg.pod.name} in ${msg.pod.namespace}: ${msg.event} (${msg.pod.status})`,
                msg.pod.status === 'error' ? 'error' : msg.pod.status === 'pending' ? 'warn' : 'info'
              );
            } else if (msg.type === 'node_event') {
              pushEvent(`Node ${msg.node.name}: ${msg.event} (${msg.node.status})`, 'info');
            } else if (msg.type === 'traffic_pulse') {
              pushEvent(`Traffic pulse on port ${msg.port} → ${msg.target.split('/')[1] || msg.target}`, 'traffic');
            } else if (msg.type === 'status_message') {
              pushEvent(msg.text, msg.level);
            }
          } catch (e) {
            console.error('[WS] Parse error:', e);
          }
        };

        ws.onclose = () => {
          if (isCancelled) return;
          setWsConnected(false);
          // Reconnect with backoff
          reconnectTimer = setTimeout(connectWS, 3000);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch (err) {
        reconnectTimer = setTimeout(connectWS, 3000);
      }
    };

    connectWS();

    return () => {
      isCancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, [pushEvent]);

  // Sync selected node with latest graph state (e.g. if pod restarted/updated)
  useEffect(() => {
    if (selectedNode && graph) {
      const fresh = graph.nodes.find((n) => n.id === selectedNode.id);
      if (fresh) {
        setSelectedNode(fresh);
      }
    }
  }, [graph]);

  // Simulation Trigger
  const handleSimulate = (action: 'restart_pod' | 'crash_pod' | 'add_pod' | 'delete_pod' | 'simulate_traffic') => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const clientMsg: WSClientMessage = { type: 'simulate_event', action };
      wsRef.current.send(JSON.stringify(clientMsg));
    } else {
      fetch('/api/cluster/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      }).catch(console.error);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 select-none">
      {/* Top Header & Statistics */}
      <HeaderStats
        stats={graph?.clusterStats || null}
        namespaces={graph?.namespaces || []}
        selectedNamespace={selectedNamespace}
        onSelectNamespace={setSelectedNamespace}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        showContainers={showContainers}
        onToggleContainers={() => setShowContainers(!showContainers)}
        showTraffic={showTraffic}
        onToggleTraffic={() => setShowTraffic(!showTraffic)}
        onResetZoom={() => setResetZoomTrigger((prev) => prev + 1)}
        onOpenLegend={() => setIsLegendOpen(true)}
        onOpenManifests={() => setIsManifestsOpen(true)}
        onSimulate={handleSimulate}
        wsConnected={wsConnected}
      />

      {/* Main Canvas Area */}
      <main className="relative flex-1 w-full h-full overflow-hidden">
        {graph ? (
          <ClusterGraphCanvas
            graph={graph}
            selectedNodeId={selectedNode?.id || null}
            onSelectNode={setSelectedNode}
            showContainers={showContainers}
            showTraffic={showTraffic}
            searchQuery={searchQuery}
            selectedNamespace={selectedNamespace}
            resetZoomTrigger={resetZoomTrigger}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full w-full gap-3 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
            <span className="font-mono text-xs">Connecting to Kubernetes cluster stream...</span>
          </div>
        )}

        {/* Detail Panel on Node Click */}
        {selectedNode && (
          <DetailPanel
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
            onSimulateRestart={(podName) => handleSimulate('restart_pod')}
          />
        )}
      </main>

      {/* Bottom Live Event Ticker */}
      <LiveEventTicker
        events={events}
        cni={graph?.clusterStats?.cni || 'Flannel'}
        ingress={graph?.clusterStats?.ingressController || 'Traefik'}
      />

      {/* Modals */}
      <LegendModal isOpen={isLegendOpen} onClose={() => setIsLegendOpen(false)} />
      <ManifestModal isOpen={isManifestsOpen} onClose={() => setIsManifestsOpen(false)} />
    </div>
  );
}
