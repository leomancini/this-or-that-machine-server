import { WebSocketServer } from "ws";

// Store connected clients
const clients = new Set();

// Create WebSocket server
export const wss = new WebSocketServer({ noServer: true });

// Handle new connections
wss.on("connection", (ws) => {
  clients.add(ws);

  // Handle client disconnection
  ws.on("close", () => {
    clients.delete(ws);
  });
});

// Broadcast data to all connected clients
export const broadcast = (data) => {
  const message = JSON.stringify(data);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};
