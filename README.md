# KubeMind - Live Kubernetes Cluster Mind-Map Monitor

A lightweight, self-hosted web application that renders a **live, animated mind-map / node graph** of a Kubernetes cluster, understandable at a glance by both technical operators and non-technical viewers.

Designed specifically for **k3s clusters** with **Flannel CNI** and **Traefik Ingress**, accessible over Tailscale or internal LAN.

---

## Features

- **Living Organism Graph**: Physical/VM nodes form organic outer boundaries; pods breathe inside their host nodes; containers nest inside pods.
- **Flannel-Friendly Traffic Derivation**: Infers service-to-pod and pod-to-pod network dependencies from Kubernetes `Service` → `Endpoints` / `EndpointSlices` and container port definitions — no eBPF or Cilium/Hubble required!
- **Real-Time Watch API & WebSockets**: Listens to Kubernetes Watch streams for instant visual response to pod creation, restarts, terminations, and crash loops.
- **Port Visibility**: Edges between pods and services highlight port numbers (e.g., `:80`, `:8080`, `:5432`, `:6379`) with animated traffic pulse particles.
- **Detail Inspector**: Click any node, pod, container, or service to inspect resource requests/limits, status conditions, images, IP addresses, labels, and restart counts.
- **Zero In-Cluster Mutation**: Purely read-only RBAC; cannot delete, scale, or modify your cluster.
- **Low Footprint**: Consumes under ~50m CPU and ~100Mi memory.

---

## Quick Start (Deploy to k3s)

### 1. Build & Push the Docker Image

You can build the multi-stage Docker image and push it to your local registry or import directly into k3s:

```bash
# Clone or navigate to the repo
cd kubemind

# Build the slim production container image
docker build -t cluster-monitor:latest .

# If using k3s on a single node or local machine:
docker save cluster-monitor:latest | sudo k3s ctr images import -

# OR tag and push to your private registry / GHCR:
# docker tag cluster-monitor:latest your-registry/cluster-monitor:latest
# docker push your-registry/cluster-monitor:latest
```

### 2. Apply Kubernetes Manifests

Apply the single-file manifest containing the Namespace, ServiceAccount, read-only ClusterRole, Deployment, Service, and Traefik Ingress:

```bash
kubectl apply -f deploy/manifests.yaml
```

### 3. Verify Deployment

```bash
# Check the deployment and pod status
kubectl get pods -n cluster-monitor

# Check the Traefik ingress
kubectl get ingress -n cluster-monitor
```

### 4. Access the Dashboard

The Ingress is configured with `ingressClassName: traefik` and **no fixed host**, meaning you can open:
- Direct Tailscale IP: `http://100.82.72.81/`
- Node IP: `http://<your-node-ip>/`
- Or via `kubectl port-forward`:
  ```bash
  kubectl port-forward -n cluster-monitor svc/cluster-monitor-svc 8080:80
  # Then open http://localhost:8080
  ```

---

## Architecture

```
                      Kubernetes Watch API
                                │
              (nodes, pods, services, endpoints)
                                ▼
                   ┌─────────────────────────┐
                   │  Node.js / Express      │
                   │  KubernetesWatcher      │
                   │  (In-Cluster Config)    │
                   └────────────┬────────────┘
                                │
                        WebSocket (/ws)
                                │
                                ▼
                   ┌─────────────────────────┐
                   │  React + D3 Mind-Map    │
                   │  Interactive Force Canvas│
                   │  Traffic Flow Pulses    │
                   └─────────────────────────┘
```

---

## Local Development

```bash
# Install dependencies
npm install

# Start development server with live reload & WebSocket (binds to port 3000)
npm run dev

# Build production bundle
npm run build
```
