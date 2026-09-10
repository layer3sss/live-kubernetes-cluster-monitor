import {
  ClusterGraph,
  ClusterStats,
  GraphLink,
  GraphNode,
  K8sContainer,
  K8sNode,
  K8sPod,
  K8sService,
  K8sStatus,
} from '../src/types.js';

/**
 * Builds the visual Mind-Map / Topology graph from K8s resources:
 * - Nodes as top-level containers
 * - Pods placed under their respective nodes
 * - Containers inside pods
 * - Service & Endpoints connections with port information
 */
export function buildClusterGraph(
  nodes: K8sNode[],
  pods: K8sPod[],
  services: K8sService[],
  meta: { isLiveCluster: boolean; clusterName?: string }
): ClusterGraph {
  const graphNodes: GraphNode[] = [];
  const graphLinks: GraphLink[] = [];

  const namespacesSet = new Set<string>();

  // 1. Add K8s Nodes
  const nodeMap = new Map<string, K8sNode>();
  for (const node of nodes) {
    nodeMap.set(node.name, node);
    graphNodes.push({
      id: `node:${node.name}`,
      type: 'node',
      name: node.name,
      status: node.status,
      data: node,
      radius: 64,
    });
  }

  // 2. Add Pods and nesting links to their host node
  const podMap = new Map<string, K8sPod>();
  for (const pod of pods) {
    podMap.set(pod.id, pod);
    namespacesSet.add(pod.namespace);

    const podNodeId = `pod:${pod.id}`;
    graphNodes.push({
      id: podNodeId,
      type: 'pod',
      name: pod.name,
      namespace: pod.namespace,
      parentNodeId: pod.nodeName ? `node:${pod.nodeName}` : undefined,
      status: pod.status,
      data: pod,
      radius: 28,
    });

    // Nesting link: Pod belongs to Node
    if (pod.nodeName && nodeMap.has(pod.nodeName)) {
      graphLinks.push({
        id: `nesting:${pod.nodeName}->${pod.id}`,
        source: `node:${pod.nodeName}`,
        target: podNodeId,
        type: 'nesting',
      });
    }

    // 3. Add Container child nodes (optional drill-down nodes)
    for (const container of pod.containers) {
      const containerNodeId = `container:${pod.id}:${container.name}`;
      const containerStatus: K8sStatus = container.ready
        ? 'running'
        : container.state === 'waiting'
        ? 'pending'
        : container.state === 'terminated'
        ? 'error'
        : 'unknown';

      graphNodes.push({
        id: containerNodeId,
        type: 'container',
        name: container.name,
        namespace: pod.namespace,
        parentNodeId: podNodeId,
        status: containerStatus,
        data: container,
        radius: 14,
      });

      // Nesting link: Container inside Pod
      graphLinks.push({
        id: `nesting:${pod.id}->${container.name}`,
        source: podNodeId,
        target: containerNodeId,
        type: 'nesting',
      });
    }
  }

  // 4. Derive Service -> Endpoints -> Pod-to-Pod edges with port info
  // Build a lookup of which pods back each service
  const serviceMap = new Map<string, K8sService>();
  for (const svc of services) {
    serviceMap.set(`${svc.namespace}/${svc.name}`, svc);
    namespacesSet.add(svc.namespace);

    // Optional: Service hub node for clear visual clarity when services span pods
    const svcNodeId = `service:${svc.namespace}/${svc.name}`;
    graphNodes.push({
      id: svcNodeId,
      type: 'service',
      name: svc.name,
      namespace: svc.namespace,
      status: 'running',
      data: svc,
      radius: 22,
    });

    // Link Service to target Pods backed by this service (derived from endpoints)
    for (const targetPodId of svc.targetPods) {
      if (podMap.has(targetPodId)) {
        const primaryPort = svc.ports[0]?.port || svc.ports[0]?.targetPort || 80;
        graphLinks.push({
          id: `svc-target:${svc.id}->${targetPodId}`,
          source: svcNodeId,
          target: `pod:${targetPodId}`,
          type: 'service-traffic',
          port: primaryPort,
          protocol: svc.ports[0]?.protocol || 'TCP',
          serviceName: svc.name,
          trafficActive: true,
        });
      }
    }
  }

  // Derive Pod-to-Service consumer links based on inter-service dependencies
  // In a cluster, frontends consume APIs, APIs consume DBs/caches, or Traefik routes to frontends
  for (const pod of pods) {
    // Detect Traefik ingress controller routing to services
    if (pod.name.includes('traefik') || pod.labels['app.kubernetes.io/name'] === 'traefik') {
      for (const svc of services) {
        if (svc.type === 'ClusterIP' && svc.namespace !== 'kube-system') {
          graphLinks.push({
            id: `traffic:ingress->${svc.id}`,
            source: `pod:${pod.id}`,
            target: `service:${svc.namespace}/${svc.name}`,
            type: 'pod-to-pod',
            port: svc.ports[0]?.port || 80,
            protocol: 'HTTP',
            serviceName: svc.name,
            trafficActive: true,
          });
        }
      }
    }

    // Pod dependencies (e.g., web-frontend -> api-gateway, api-gateway -> postgres / auth / redis, nextcloud -> db)
    for (const svc of services) {
      if (svc.namespace === pod.namespace) {
        const podNameLower = pod.name.toLowerCase();
        const svcNameLower = svc.name.toLowerCase();

        const isConsumer =
          (podNameLower.includes('frontend') && (svcNameLower.includes('api') || svcNameLower.includes('backend'))) ||
          (podNameLower.includes('api') && (svcNameLower.includes('db') || svcNameLower.includes('postgres') || svcNameLower.includes('redis') || svcNameLower.includes('auth'))) ||
          (podNameLower.includes('nextcloud') && svcNameLower.includes('db')) ||
          (podNameLower.includes('monitor') && svcNameLower.includes('coredns'));

        if (isConsumer && !svc.targetPods.includes(pod.id)) {
          graphLinks.push({
            id: `consumer:${pod.id}->${svc.id}`,
            source: `pod:${pod.id}`,
            target: `service:${svc.namespace}/${svc.name}`,
            type: 'pod-to-pod',
            port: svc.ports[0]?.port || 80,
            protocol: svc.ports[0]?.protocol || 'TCP',
            serviceName: svc.name,
            trafficActive: true,
          });
        }
      }
    }
  }

  // Calculate cluster stats
  const readyNodes = nodes.filter((n) => n.status === 'ready').length;
  const runningPods = pods.filter((p) => p.status === 'running').length;
  const pendingPods = pods.filter((p) => p.status === 'pending').length;
  const errorPods = pods.filter((p) => p.status === 'error').length;

  const clusterStats: ClusterStats = {
    totalNodes: nodes.length,
    readyNodes,
    totalPods: pods.length,
    runningPods,
    pendingPods,
    errorPods,
    totalNamespaces: namespacesSet.size,
    cpuTotalCores: nodes.length * 4,
    cpuUsedPercent: Math.round(35 + Math.random() * 10),
    memTotalGiB: nodes.length * 8,
    memUsedPercent: Math.round(48 + Math.random() * 8),
    isLiveCluster: meta.isLiveCluster,
    clusterName: meta.clusterName || (meta.isLiveCluster ? 'k3s-in-cluster' : 'k3s-demo-cluster'),
    cni: 'Flannel (Host-GW / VXLAN)',
    ingressController: 'Traefik v2.10',
  };

  return {
    nodes: graphNodes,
    links: graphLinks,
    clusterStats,
    namespaces: Array.from(namespacesSet).sort(),
    timestamp: Date.now(),
  };
}
