import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { KubernetesWatcher } from './server/k8s-watcher.js';
import { WSClientMessage, WSServerMessage } from './src/types.js';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const server = http.createServer(app);

  app.use(express.json());

  // Initialize Kubernetes watcher
  const k8sWatcher = new KubernetesWatcher();

  // Setup WebSocket Server mounted on HTTP server
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Broadcast helper to all open clients
  const broadcastToClients = (msg: WSServerMessage) => {
    const data = JSON.stringify(msg);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  };

  // Wire up k8sWatcher update notifications to WebSockets
  k8sWatcher.onUpdate((msg) => {
    broadcastToClients(msg);
  });

  // Client connection handler
  wss.on('connection', (ws: WebSocket) => {
    // Send immediate snapshot on connect
    const initialGraph = k8sWatcher.getGraph();
    const initMsg: WSServerMessage = {
      type: 'init',
      data: initialGraph,
    };
    ws.send(JSON.stringify(initMsg));

    ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as WSClientMessage;
        if (parsed.type === 'get_state') {
          ws.send(
            JSON.stringify({
              type: 'graph_update',
              data: k8sWatcher.getGraph(),
            } as WSServerMessage)
          );
        } else if (parsed.type === 'simulate_event') {
          k8sWatcher.simulateAction(parsed.action);
        }
      } catch (err) {
        console.error('[WS] Failed to parse client message:', err);
      }
    });
  });

  // --- API Endpoints ---
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  app.get('/api/cluster/graph', (req, res) => {
    res.json(k8sWatcher.getGraph());
  });

  app.post('/api/cluster/simulate', (req, res) => {
    const { action } = req.body;
    if (action) {
      k8sWatcher.simulateAction(action);
      res.json({ success: true, action });
    } else {
      res.status(400).json({ error: 'Action parameter required' });
    }
  });

  // Start Kubernetes watcher
  await k8sWatcher.start();

  // Vite middleware for development vs static dist for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[KubeMind] Server running on http://0.0.0.0:${PORT}`);
    console.log(`[KubeMind] WebSocket endpoint active at ws://0.0.0.0:${PORT}/ws`);
  });
}

startServer().catch((err) => {
  console.error('[KubeMind] Fatal startup error:', err);
  process.exit(1);
});
