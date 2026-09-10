import React, { useState } from 'react';
import { X, Copy, Check, FileCode, Terminal, Download } from 'lucide-react';

interface ManifestModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ManifestModal: React.FC<ManifestModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'manifest' | 'dockerfile' | 'deploy'>('manifest');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const manifestYAML = `# ==============================================================================
# KubeMind - Live Kubernetes Cluster Mind-Map Monitor
# Kubernetes Deployment Manifests for k3s with Traefik & Flannel
# ==============================================================================

apiVersion: v1
kind: Namespace
metadata:
  name: cluster-monitor

---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: cluster-monitor-sa
  namespace: cluster-monitor

---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: cluster-monitor-role
rules:
  - apiGroups: [""]
    resources: ["nodes", "pods", "services", "endpoints", "namespaces"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["metrics.k8s.io"]
    resources: ["nodes", "pods"]
    verbs: ["get", "list"]

---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: cluster-monitor-rolebinding
subjects:
  - kind: ServiceAccount
    name: cluster-monitor-sa
    namespace: cluster-monitor
roleRef:
  kind: ClusterRole
  name: cluster-monitor-role
  apiGroup: rbac.authorization.k8s.io

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cluster-monitor
  namespace: cluster-monitor
  labels:
    app: cluster-monitor
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cluster-monitor
  template:
    metadata:
      labels:
        app: cluster-monitor
    spec:
      serviceAccountName: cluster-monitor-sa
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
      containers:
        - name: cluster-monitor
          image: cluster-monitor:latest
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 3000
          resources:
            requests:
              cpu: 50m
              memory: 100Mi
            limits:
              cpu: 200m
              memory: 300Mi
          livenessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10

---
apiVersion: v1
kind: Service
metadata:
  name: cluster-monitor-svc
  namespace: cluster-monitor
spec:
  type: ClusterIP
  ports:
    - name: http
      port: 80
      targetPort: 3000
  selector:
    app: cluster-monitor

---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: cluster-monitor-ingress
  namespace: cluster-monitor
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web
spec:
  ingressClassName: traefik
  rules:
    # No fixed host: responds on Tailscale IP (100.82.72.81) or any internal hostname
    - http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: cluster-monitor-svc
                port:
                  number: 80`;

  const dockerfileContent = `# Multi-stage Dockerfile for KubeMind (~110MB)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist

USER node
EXPOSE 3000
CMD ["node", "dist/server.cjs"]`;

  const deployInstructions = `# Step 1: Build the Docker image
docker build -t cluster-monitor:latest .

# Step 2: Import into k3s (if running directly on node)
docker save cluster-monitor:latest | sudo k3s ctr images import -

# Step 3: Apply the manifests to k3s
kubectl apply -f deploy/manifests.yaml

# Step 4: Verify pods & Traefik ingress
kubectl get pods -n cluster-monitor
kubectl get ingress -n cluster-monitor

# Step 5: Access on your Tailscale IP
# Open http://100.82.72.81/ or port-forward:
# kubectl port-forward -n cluster-monitor svc/cluster-monitor-svc 8080:80`;

  const currentContent =
    activeTab === 'manifest'
      ? manifestYAML
      : activeTab === 'dockerfile'
      ? dockerfileContent
      : deployInstructions;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-2xl w-full h-[80vh] flex flex-col overflow-hidden text-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-2">
            <FileCode className="w-4 h-4 text-cyan-400" />
            <h3 className="font-bold text-white text-sm">Deployment Files & Instructions</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between px-4 py-2 bg-slate-950/60 border-b border-slate-800 text-xs">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('manifest')}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                activeTab === 'manifest'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              deploy/manifests.yaml
            </button>
            <button
              onClick={() => setActiveTab('dockerfile')}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                activeTab === 'dockerfile'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Dockerfile
            </button>
            <button
              onClick={() => setActiveTab('deploy')}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                activeTab === 'deploy'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Quick Deploy Commands
            </button>
          </div>

          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors font-medium text-xs"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>

        {/* Code Viewer */}
        <div className="flex-1 p-4 bg-slate-950 font-mono text-xs overflow-y-auto text-slate-300 select-text leading-relaxed">
          <pre>{currentContent}</pre>
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            Tested on k3s v1.28+, Traefik ingress, Flannel CNI
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
