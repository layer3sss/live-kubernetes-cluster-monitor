import * as k8s from '@kubernetes/client-node';
import {
  ClusterGraph,
  K8sContainer,
  K8sNode,
  K8sPod,
  K8sPodCondition,
  K8sService,
  K8sStatus,
  WSServerMessage,
} from '../src/types.js';
import { buildClusterGraph } from './graph-builder.js';

export class KubernetesWatcher {
  private kc: k8s.KubeConfig;
  private k8sApi: k8s.CoreV1Api | null = null;
  private watch: k8s.Watch | null = null;
  private isLiveCluster: boolean = false;
  private clusterName: string = 'k3s-cluster';

  // Internal synchronized state
  private nodes = new Map<string, K8sNode>();
  private pods = new Map<string, K8sPod>();
  private services = new Map<string, K8sService>();
  private endpoints = new Map<string, string[]>(); // svc namespace/name -> list of pod IDs

  private updateListeners: ((msg: WSServerMessage) => void)[] = [];
  private simulationInterval: NodeJS.Timeout | null = null;
  private pulseInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.kc = new k8s.KubeConfig();
    this.initKubeConfig();
  }

  private initKubeConfig() {
    try {
      // 1. In-cluster auto-detection (when running inside k3s as Pod with ServiceAccount)
      this.kc.loadFromCluster();
      this.isLiveCluster = true;
      this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
      this.watch = new k8s.Watch(this.kc);
      const currentContext = this.kc.getCurrentContext();
      this.clusterName = currentContext || 'k3s-in-cluster';
      console.log('[KubeWatcher] Successfully loaded in-cluster Kubernetes config.');
    } catch (clusterErr: any) {
      try {
        // 2. Fallback to default local kubeconfig (e.g. during local developer testing)
        this.kc.loadFromDefault();
        const currentContext = this.kc.getCurrentContext();
        if (currentContext) {
          this.isLiveCluster = true;
          this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
          this.watch = new k8s.Watch(this.kc);
          this.clusterName = currentContext;
          console.log(`[KubeWatcher] Loaded kubeconfig from default with context: ${currentContext}`);
        } else {
          throw new Error('No context found in default kubeconfig');
        }
      } catch (defaultErr: any) {
        // 3. Fallback to simulation mode for sandbox / dev preview environments
        this.isLiveCluster = false;
        this.clusterName = 'k3s-demo-cluster (Tailscale 100.82.72.81)';
        console.log('[KubeWatcher] Running in high-fidelity simulated k3s cluster mode.');
      }
    }
  }

  public async start() {
    if (this.isLiveCluster && this.k8sApi) {
      try {
        console.log('[KubeWatcher] Fetching initial cluster state from Kubernetes API...');
        await this.syncInitialState();
        this.startWatching();
      } catch (err: any) {
        console.warn('[KubeWatcher] Failed to reach live K8s API (switching to live simulation):', err.message);
        this.isLiveCluster = false;
        this.initSimulatedCluster();
      }
    } else {
      this.initSimulatedCluster();
    }

    // Start periodic background traffic pulse emitter for the live animated effect
    this.startTrafficPulseEmitter();
  }

  public stop() {
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
    if (this.pulseInterval) {
      clearInterval(this.pulseInterval);
      this.pulseInterval = null;
    }
  }

  public onUpdate(callback: (msg: WSServerMessage) => void) {
    this.updateListeners.push(callback);
  }

  private broadcast(msg: WSServerMessage) {
    for (const listener of this.updateListeners) {
      try {
        listener(msg);
      } catch (err) {
        console.error('[KubeWatcher] Broadcast error:', err);
      }
    }
  }

  public getGraph(): ClusterGraph {
    return buildClusterGraph(
      Array.from(this.nodes.values()),
      Array.from(this.pods.values()),
      Array.from(this.services.values()),
      {
        isLiveCluster: this.isLiveCluster,
        clusterName: this.clusterName,
      }
    );
  }

  // --- Real Kubernetes API Handlers ---

  private async syncInitialState() {
    if (!this.k8sApi) return;

    // 1. Nodes
    const nodeRes = await this.k8sApi.listNode();
    this.nodes.clear();
    const nodeItems = (nodeRes as any).items || (nodeRes as any).body?.items || [];
    for (const item of nodeItems) {
      const parsed = this.parseK8sNode(item);
      this.nodes.set(parsed.name, parsed);
    }

    // 2. Pods
    const podRes = await this.k8sApi.listPodForAllNamespaces();
    this.pods.clear();
    const podItems = (podRes as any).items || (podRes as any).body?.items || [];
    for (const item of podItems) {
      const parsed = this.parseK8sPod(item);
      this.pods.set(parsed.id, parsed);
    }

    // Update node pod counts
    for (const node of this.nodes.values()) {
      node.podCount = Array.from(this.pods.values()).filter((p) => p.nodeName === node.name).length;
    }

    // 3. Endpoints
    try {
      const epRes = await this.k8sApi.listEndpointsForAllNamespaces();
      this.endpoints.clear();
      const epItems = (epRes as any).items || (epRes as any).body?.items || [];
      for (const ep of epItems) {
        const key = `${ep.metadata?.namespace}/${ep.metadata?.name}`;
        const targetPods: string[] = [];
        if (ep.subsets) {
          for (const subset of ep.subsets) {
            if (subset.addresses) {
              for (const addr of subset.addresses) {
                if (addr.targetRef && addr.targetRef.kind === 'Pod' && addr.targetRef.name) {
                  targetPods.push(`${ep.metadata?.namespace}/${addr.targetRef.name}`);
                }
              }
            }
          }
        }
        this.endpoints.set(key, targetPods);
      }
    } catch (e) {
      console.warn('[KubeWatcher] Could not list endpoints:', e);
    }

    // 4. Services
    const svcRes = await this.k8sApi.listServiceForAllNamespaces();
    this.services.clear();
    const svcItems = (svcRes as any).items || (svcRes as any).body?.items || [];
    for (const item of svcItems) {
      const parsed = this.parseK8sService(item);
      const epKey = `${parsed.namespace}/${parsed.name}`;
      parsed.targetPods = this.endpoints.get(epKey) || [];
      this.services.set(parsed.id, parsed);
    }

    console.log(
      `[KubeWatcher] Synced: ${this.nodes.size} nodes, ${this.pods.size} pods, ${this.services.size} services.`
    );
  }

  private startWatching() {
    if (!this.watch) return;

    // Watch Nodes
    this.watch.watch(
      '/api/v1/nodes',
      {},
      (type, apiObj) => {
        const node = this.parseK8sNode(apiObj);
        if (type === 'ADDED' || type === 'MODIFIED') {
          this.nodes.set(node.name, node);
          this.broadcast({ type: 'node_event', event: type, node });
        } else if (type === 'DELETED') {
          this.nodes.delete(node.name);
          this.broadcast({ type: 'node_event', event: 'DELETED', node });
        }
        this.broadcast({ type: 'graph_update', data: this.getGraph() });
      },
      (err) => {
        if (err) console.warn('[KubeWatcher] Watch nodes stream ended/error:', err.message);
        setTimeout(() => this.startWatching(), 5000);
      }
    );

    // Watch Pods
    this.watch.watch(
      '/api/v1/pods',
      {},
      (type, apiObj) => {
        const pod = this.parseK8sPod(apiObj);
        if (type === 'ADDED' || type === 'MODIFIED') {
          this.pods.set(pod.id, pod);
          this.broadcast({ type: 'pod_event', event: type, pod });
        } else if (type === 'DELETED') {
          this.pods.delete(pod.id);
          this.broadcast({ type: 'pod_event', event: 'DELETED', pod });
        }
        this.broadcast({ type: 'graph_update', data: this.getGraph() });
      },
      (err) => {
        if (err) console.warn('[KubeWatcher] Watch pods stream ended/error:', err.message);
      }
    );

    // Watch Services
    this.watch.watch(
      '/api/v1/services',
      {},
      (type, apiObj) => {
        const svc = this.parseK8sService(apiObj);
        if (type === 'ADDED' || type === 'MODIFIED') {
          svc.targetPods = this.endpoints.get(`${svc.namespace}/${svc.name}`) || [];
          this.services.set(svc.id, svc);
          this.broadcast({ type: 'service_event', event: type, service: svc });
        } else if (type === 'DELETED') {
          this.services.delete(svc.id);
          this.broadcast({ type: 'service_event', event: 'DELETED', service: svc });
        }
        this.broadcast({ type: 'graph_update', data: this.getGraph() });
      },
      (err) => {
        if (err) console.warn('[KubeWatcher] Watch services stream ended/error:', err.message);
      }
    );
  }

  private parseK8sNode(item: any): K8sNode {
    const name = item.metadata?.name || 'unknown-node';
    let status: 'ready' | 'not-ready' | 'unknown' = 'unknown';

    if (item.status?.conditions) {
      const readyCond = item.status.conditions.find((c: any) => c.type === 'Ready');
      if (readyCond) {
        status = readyCond.status === 'True' ? 'ready' : 'not-ready';
      }
    }

    const roles: string[] = [];
    if (item.metadata?.labels) {
      for (const [k] of Object.entries(item.metadata.labels)) {
        if (k.startsWith('node-role.kubernetes.io/')) {
          roles.push(k.replace('node-role.kubernetes.io/', ''));
        }
      }
    }
    if (roles.length === 0) roles.push('worker');

    let internalIP = '';
    if (item.status?.addresses) {
      const internal = item.status.addresses.find((a: any) => a.type === 'InternalIP');
      if (internal) internalIP = internal.address;
    }

    return {
      id: name,
      name,
      status,
      internalIP,
      roles,
      kubeletVersion: item.status?.nodeInfo?.kubeletVersion || 'v1.28.2+k3s1',
      osImage: item.status?.nodeInfo?.osImage || 'Alpine Linux v3.19',
      cpuCapacity: item.status?.capacity?.cpu || '4',
      memCapacity: item.status?.capacity?.memory || '8Gi',
      cpuUsagePercent: Math.round(25 + Math.random() * 20),
      memUsagePercent: Math.round(40 + Math.random() * 15),
      podCount: 0,
      conditions: item.status?.conditions || [],
    };
  }

  private parseK8sPod(item: any): K8sPod {
    const name = item.metadata?.name || 'unknown-pod';
    const namespace = item.metadata?.namespace || 'default';
    const id = `${namespace}/${name}`;
    const phase = item.status?.phase || 'Unknown';

    // Calculate fine-grained status: running, pending, error, terminating, unknown
    let status: K8sStatus = 'unknown';
    if (item.metadata?.deletionTimestamp) {
      status = 'terminating';
    } else if (phase === 'Running') {
      const containerStatuses = item.status?.containerStatuses || [];
      const hasCrashLoop = containerStatuses.some(
        (cs: any) => cs.state?.waiting?.reason === 'CrashLoopBackOff' || cs.state?.waiting?.reason === 'Error'
      );
      if (hasCrashLoop) {
        status = 'error';
      } else {
        const allReady = containerStatuses.length > 0 && containerStatuses.every((cs: any) => cs.ready);
        status = allReady ? 'running' : 'pending';
      }
    } else if (phase === 'Pending') {
      status = 'pending';
    } else if (phase === 'Failed') {
      status = 'error';
    } else if (phase === 'Succeeded') {
      status = 'running';
    }

    // Extract containers
    const containers: K8sContainer[] = [];
    const specContainers = item.spec?.containers || [];
    const containerStatuses = item.status?.containerStatuses || [];

    for (const sc of specContainers) {
      const cs = containerStatuses.find((c: any) => c.name === sc.name);
      let state: 'running' | 'waiting' | 'terminated' = 'waiting';
      let stateReason: string | undefined;

      if (cs?.state?.running) {
        state = 'running';
      } else if (cs?.state?.waiting) {
        state = 'waiting';
        stateReason = cs.state.waiting.reason;
      } else if (cs?.state?.terminated) {
        state = 'terminated';
        stateReason = cs.state.terminated.reason;
      }

      containers.push({
        name: sc.name,
        image: sc.image || 'unknown',
        ready: Boolean(cs?.ready),
        restartCount: cs?.restartCount || 0,
        state,
        stateReason,
        ports: (sc.ports || []).map((p: any) => ({
          containerPort: p.containerPort,
          name: p.name,
          protocol: p.protocol || 'TCP',
        })),
        resources: sc.resources,
      });
    }

    const totalRestarts = containers.reduce((acc, c) => acc + c.restartCount, 0);

    const conditions: K8sPodCondition[] = (item.status?.conditions || []).map((c: any) => ({
      type: c.type,
      status: c.status,
      reason: c.reason,
      message: c.message,
    }));

    return {
      id,
      name,
      namespace,
      nodeName: item.spec?.nodeName || '',
      status,
      phase,
      statusMessage: item.status?.message || phase,
      podIP: item.status?.podIP,
      startTime: item.status?.startTime,
      labels: item.metadata?.labels || {},
      containers,
      totalRestarts,
      conditions,
    };
  }

  private parseK8sService(item: any): K8sService {
    const name = item.metadata?.name || 'unknown-svc';
    const namespace = item.metadata?.namespace || 'default';
    const id = `${namespace}/${name}`;

    const ports = (item.spec?.ports || []).map((p: any) => ({
      name: p.name,
      port: p.port,
      targetPort: p.targetPort,
      protocol: p.protocol || 'TCP',
    }));

    return {
      id,
      name,
      namespace,
      type: item.spec?.type || 'ClusterIP',
      clusterIP: item.spec?.clusterIP,
      ports,
      selector: item.spec?.selector || {},
      targetPods: [],
    };
  }

  // --- High-Fidelity Realistic k3s Simulation Mode ---

  private initSimulatedCluster() {
    this.nodes.clear();
    this.pods.clear();
    this.services.clear();
    this.endpoints.clear();

    // 1. Standard k3s Cluster Nodes
    const simNodes: K8sNode[] = [
      {
        id: 'k3s-master-01',
        name: 'k3s-master-01',
        status: 'ready',
        internalIP: '100.82.72.81', // Matches user's Tailscale node IP
        roles: ['control-plane', 'master'],
        kubeletVersion: 'v1.28.8+k3s1',
        osImage: 'Alpine Linux v3.19',
        cpuCapacity: '4',
        memCapacity: '8Gi',
        cpuUsagePercent: 32,
        memUsagePercent: 54,
        podCount: 8,
      },
      {
        id: 'k3s-worker-01',
        name: 'k3s-worker-01',
        status: 'ready',
        internalIP: '100.82.72.82',
        roles: ['worker'],
        kubeletVersion: 'v1.28.8+k3s1',
        osImage: 'Alpine Linux v3.19',
        cpuCapacity: '4',
        memCapacity: '8Gi',
        cpuUsagePercent: 44,
        memUsagePercent: 61,
        podCount: 9,
      },
      {
        id: 'k3s-worker-02',
        name: 'k3s-worker-02',
        status: 'ready',
        internalIP: '100.82.72.83',
        roles: ['worker'],
        kubeletVersion: 'v1.28.8+k3s1',
        osImage: 'Alpine Linux v3.19',
        cpuCapacity: '4',
        memCapacity: '8Gi',
        cpuUsagePercent: 38,
        memUsagePercent: 47,
        podCount: 7,
      },
    ];

    for (const n of simNodes) {
      this.nodes.set(n.name, n);
    }

    // 2. Pods across namespaces (kube-system, cluster-monitor, production, default)
    const simPods: K8sPod[] = [
      // kube-system
      {
        id: 'kube-system/traefik-56c84f67-8zlkq',
        name: 'traefik-56c84f67-8zlkq',
        namespace: 'kube-system',
        nodeName: 'k3s-master-01',
        status: 'running',
        phase: 'Running',
        podIP: '10.42.0.8',
        labels: { 'app.kubernetes.io/name': 'traefik', app: 'traefik' },
        containers: [
          {
            name: 'traefik',
            image: 'rancher/mirrored-library-traefik:2.10.5',
            ready: true,
            restartCount: 0,
            state: 'running',
            ports: [
              { containerPort: 80, name: 'web', protocol: 'TCP' },
              { containerPort: 443, name: 'websecure', protocol: 'TCP' },
            ],
            resources: { requests: { cpu: '50m', memory: '80Mi' }, limits: { cpu: '200m', memory: '250Mi' } },
          },
        ],
        totalRestarts: 0,
        conditions: [{ type: 'Ready', status: 'True' }, { type: 'ContainersReady', status: 'True' }],
      },
      {
        id: 'kube-system/coredns-6799fc886-v7qpt',
        name: 'coredns-6799fc886-v7qpt',
        namespace: 'kube-system',
        nodeName: 'k3s-master-01',
        status: 'running',
        phase: 'Running',
        podIP: '10.42.0.4',
        labels: { 'k8s-app': 'kube-dns' },
        containers: [
          {
            name: 'coredns',
            image: 'rancher/mirrored-coredns-coredns:1.10.1',
            ready: true,
            restartCount: 0,
            state: 'running',
            ports: [
              { containerPort: 53, name: 'dns', protocol: 'UDP' },
              { containerPort: 53, name: 'dns-tcp', protocol: 'TCP' },
            ],
            resources: { requests: { cpu: '20m', memory: '30Mi' }, limits: { cpu: '100m', memory: '100Mi' } },
          },
        ],
        totalRestarts: 0,
        conditions: [{ type: 'Ready', status: 'True' }],
      },
      {
        id: 'kube-system/local-path-provisioner-7577fdbbfb-d98g5',
        name: 'local-path-provisioner-7577fdbbfb-d98g5',
        namespace: 'kube-system',
        nodeName: 'k3s-master-01',
        status: 'running',
        phase: 'Running',
        podIP: '10.42.0.5',
        labels: { app: 'local-path-provisioner' },
        containers: [
          {
            name: 'local-path-provisioner',
            image: 'rancher/local-path-provisioner:v0.0.26',
            ready: true,
            restartCount: 0,
            state: 'running',
            ports: [],
            resources: { requests: { cpu: '10m', memory: '25Mi' } },
          },
        ],
        totalRestarts: 0,
        conditions: [{ type: 'Ready', status: 'True' }],
      },
      {
        id: 'kube-system/metrics-server-5544485cb9-j2s8w',
        name: 'metrics-server-5544485cb9-j2s8w',
        namespace: 'kube-system',
        nodeName: 'k3s-worker-01',
        status: 'running',
        phase: 'Running',
        podIP: '10.42.1.9',
        labels: { 'k8s-app': 'metrics-server' },
        containers: [
          {
            name: 'metrics-server',
            image: 'rancher/mirrored-metrics-server:v0.6.3',
            ready: true,
            restartCount: 0,
            state: 'running',
            ports: [{ containerPort: 4443, name: 'https', protocol: 'TCP' }],
            resources: { requests: { cpu: '30m', memory: '40Mi' } },
          },
        ],
        totalRestarts: 0,
        conditions: [{ type: 'Ready', status: 'True' }],
      },
      {
        id: 'kube-system/flannel-master',
        name: 'flannel-master',
        namespace: 'kube-system',
        nodeName: 'k3s-master-01',
        status: 'running',
        phase: 'Running',
        podIP: '100.82.72.81',
        labels: { app: 'flannel', 'k8s-app': 'flannel' },
        containers: [
          {
            name: 'kube-flannel',
            image: 'rancher/mirrored-flannel-cni:v0.22.2',
            ready: true,
            restartCount: 0,
            state: 'running',
            ports: [],
          },
        ],
        totalRestarts: 0,
        conditions: [{ type: 'Ready', status: 'True' }],
      },
      {
        id: 'kube-system/flannel-worker-01',
        name: 'flannel-worker-01',
        namespace: 'kube-system',
        nodeName: 'k3s-worker-01',
        status: 'running',
        phase: 'Running',
        podIP: '100.82.72.82',
        labels: { app: 'flannel', 'k8s-app': 'flannel' },
        containers: [
          {
            name: 'kube-flannel',
            image: 'rancher/mirrored-flannel-cni:v0.22.2',
            ready: true,
            restartCount: 0,
            state: 'running',
            ports: [],
          },
        ],
        totalRestarts: 0,
        conditions: [{ type: 'Ready', status: 'True' }],
      },
      {
        id: 'kube-system/flannel-worker-02',
        name: 'flannel-worker-02',
        namespace: 'kube-system',
        nodeName: 'k3s-worker-02',
        status: 'running',
        phase: 'Running',
        podIP: '100.82.72.83',
        labels: { app: 'flannel', 'k8s-app': 'flannel' },
        containers: [
          {
            name: 'kube-flannel',
            image: 'rancher/mirrored-flannel-cni:v0.22.2',
            ready: true,
            restartCount: 0,
            state: 'running',
            ports: [],
          },
        ],
        totalRestarts: 0,
        conditions: [{ type: 'Ready', status: 'True' }],
      },

      // cluster-monitor namespace (our app self-monitoring!)
      {
        id: 'cluster-monitor/cluster-monitor-79c59ff7b-q9plx',
        name: 'cluster-monitor-79c59ff7b-q9plx',
        namespace: 'cluster-monitor',
        nodeName: 'k3s-worker-01',
        status: 'running',
        phase: 'Running',
        podIP: '10.42.1.25',
        labels: { app: 'cluster-monitor' },
        containers: [
          {
            name: 'monitor',
            image: 'cluster-monitor:latest',
            ready: true,
            restartCount: 0,
            state: 'running',
            ports: [{ containerPort: 3000, name: 'http', protocol: 'TCP' }],
            resources: { requests: { cpu: '50m', memory: '100Mi' }, limits: { cpu: '200m', memory: '300Mi' } },
          },
        ],
        totalRestarts: 0,
        conditions: [{ type: 'Ready', status: 'True' }, { type: 'ContainersReady', status: 'True' }],
      },

      // production namespace
      {
        id: 'production/web-frontend-67f78d-9j42k',
        name: 'web-frontend-67f78d-9j42k',
        namespace: 'production',
        nodeName: 'k3s-worker-01',
        status: 'running',
        phase: 'Running',
        podIP: '10.42.1.14',
        labels: { app: 'web-frontend', tier: 'frontend' },
        containers: [
          {
            name: 'nginx-spa',
            image: 'nginx:1.25-alpine',
            ready: true,
            restartCount: 0,
            state: 'running',
            ports: [{ containerPort: 80, name: 'http', protocol: 'TCP' }],
            resources: { requests: { cpu: '50m', memory: '64Mi' } },
          },
        ],
        totalRestarts: 0,
        conditions: [{ type: 'Ready', status: 'True' }],
      },
      {
        id: 'production/web-frontend-67f78d-p4x11',
        name: 'web-frontend-67f78d-p4x11',
        namespace: 'production',
        nodeName: 'k3s-worker-02',
        status: 'running',
        phase: 'Running',
        podIP: '10.42.2.19',
        labels: { app: 'web-frontend', tier: 'frontend' },
        containers: [
          {
            name: 'nginx-spa',
            image: 'nginx:1.25-alpine',
            ready: true,
            restartCount: 0,
            state: 'running',
            ports: [{ containerPort: 80, name: 'http', protocol: 'TCP' }],
            resources: { requests: { cpu: '50m', memory: '64Mi' } },
          },
        ],
        totalRestarts: 0,
        conditions: [{ type: 'Ready', status: 'True' }],
      },
      {
        id: 'production/api-gateway-55c4d6-h82la',
        name: 'api-gateway-55c4d6-h82la',
        namespace: 'production',
        nodeName: 'k3s-worker-01',
        status: 'running',
        phase: 'Running',
        podIP: '10.42.1.20',
        labels: { app: 'api-gateway', tier: 'backend' },
        containers: [
          {
            name: 'api-server',
            image: 'golang:1.22-alpine',
            ready: true,
            restartCount: 1,
            state: 'running',
            ports: [{ containerPort: 8080, name: 'api', protocol: 'TCP' }],
            resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '500m', memory: '256Mi' } },
          },
        ],
        totalRestarts: 1,
        conditions: [{ type: 'Ready', status: 'True' }],
      },
      {
        id: 'production/api-gateway-55c4d6-m9zop',
        name: 'api-gateway-55c4d6-m9zop',
        namespace: 'production',
        nodeName: 'k3s-worker-02',
        status: 'running',
        phase: 'Running',
        podIP: '10.42.2.22',
        labels: { app: 'api-gateway', tier: 'backend' },
        containers: [
          {
            name: 'api-server',
            image: 'golang:1.22-alpine',
            ready: true,
            restartCount: 0,
            state: 'running',
            ports: [{ containerPort: 8080, name: 'api', protocol: 'TCP' }],
            resources: { requests: { cpu: '100m', memory: '128Mi' } },
          },
        ],
        totalRestarts: 0,
        conditions: [{ type: 'Ready', status: 'True' }],
      },
      {
        id: 'production/auth-service-789bc-v2x4r',
        name: 'auth-service-789bc-v2x4r',
        namespace: 'production',
        nodeName: 'k3s-worker-02',
        status: 'running',
        phase: 'Running',
        podIP: '10.42.2.31',
        labels: { app: 'auth-service', tier: 'backend' },
        containers: [
          {
            name: 'auth-worker',
            image: 'node:20-alpine',
            ready: true,
            restartCount: 0,
            state: 'running',
            ports: [{ containerPort: 4000, name: 'auth', protocol: 'TCP' }],
            resources: { requests: { cpu: '80m', memory: '96Mi' } },
          },
        ],
        totalRestarts: 0,
        conditions: [{ type: 'Ready', status: 'True' }],
      },
      {
        id: 'production/postgres-db-0',
        name: 'postgres-db-0',
        namespace: 'production',
        nodeName: 'k3s-worker-02',
        status: 'running',
        phase: 'Running',
        podIP: '10.42.2.45',
        labels: { app: 'postgres-db', tier: 'database' },
        containers: [
          {
            name: 'postgres',
            image: 'postgres:16-alpine',
            ready: true,
            restartCount: 0,
            state: 'running',
            ports: [{ containerPort: 5432, name: 'postgresql', protocol: 'TCP' }],
            resources: { requests: { cpu: '150m', memory: '256Mi' }, limits: { cpu: '600m', memory: '512Mi' } },
          },
        ],
        totalRestarts: 0,
        conditions: [{ type: 'Ready', status: 'True' }],
      },
      {
        id: 'production/redis-cache-7b649d-m3q1a',
        name: 'redis-cache-7b649d-m3q1a',
        namespace: 'production',
        nodeName: 'k3s-worker-01',
        status: 'running',
        phase: 'Running',
        podIP: '10.42.1.33',
        labels: { app: 'redis-cache', tier: 'cache' },
        containers: [
          {
            name: 'redis',
            image: 'redis:7.2-alpine',
            ready: true,
            restartCount: 0,
            state: 'running',
            ports: [{ containerPort: 6379, name: 'redis', protocol: 'TCP' }],
            resources: { requests: { cpu: '50m', memory: '64Mi' } },
          },
        ],
        totalRestarts: 0,
        conditions: [{ type: 'Ready', status: 'True' }],
      },

      // default namespace
      {
        id: 'default/nextcloud-app-58cb9d-2zk5l',
        name: 'nextcloud-app-58cb9d-2zk5l',
        namespace: 'default',
        nodeName: 'k3s-worker-01',
        status: 'running',
        phase: 'Running',
        podIP: '10.42.1.51',
        labels: { app: 'nextcloud' },
        containers: [
          {
            name: 'nextcloud',
            image: 'nextcloud:28-apache',
            ready: true,
            restartCount: 2,
            state: 'running',
            ports: [{ containerPort: 80, name: 'http', protocol: 'TCP' }],
            resources: { requests: { cpu: '120m', memory: '200Mi' } },
          },
        ],
        totalRestarts: 2,
        conditions: [{ type: 'Ready', status: 'True' }],
      },
      {
        id: 'default/nextcloud-db-0',
        name: 'nextcloud-db-0',
        namespace: 'default',
        nodeName: 'k3s-worker-02',
        status: 'running',
        phase: 'Running',
        podIP: '10.42.2.55',
        labels: { app: 'mariadb' },
        containers: [
          {
            name: 'mariadb',
            image: 'mariadb:10.11',
            ready: true,
            restartCount: 0,
            state: 'running',
            ports: [{ containerPort: 3306, name: 'mysql', protocol: 'TCP' }],
            resources: { requests: { cpu: '100m', memory: '180Mi' } },
          },
        ],
        totalRestarts: 0,
        conditions: [{ type: 'Ready', status: 'True' }],
      },
    ];

    for (const p of simPods) {
      this.pods.set(p.id, p);
    }

    // Update node pod counts
    for (const node of this.nodes.values()) {
      node.podCount = Array.from(this.pods.values()).filter((p) => p.nodeName === node.name).length;
    }

    // 3. Services with target pod endpoints
    const simServices: K8sService[] = [
      {
        id: 'kube-system/traefik',
        name: 'traefik',
        namespace: 'kube-system',
        type: 'LoadBalancer',
        clusterIP: '10.43.0.10',
        ports: [
          { name: 'web', port: 80, targetPort: 80, protocol: 'TCP' },
          { name: 'websecure', port: 443, targetPort: 443, protocol: 'TCP' },
        ],
        selector: { 'app.kubernetes.io/name': 'traefik' },
        targetPods: ['kube-system/traefik-56c84f67-8zlkq'],
      },
      {
        id: 'kube-system/kube-dns',
        name: 'kube-dns',
        namespace: 'kube-system',
        type: 'ClusterIP',
        clusterIP: '10.43.0.2',
        ports: [
          { name: 'dns', port: 53, targetPort: 53, protocol: 'UDP' },
          { name: 'dns-tcp', port: 53, targetPort: 53, protocol: 'TCP' },
        ],
        selector: { 'k8s-app': 'kube-dns' },
        targetPods: ['kube-system/coredns-6799fc886-v7qpt'],
      },
      {
        id: 'cluster-monitor/cluster-monitor-svc',
        name: 'cluster-monitor-svc',
        namespace: 'cluster-monitor',
        type: 'ClusterIP',
        clusterIP: '10.43.0.42',
        ports: [{ name: 'http', port: 80, targetPort: 3000, protocol: 'TCP' }],
        selector: { app: 'cluster-monitor' },
        targetPods: ['cluster-monitor/cluster-monitor-79c59ff7b-q9plx'],
      },
      {
        id: 'production/web-frontend-svc',
        name: 'web-frontend-svc',
        namespace: 'production',
        type: 'ClusterIP',
        clusterIP: '10.43.0.105',
        ports: [{ name: 'http', port: 80, targetPort: 80, protocol: 'TCP' }],
        selector: { app: 'web-frontend' },
        targetPods: ['production/web-frontend-67f78d-9j42k', 'production/web-frontend-67f78d-p4x11'],
      },
      {
        id: 'production/api-gateway-svc',
        name: 'api-gateway-svc',
        namespace: 'production',
        type: 'ClusterIP',
        clusterIP: '10.43.0.120',
        ports: [{ name: 'api', port: 8080, targetPort: 8080, protocol: 'TCP' }],
        selector: { app: 'api-gateway' },
        targetPods: ['production/api-gateway-55c4d6-h82la', 'production/api-gateway-55c4d6-m9zop'],
      },
      {
        id: 'production/auth-service-svc',
        name: 'auth-service-svc',
        namespace: 'production',
        type: 'ClusterIP',
        clusterIP: '10.43.0.135',
        ports: [{ name: 'auth', port: 4000, targetPort: 4000, protocol: 'TCP' }],
        selector: { app: 'auth-service' },
        targetPods: ['production/auth-service-789bc-v2x4r'],
      },
      {
        id: 'production/postgres-svc',
        name: 'postgres-svc',
        namespace: 'production',
        type: 'ClusterIP',
        clusterIP: '10.43.0.150',
        ports: [{ name: 'postgresql', port: 5432, targetPort: 5432, protocol: 'TCP' }],
        selector: { app: 'postgres-db' },
        targetPods: ['production/postgres-db-0'],
      },
      {
        id: 'production/redis-svc',
        name: 'redis-svc',
        namespace: 'production',
        type: 'ClusterIP',
        clusterIP: '10.43.0.160',
        ports: [{ name: 'redis', port: 6379, targetPort: 6379, protocol: 'TCP' }],
        selector: { app: 'redis-cache' },
        targetPods: ['production/redis-cache-7b649d-m3q1a'],
      },
      {
        id: 'default/nextcloud-svc',
        name: 'nextcloud-svc',
        namespace: 'default',
        type: 'ClusterIP',
        clusterIP: '10.43.0.210',
        ports: [{ name: 'http', port: 80, targetPort: 80, protocol: 'TCP' }],
        selector: { app: 'nextcloud' },
        targetPods: ['default/nextcloud-app-58cb9d-2zk5l'],
      },
      {
        id: 'default/mariadb-svc',
        name: 'mariadb-svc',
        namespace: 'default',
        type: 'ClusterIP',
        clusterIP: '10.43.0.220',
        ports: [{ name: 'mysql', port: 3306, targetPort: 3306, protocol: 'TCP' }],
        selector: { app: 'mariadb' },
        targetPods: ['default/nextcloud-db-0'],
      },
    ];

    for (const s of simServices) {
      this.services.set(s.id, s);
    }

    // Start subtle organic background fluctuations (like a living breathing cluster)
    this.startSimulationTicker();
  }

  private startSimulationTicker() {
    if (this.simulationInterval) clearInterval(this.simulationInterval);

    // Gently fluctuate node metrics every 8s
    this.simulationInterval = setInterval(() => {
      for (const node of this.nodes.values()) {
        const deltaCpu = (Math.random() - 0.5) * 6;
        const deltaMem = (Math.random() - 0.5) * 4;
        node.cpuUsagePercent = Math.min(95, Math.max(10, Math.round((node.cpuUsagePercent || 35) + deltaCpu)));
        node.memUsagePercent = Math.min(95, Math.max(20, Math.round((node.memUsagePercent || 50) + deltaMem)));
      }
      this.broadcast({ type: 'graph_update', data: this.getGraph() });
    }, 8000);
  }

  private startTrafficPulseEmitter() {
    if (this.pulseInterval) clearInterval(this.pulseInterval);

    // Emit live traffic packet animations along known links every 2.5 seconds
    this.pulseInterval = setInterval(() => {
      const activeEndpoints = [
        { linkId: 'traffic:traefik->web', source: 'kube-system/traefik-56c84f67-8zlkq', target: 'production/web-frontend-svc', port: 80 },
        { linkId: 'traffic:web->api', source: 'production/web-frontend-67f78d-9j42k', target: 'production/api-gateway-svc', port: 8080 },
        { linkId: 'traffic:api->db', source: 'production/api-gateway-55c4d6-h82la', target: 'production/postgres-svc', port: 5432 },
        { linkId: 'traffic:api->redis', source: 'production/api-gateway-55c4d6-m9zop', target: 'production/redis-svc', port: 6379 },
        { linkId: 'traffic:api->auth', source: 'production/api-gateway-55c4d6-h82la', target: 'production/auth-service-svc', port: 4000 },
      ];

      const sample = activeEndpoints[Math.floor(Math.random() * activeEndpoints.length)];
      this.broadcast({
        type: 'traffic_pulse',
        linkId: sample.linkId,
        source: sample.source,
        target: sample.target,
        port: sample.port,
      });
    }, 2400);
  }

  // --- Interactive simulation triggers for preview testing ---

  public simulateAction(action: 'restart_pod' | 'crash_pod' | 'add_pod' | 'delete_pod' | 'simulate_traffic') {
    if (action === 'restart_pod') {
      // Pick a random pod in production and trigger a rolling restart animation
      const podList = Array.from(this.pods.values()).filter((p) => p.namespace === 'production' && p.status === 'running');
      if (podList.length === 0) return;
      const target = podList[Math.floor(Math.random() * podList.length)];

      target.status = 'terminating';
      target.statusMessage = 'Pod terminating (rolling restart)';
      this.broadcast({ type: 'pod_event', event: 'MODIFIED', pod: target });
      this.broadcast({ type: 'graph_update', data: this.getGraph() });
      this.broadcast({ type: 'status_message', text: `Restarting pod ${target.name}...`, level: 'info' });

      setTimeout(() => {
        target.status = 'pending';
        target.statusMessage = 'ContainerCreating';
        target.totalRestarts += 1;
        if (target.containers[0]) target.containers[0].restartCount += 1;
        this.broadcast({ type: 'pod_event', event: 'MODIFIED', pod: target });
        this.broadcast({ type: 'graph_update', data: this.getGraph() });

        setTimeout(() => {
          target.status = 'running';
          target.statusMessage = 'Running (Ready)';
          this.broadcast({ type: 'pod_event', event: 'MODIFIED', pod: target });
          this.broadcast({ type: 'graph_update', data: this.getGraph() });
          this.broadcast({ type: 'status_message', text: `Pod ${target.name} back online and Ready`, level: 'info' });
        }, 3500);
      }, 2500);
    } else if (action === 'crash_pod') {
      const podList = Array.from(this.pods.values()).filter((p) => p.status === 'running');
      if (podList.length === 0) return;
      const target = podList[Math.floor(Math.random() * podList.length)];
      target.status = 'error';
      target.statusMessage = 'CrashLoopBackOff: exit code 137 (OOMKilled)';
      if (target.containers[0]) {
        target.containers[0].ready = false;
        target.containers[0].state = 'terminated';
        target.containers[0].stateReason = 'OOMKilled';
        target.containers[0].restartCount += 1;
      }
      target.totalRestarts += 1;
      this.broadcast({ type: 'pod_event', event: 'MODIFIED', pod: target });
      this.broadcast({ type: 'graph_update', data: this.getGraph() });
      this.broadcast({ type: 'status_message', text: `Simulated CrashLoopBackOff on ${target.name}`, level: 'error' });

      // Auto-recover after 10s
      setTimeout(() => {
        target.status = 'running';
        target.statusMessage = 'Running';
        if (target.containers[0]) {
          target.containers[0].ready = true;
          target.containers[0].state = 'running';
        }
        this.broadcast({ type: 'pod_event', event: 'MODIFIED', pod: target });
        this.broadcast({ type: 'graph_update', data: this.getGraph() });
        this.broadcast({ type: 'status_message', text: `Pod ${target.name} recovered to Running`, level: 'info' });
      }, 10000);
    } else if (action === 'add_pod') {
      const idSuffix = Math.random().toString(36).substring(2, 7);
      const workerNodes = ['k3s-worker-01', 'k3s-worker-02'];
      const nodeName = workerNodes[Math.floor(Math.random() * workerNodes.length)];
      const newPod: K8sPod = {
        id: `production/analytics-worker-${idSuffix}`,
        name: `analytics-worker-${idSuffix}`,
        namespace: 'production',
        nodeName,
        status: 'pending',
        phase: 'Pending',
        statusMessage: 'ContainerCreating',
        podIP: `10.42.1.${Math.floor(60 + Math.random() * 30)}`,
        labels: { app: 'analytics-worker' },
        containers: [
          {
            name: 'worker',
            image: 'python:3.11-slim',
            ready: false,
            restartCount: 0,
            state: 'waiting',
            stateReason: 'ContainerCreating',
            ports: [],
          },
        ],
        totalRestarts: 0,
        conditions: [{ type: 'PodScheduled', status: 'True' }],
      };

      this.pods.set(newPod.id, newPod);
      const targetNode = this.nodes.get(nodeName);
      if (targetNode) targetNode.podCount += 1;

      this.broadcast({ type: 'pod_event', event: 'ADDED', pod: newPod });
      this.broadcast({ type: 'graph_update', data: this.getGraph() });
      this.broadcast({ type: 'status_message', text: `Scaled up new pod ${newPod.name} on ${nodeName}`, level: 'info' });

      setTimeout(() => {
        newPod.status = 'running';
        newPod.phase = 'Running';
        newPod.statusMessage = 'Running';
        if (newPod.containers[0]) {
          newPod.containers[0].ready = true;
          newPod.containers[0].state = 'running';
        }
        this.broadcast({ type: 'pod_event', event: 'MODIFIED', pod: newPod });
        this.broadcast({ type: 'graph_update', data: this.getGraph() });
      }, 3500);
    } else if (action === 'delete_pod') {
      const addedPods = Array.from(this.pods.values()).filter((p) => p.name.startsWith('analytics-worker'));
      if (addedPods.length > 0) {
        const target = addedPods[0];
        target.status = 'terminating';
        this.broadcast({ type: 'pod_event', event: 'MODIFIED', pod: target });
        this.broadcast({ type: 'graph_update', data: this.getGraph() });

        setTimeout(() => {
          this.pods.delete(target.id);
          const n = this.nodes.get(target.nodeName);
          if (n) n.podCount = Math.max(0, n.podCount - 1);
          this.broadcast({ type: 'pod_event', event: 'DELETED', pod: target });
          this.broadcast({ type: 'graph_update', data: this.getGraph() });
          this.broadcast({ type: 'status_message', text: `Scaled down pod ${target.name}`, level: 'info' });
        }, 2000);
      }
    } else if (action === 'simulate_traffic') {
      // Multiple rapid pulses
      const pulses = [
        { linkId: 'traffic:traefik->web', source: 'traefik', target: 'web', port: 80 },
        { linkId: 'traffic:web->api', source: 'web', target: 'api', port: 8080 },
        { linkId: 'traffic:api->db', source: 'api', target: 'postgres', port: 5432 },
      ];
      pulses.forEach((p, idx) => {
        setTimeout(() => {
          this.broadcast({
            type: 'traffic_pulse',
            linkId: p.linkId,
            source: p.source,
            target: p.target,
            port: p.port,
          });
        }, idx * 400);
      });
    }
  }
}
