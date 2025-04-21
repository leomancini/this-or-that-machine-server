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

// Attach WebSocket server to HTTP server
server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

// Export the broadcast function for use in other modules
export { broadcast };
