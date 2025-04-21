import { WebSocketServer } from "ws";

// Store connected clients
const clients = new Set();

// Create WebSocket server
export const wss = new WebSocketServer({ noServer: true });

// Handle new connections
wss.on("connection", (ws, req) => {
  console.log(`New WebSocket connection from: ${req.socket.remoteAddress}`);
  clients.add(ws);

  // Send a welcome message to confirm connection
  ws.send(
    JSON.stringify({
      type: "connection",
      message: "Connected successfully"
    }),
    (error) => {
      if (error) {
        console.error(`Error sending welcome message: ${error.message}`);
      }
    }
  );

  // Handle client disconnection
  ws.on("close", (code, reason) => {
    console.log(`WebSocket closed: code=${code}, reason=${reason}`);
    clients.delete(ws);
  });

  // Handle errors
  ws.on("error", (error) => {
    console.error(`WebSocket error: ${error.message}`);
  });
});

// Broadcast data to all connected clients
export const broadcast = (data) => {
  console.log(`Broadcasting to ${clients.size} clients:`, data);
  const message = JSON.stringify(data);
  clients.forEach((client) => {
    if (client.readyState === 1) {
      // WebSocket.OPEN
      client.send(message, (error) => {
        if (error) {
          console.error("Error broadcasting to client:", error);
        }
      });
    }
  });
};
