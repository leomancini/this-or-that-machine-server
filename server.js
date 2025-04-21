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
import { wss, broadcast } from "./utils/broadcast.js";

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

// Create HTTP server
const server = app.listen(apiPort, () => {
  console.log(`API server listening on port ${apiPort}`);
});

// Create a separate WebSocket server that listens on socketPort
const socketServer = new WebSocketServer({ port: socketPort });

socketServer.on("listening", () => {
  console.log(`WebSocket server listening on ws://0.0.0.0:${socketPort}`);
});

// Forward connections from the standalone WebSocket server to our wss instance
socketServer.on("connection", (ws, req) => {
  console.log(`New WebSocket connection from: ${req.socket.remoteAddress}`);

  // Add the client to our clients set
  wss.clients.add(ws);

  // Send a welcome message
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
    wss.clients.delete(ws);
  });

  // Handle errors
  ws.on("error", (error) => {
    console.error(`WebSocket error: ${error.message}`);
  });
});

// Export the broadcast function for use in other modules
export { broadcast };
