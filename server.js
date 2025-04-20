import express from "express";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import cors from "cors";
import { WebSocketServer } from "ws";
import {
  testLogodev,
  testUnsplash,
  testWikipedia,
  testText,
  testSpotify,
  spotify
} from "./routes/index.js";

// Import routes
import pairsRouter from "./routes/pairs.js";
import votesRouter from "./routes/votes.js";
import metadataRouter from "./routes/metadata.js";
import authRouter, { apiKeyAuth } from "./routes/auth.js";

const app = express();
const apiPort = 3108;
const socketPort = 3908;

// Configure CORS
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE"]
  })
);

app.use(express.json());
app.use(apiKeyAuth); // Apply API key auth to all routes

// Use test routes
app.use(testLogodev);
app.use(testUnsplash);
app.use(testWikipedia);
app.use(testText);
app.use(testSpotify);
app.use(spotify);

// Use main routes
app.use("/pairs", pairsRouter);
app.use("/votes", votesRouter);
app.use("/metadata", metadataRouter);
app.use("/auth", authRouter);

// Store connected clients
const clients = new Set();

// Create WebSocket server
const wss = new WebSocketServer({ port: socketPort });

wss.on("connection", (ws, req) => {
  console.log(`New WebSocket connection from: ${req.socket.remoteAddress}`);

  // Handle protocol upgrade
  if (req.headers["sec-websocket-protocol"]) {
    ws.protocol = req.headers["sec-websocket-protocol"];
  }

  clients.add(ws);

  // Set a timeout for the connection
  const timeout = setTimeout(() => {
    console.log("Connection timeout, closing...");
    ws.terminate();
  }, 30000);

  ws.on("pong", () => {
    clearTimeout(timeout);
  });

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

  ws.on("error", (error) => {
    console.error(`WebSocket error: ${error.message}`);
  });

  ws.on("close", (code, reason) => {
    console.log(`WebSocket closed: code=${code}, reason=${reason}`);
    clients.delete(ws);
  });
});

wss.on("error", (error) => {
  console.error(`WebSocket server error: ${error.message}`);
});

wss.on("listening", () => {
  console.log(`WebSocket server listening on ws://0.0.0.0:${socketPort}`);
});

// Helper function to broadcast to all clients
const broadcast = (data) => {
  clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(JSON.stringify(data), (error) => {
        if (error) {
          console.error("Error broadcasting to client:", error);
        }
      });
    }
  });
};

// Start the Express server
app.listen(apiPort, () => {
  console.log(`API server listening on port ${apiPort}`);
});

export { broadcast };
