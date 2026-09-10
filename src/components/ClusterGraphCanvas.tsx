import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { ClusterGraph, GraphLink, GraphNode, K8sNode, K8sPod, K8sService } from '../types';

interface ClusterGraphCanvasProps {
  graph: ClusterGraph;
  selectedNodeId: string | null;
  onSelectNode: (node: GraphNode | null) => void;
  showContainers: boolean;
  showTraffic: boolean;
  searchQuery: string;
  selectedNamespace: string;
  resetZoomTrigger: number;
}

interface Particle {
  id: string;
  linkId: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  progress: number;
  speed: number;
  color: string;
}

export const ClusterGraphCanvas: React.FC<ClusterGraphCanvasProps> = ({
  graph,
  selectedNodeId,
  onSelectNode,
  showContainers,
  showTraffic,
  searchQuery,
  selectedNamespace,
  resetZoomTrigger,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const zoomTransformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const particlesRef = useRef<Particle[]>([]);
  const animFrameRef = useRef<number | null>(null);

  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Filter nodes & links based on settings
  const filteredData = useMemo(() => {
    let nodes = graph.nodes.filter((n) => {
      // Container filter
      if (!showContainers && n.type === 'container') return false;

      // Namespace filter
      if (selectedNamespace !== 'all') {
        if (n.type === 'pod' || n.type === 'service' || n.type === 'container') {
          if (n.namespace !== selectedNamespace) return false;
        }
      }

      return true;
    });

    const nodeIds = new Set(nodes.map((n) => n.id));

    let links = graph.links.filter((l) => {
      const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;

      if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return false;
      if (!showContainers && l.type === 'nesting' && targetId.startsWith('container:')) return false;
      return true;
    });

    return { nodes, links };
  }, [graph, showContainers, selectedNamespace]);

  // Handle D3 Force Simulation setup
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth || 1000;
    const height = containerRef.current.clientHeight || 700;

    // Preserve existing coordinates if present to prevent violent jump
    const existingPosMap = new Map<string, { x: number; y: number; vx: number; vy: number }>();
    if (simulationRef.current) {
      simulationRef.current.nodes().forEach((n) => {
        if (n.x != null && n.y != null) {
          existingPosMap.set(n.id, { x: n.x, y: n.y, vx: n.vx || 0, vy: n.vy || 0 });
        }
      });
      simulationRef.current.stop();
    }

    const simNodes: GraphNode[] = filteredData.nodes.map((node) => {
      const existing = existingPosMap.get(node.id);
      return {
        ...node,
        x: existing ? existing.x : width / 2 + (Math.random() - 0.5) * 300,
        y: existing ? existing.y : height / 2 + (Math.random() - 0.5) * 300,
        vx: existing ? existing.vx : 0,
        vy: existing ? existing.vy : 0,
      };
    });

    const simLinks: GraphLink[] = filteredData.links.map((link) => ({
      ...link,
      source: typeof link.source === 'object' ? link.source.id : link.source,
      target: typeof link.target === 'object' ? link.target.id : link.target,
    }));

    // Grouping & nesting force: pods gravitate to parent nodes
    const simulation = d3
      .forceSimulation<GraphNode>(simNodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(simLinks)
          .id((d) => d.id)
          .distance((d) => {
            if (d.type === 'nesting') return 48;
            if (d.type === 'service-traffic') return 110;
            return 140;
          })
          .strength((d) => (d.type === 'nesting' ? 0.8 : 0.3))
      )
      .force(
        'charge',
        d3.forceManyBody().strength((d: any) => {
          if (d.type === 'node') return -1400; // Physical cluster nodes push apart strongly
          if (d.type === 'pod') return -220;
          if (d.type === 'service') return -300;
          return -40;
        })
      )
      .force('center', d3.forceCenter(width / 2, height / 2).strength(0.04))
      .force(
        'collide',
        d3.forceCollide().radius((d: any) => {
          if (d.type === 'node') return 80;
          if (d.type === 'pod') return 36;
          if (d.type === 'service') return 30;
          return 16;
        })
      )
      .alphaDecay(0.03);

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
    };
  }, [filteredData]);

  // Zoom & Drag handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        zoomTransformRef.current = event.transform;
      });

    d3.select(canvas).call(zoom);

    // Initial centering transform
    if (resetZoomTrigger === 0) {
      d3.select(canvas).call(
        zoom.transform,
        d3.zoomIdentity.translate(0, 0).scale(0.95)
      );
    }
  }, [resetZoomTrigger]);

  // Canvas Drawing & Animation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let time = 0;

    const render = () => {
      time += 0.03;
      const sim = simulationRef.current;
      if (!sim) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }

      const width = canvas.width;
      const height = canvas.height;
      const transform = zoomTransformRef.current;

      ctx.save();
      ctx.clearRect(0, 0, width, height);

      // Apply zoom & pan
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.k, transform.k);

      const nodes = sim.nodes();
      const links = (sim.force('link') as d3.ForceLink<GraphNode, GraphLink>)?.links() || [];

      // Helper map for node positions
      const posMap = new Map<string, { x: number; y: number }>();
      nodes.forEach((n) => {
        if (n.x != null && n.y != null) {
          posMap.set(n.id, { x: n.x, y: n.y });
        }
      });

      // 1. Draw Physical/VM Cluster Node Outer Atmospheric Enclosures
      nodes
        .filter((n) => n.type === 'node')
        .forEach((node) => {
          if (node.x == null || node.y == null) return;
          const k8sNode = node.data as K8sNode;

          // Ambient halo ring
          const radius = 80;
          const gradient = ctx.createRadialGradient(
            node.x,
            node.y,
            20,
            node.x,
            node.y,
            radius + 15
          );
          gradient.addColorStop(0, 'rgba(14, 116, 144, 0.12)');
          gradient.addColorStop(0.7, 'rgba(15, 23, 42, 0.4)');
          gradient.addColorStop(1, 'rgba(15, 23, 42, 0)');

          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 15, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();

          // Outer dashed perimeter
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
          ctx.strokeStyle =
            selectedNodeId === node.id ? 'rgba(56, 189, 248, 0.9)' : 'rgba(56, 189, 248, 0.35)';
          ctx.lineWidth = selectedNodeId === node.id ? 2.5 : 1.5;
          ctx.setLineDash([6, 6]);
          ctx.stroke();
          ctx.setLineDash([]);

          // Node Center Core
          ctx.beginPath();
          ctx.arc(node.x, node.y, 34, 0, Math.PI * 2);
          ctx.fillStyle = '#0f172a';
          ctx.fill();
          ctx.strokeStyle = '#0284c7';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Host Icon & Name
          ctx.fillStyle = '#f8fafc';
          ctx.font = 'bold 12px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(node.name, node.x, node.y - 48);

          // IP & Role Pill
          ctx.fillStyle = '#94a3b8';
          ctx.font = '10px monospace';
          ctx.fillText(k8sNode.internalIP || 'k3s-node', node.x, node.y - 34);

          // CPU & RAM usage indicator arc around the core
          const cpuAngle = ((k8sNode.cpuUsagePercent || 30) / 100) * (Math.PI * 2);
          ctx.beginPath();
          ctx.arc(node.x, node.y, 38, -Math.PI / 2, -Math.PI / 2 + cpuAngle);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 3;
          ctx.stroke();

          // Inside Core Text: Role
          ctx.fillStyle = '#38bdf8';
          ctx.font = 'bold 11px sans-serif';
          ctx.fillText(k8sNode.roles.includes('master') || k8sNode.roles.includes('control-plane') ? 'CONTROL' : 'WORKER', node.x, node.y);
          ctx.fillStyle = '#64748b';
          ctx.font = '9px monospace';
          ctx.fillText(`${k8sNode.podCount || 0} pods`, node.x, node.y + 12);
        });

      // 2. Draw Connection Links (Service traffic, Nesting, Pod-to-Pod)
      links.forEach((link) => {
        const source = typeof link.source === 'object' ? link.source : posMap.get(link.source as string);
        const target = typeof link.target === 'object' ? link.target : posMap.get(link.target as string);

        if (!source || !target || source.x == null || source.y == null || target.x == null || target.y == null) {
          return;
        }

        const isTrafficLink = link.type === 'service-traffic' || link.type === 'pod-to-pod';
        const isNestingLink = link.type === 'nesting';

        if (isNestingLink) {
          // Subtle radial spine connecting pods to their host node
          ctx.beginPath();
          ctx.moveTo(source.x, source.y);
          ctx.lineTo(target.x, target.y);
          ctx.strokeStyle = 'rgba(71, 85, 105, 0.25)';
          ctx.lineWidth = 1;
          ctx.stroke();
        } else if (isTrafficLink) {
          // High-visibility network traffic edge
          ctx.beginPath();
          ctx.moveTo(source.x, source.y);
          ctx.lineTo(target.x, target.y);
          ctx.strokeStyle = link.type === 'service-traffic' ? 'rgba(56, 189, 248, 0.45)' : 'rgba(168, 85, 247, 0.45)';
          ctx.lineWidth = 1.8;
          ctx.stroke();

          // Draw port label badge along the edge
          if (link.port) {
            const midX = (source.x + target.x) / 2;
            const midY = (source.y + target.y) / 2;

            const portText = `:${link.port}`;
            ctx.font = 'bold 9px monospace';
            const textWidth = ctx.measureText(portText).width;

            // Background pill
            ctx.fillStyle = '#090d16';
            ctx.fillRect(midX - textWidth / 2 - 3, midY - 6, textWidth + 6, 13);
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
            ctx.lineWidth = 1;
            ctx.strokeRect(midX - textWidth / 2 - 3, midY - 6, textWidth + 6, 13);

            ctx.fillStyle = '#38bdf8';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(portText, midX, midY + 1);
          }
        }
      });

      // 3. Draw Live Traffic Pulse Particles
      if (showTraffic) {
        links
          .filter((l) => l.type === 'service-traffic' || l.type === 'pod-to-pod')
          .forEach((link, idx) => {
            const source = typeof link.source === 'object' ? link.source : posMap.get(link.source as string);
            const target = typeof link.target === 'object' ? link.target : posMap.get(link.target as string);
            if (!source || !target || source.x == null || source.y == null || target.x == null || target.y == null) return;

            // Animated particle along the link
            const offset = ((time * 0.8 + idx * 0.35) % 1);
            const px = source.x + (target.x - source.x) * offset;
            const py = source.y + (target.y - source.y) * offset;

            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fillStyle = link.type === 'service-traffic' ? '#38bdf8' : '#c084fc';
            ctx.shadowColor = '#38bdf8';
            ctx.shadowBlur = 8;
            ctx.fill();
            ctx.shadowBlur = 0;
          });
      }

      // 4. Draw Service Hub Nodes (Diamond / Hexagon)
      nodes
        .filter((n) => n.type === 'service')
        .forEach((node) => {
          if (node.x == null || node.y == null) return;
          const svc = node.data as K8sService;
          const radius = 18;

          // Diamond path
          ctx.beginPath();
          ctx.moveTo(node.x, node.y - radius);
          ctx.lineTo(node.x + radius, node.y);
          ctx.lineTo(node.x, node.y + radius);
          ctx.lineTo(node.x - radius, node.y);
          ctx.closePath();

          ctx.fillStyle = '#0f172a';
          ctx.fill();
          ctx.strokeStyle = selectedNodeId === node.id ? '#38bdf8' : '#0284c7';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Svc icon or 'SVC'
          ctx.fillStyle = '#38bdf8';
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('SVC', node.x, node.y);

          // Name label below
          ctx.fillStyle = '#cbd5e1';
          ctx.font = '10px monospace';
          ctx.fillText(svc.name, node.x, node.y + 24);
        });

      // 5. Draw Pod Nodes (Color-coded status with breathing/glowing states)
      nodes
        .filter((n) => n.type === 'pod')
        .forEach((node) => {
          if (node.x == null || node.y == null) return;
          const pod = node.data as K8sPod;
          const radius = 24;

          // Status colors
          let statusColor = '#22c55e'; // green running
          let glowColor = 'rgba(34, 197, 94, 0.4)';

          if (pod.status === 'pending') {
            statusColor = '#eab308'; // yellow pending
            glowColor = 'rgba(234, 179, 8, 0.5)';
          } else if (pod.status === 'error') {
            statusColor = '#ef4444'; // red error
            glowColor = 'rgba(239, 68, 68, 0.7)';
          } else if (pod.status === 'terminating') {
            statusColor = '#94a3b8'; // grey terminating
            glowColor = 'rgba(148, 163, 184, 0.4)';
          }

          // Search highlight or dim
          const isMatch =
            !searchQuery ||
            node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            pod.namespace.toLowerCase().includes(searchQuery.toLowerCase());

          ctx.globalAlpha = isMatch ? 1.0 : 0.2;

          // Pulsing Beacon for Error or Pending Pods
          if (pod.status === 'error' || pod.status === 'pending') {
            const pulseRadius = radius + 6 + Math.sin(time * 6) * 4;
            ctx.beginPath();
            ctx.arc(node.x, node.y, pulseRadius, 0, Math.PI * 2);
            ctx.strokeStyle = statusColor;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }

          // Ambient Glow
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 3, 0, Math.PI * 2);
          ctx.fillStyle = glowColor;
          ctx.fill();

          // Main Pod Circle
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = '#0f172a';
          ctx.fill();

          ctx.strokeStyle = selectedNodeId === node.id ? '#ffffff' : statusColor;
          ctx.lineWidth = selectedNodeId === node.id ? 3 : 2;
          ctx.stroke();

          // Ready Containers indicator (e.g. 1/1)
          const readyCount = pod.containers.filter((c) => c.ready).length;
          const totalCount = pod.containers.length;

          ctx.fillStyle = statusColor;
          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${readyCount}/${totalCount}`, node.x, node.y);

          // Pod Short Label Above or Below
          ctx.fillStyle = '#f1f5f9';
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          // Truncate name cleanly
          let cleanName = pod.name;
          if (cleanName.length > 18) {
            cleanName = cleanName.substring(0, 16) + '..';
          }
          ctx.fillText(cleanName, node.x, node.y + 32);

          ctx.globalAlpha = 1.0;
        });

      // 6. Draw Container Nodes if enabled
      if (showContainers) {
        nodes
          .filter((n) => n.type === 'container')
          .forEach((node) => {
            if (node.x == null || node.y == null) return;
            const radius = 8;
            const isReady = node.status === 'running';

            ctx.beginPath();
            ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = isReady ? '#22c55e' : '#ef4444';
            ctx.fill();
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Label
            ctx.fillStyle = '#94a3b8';
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(node.name, node.x, node.y + 14);
          });
      }

      ctx.restore();

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [showTraffic, showContainers, selectedNodeId, searchQuery]);

  // Pointer Click & Hover Detection
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !simulationRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const transform = zoomTransformRef.current;

    // Convert mouse client coordinates to simulation coordinates
    const mouseX = (e.clientX - rect.left - transform.x) / transform.k;
    const mouseY = (e.clientY - rect.top - transform.y) / transform.k;

    const clicked = simulationRef.current.find(mouseX, mouseY, 30);
    if (clicked) {
      onSelectNode(clicked);
    } else {
      onSelectNode(null);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !simulationRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const transform = zoomTransformRef.current;

    const mouseX = (e.clientX - rect.left - transform.x) / transform.k;
    const mouseY = (e.clientY - rect.top - transform.y) / transform.k;

    const target = simulationRef.current.find(mouseX, mouseY, 28);
    if (target) {
      setHoveredNode(target);
      setTooltipPos({ x: e.clientX, y: e.clientY });
    } else {
      setHoveredNode(null);
      setTooltipPos(null);
    }
  };

  // Resize canvas to match container
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full graph-bg-grid overflow-hidden">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => {
          setHoveredNode(null);
          setTooltipPos(null);
        }}
        className="w-full h-full cursor-grab active:cursor-grabbing block"
      />

      {/* Hover Tooltip */}
      {hoveredNode && tooltipPos && (
        <div
          className="fixed pointer-events-none z-30 px-3 py-2 bg-slate-900/95 border border-slate-700 rounded-lg shadow-2xl text-xs text-white max-w-xs transition-opacity duration-150"
          style={{
            left: `${tooltipPos.x + 14}px`,
            top: `${tooltipPos.y + 14}px`,
          }}
        >
          <div className="flex items-center gap-1.5 mb-1 font-semibold text-cyan-400">
            <span className="uppercase text-[10px] px-1 py-0.5 rounded bg-slate-800 border border-slate-700">
              {hoveredNode.type}
            </span>
            <span className="truncate">{hoveredNode.name}</span>
          </div>

          {hoveredNode.type === 'pod' && (
            <div className="space-y-0.5 text-slate-300">
              <div className="flex justify-between gap-2">
                <span className="text-slate-400">Namespace:</span>
                <span className="font-mono">{hoveredNode.namespace}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-400">Status:</span>
                <span
                  className={`font-semibold capitalize ${
                    hoveredNode.status === 'running'
                      ? 'text-emerald-400'
                      : hoveredNode.status === 'pending'
                      ? 'text-amber-400'
                      : 'text-rose-400'
                  }`}
                >
                  {hoveredNode.status}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-400">Node:</span>
                <span className="font-mono text-slate-200">
                  {(hoveredNode.data as K8sPod).nodeName || 'unassigned'}
                </span>
              </div>
            </div>
          )}

          {hoveredNode.type === 'node' && (
            <div className="space-y-0.5 text-slate-300">
              <div className="flex justify-between gap-2">
                <span className="text-slate-400">IP:</span>
                <span className="font-mono">{(hoveredNode.data as K8sNode).internalIP}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-400">Pods:</span>
                <span className="font-semibold text-emerald-400">
                  {(hoveredNode.data as K8sNode).podCount} running
                </span>
              </div>
            </div>
          )}

          {hoveredNode.type === 'service' && (
            <div className="space-y-0.5 text-slate-300">
              <div className="flex justify-between gap-2">
                <span className="text-slate-400">Type:</span>
                <span className="font-mono">{(hoveredNode.data as K8sService).type}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-400">ClusterIP:</span>
                <span className="font-mono">{(hoveredNode.data as K8sService).clusterIP || 'None'}</span>
              </div>
            </div>
          )}

          <div className="mt-1.5 pt-1 border-t border-slate-800 text-[10px] text-slate-400 italic">
            Click to inspect full details
          </div>
        </div>
      )}
    </div>
  );
};
