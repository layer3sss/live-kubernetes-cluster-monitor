/**
 * Core type definitions for KubeMind - Live Kubernetes Cluster Monitor
 */

export type K8sStatus = 'running' | 'pending' | 'error' | 'terminating' | 'unknown';

export interface K8sContainerPort {
  containerPort: number;
  name?: string;
  protocol?: string;
}

export interface K8sContainer {
  name: string;
  image: string;
  ready: boolean;
  restartCount: number;
  state: 'running' | 'waiting' | 'terminated';
  stateReason?: string;
  ports: K8sContainerPort[];
  resources?: {
    requests?: { cpu?: string; memory?: string };
    limits?: { cpu?: string; memory?: string };
  };
}

export interface K8sPodCondition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
}

export interface K8sPod {
  id: string; // e.g., 'default/frontend-app-7b8f'
  name: string;
  namespace: string;
  nodeName: string;
  status: K8sStatus;
  statusMessage?: string;
  phase: string;
  podIP?: string;
  startTime?: string;
  labels: Record<string, string>;
  containers: K8sContainer[];
  totalRestarts: number;
  conditions: K8sPodCondition[];
}

export interface K8sNode {
  id: string;
  name: string;
  status: 'ready' | 'not-ready' | 'unknown';
  internalIP?: string;
  roles: string[];
  kubeletVersion?: string;
  osImage?: string;
  cpuCapacity?: string;
  memCapacity?: string;
  cpuUsagePercent?: number;
  memUsagePercent?: number;
  podCount: number;
  conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>;
}

export interface K8sServicePort {
  name?: string;
  port: number;
  targetPort: number | string;
  protocol: string;
}

export interface K8sService {
  id: string;
  name: string;
  namespace: string;
  type: string;
  clusterIP?: string;
  ports: K8sServicePort[];
  selector: Record<string, string>;
  targetPods: string[]; // Pod IDs backing this service (via Endpoints)
}

export type GraphNodeType = 'node' | 'pod' | 'container' | 'service';

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  name: string;
  namespace?: string;
  parentNodeId?: string; // Pod ID for containers, Node ID for pods
  status: K8sStatus | 'ready' | 'not-ready';
  data: K8sNode | K8sPod | K8sContainer | K8sService;
  // Simulation coordinate props (used by D3 force)
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  radius?: number;
}

export interface GraphLink {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  type: 'nesting' | 'service-traffic' | 'pod-to-pod';
  port?: number | string;
  protocol?: string;
  serviceName?: string;
  trafficActive?: boolean;
}

export interface ClusterStats {
  totalNodes: number;
  readyNodes: number;
  totalPods: number;
  runningPods: number;
  pendingPods: number;
  errorPods: number;
  totalNamespaces: number;
  cpuTotalCores?: number;
  cpuUsedPercent?: number;
  memTotalGiB?: number;
  memUsedPercent?: number;
  isLiveCluster: boolean;
  clusterName: string;
  cni: string;
  ingressController: string;
}

export interface ClusterGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  clusterStats: ClusterStats;
  namespaces: string[];
  timestamp: number;
}

// WebSocket message contract
export type WSClientMessage =
  | { type: 'get_state' }
  | { type: 'simulate_event'; action: 'restart_pod' | 'crash_pod' | 'add_pod' | 'delete_pod' | 'simulate_traffic' };

export type WSServerMessage =
  | { type: 'init'; data: ClusterGraph }
  | { type: 'graph_update'; data: ClusterGraph }
  | { type: 'pod_event'; event: 'ADDED' | 'MODIFIED' | 'DELETED'; pod: K8sPod }
  | { type: 'node_event'; event: 'ADDED' | 'MODIFIED' | 'DELETED'; node: K8sNode }
  | { type: 'service_event'; event: 'ADDED' | 'MODIFIED' | 'DELETED'; service: K8sService }
  | { type: 'traffic_pulse'; linkId: string; source: string; target: string; port: number | string }
  | { type: 'status_message'; text: string; level: 'info' | 'warn' | 'error' };
