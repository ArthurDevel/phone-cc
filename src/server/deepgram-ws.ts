/**
 * Standalone WebSocket proxy server for Deepgram speech-to-text.
 *
 * Responsibilities:
 * - Runs on port 3001 alongside the Next.js dev server
 * - Accepts WebSocket connections from the client at /deepgram
 * - Opens a WebSocket to Deepgram's live transcription API
 * - Relays audio chunks (client -> Deepgram) and transcription events (Deepgram -> client)
 * - Keeps DEEPGRAM_API_KEY server-side
 *
 * Start with: tsx src/server/deepgram-ws.ts
 */

import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "dotenv";
import path from "path";

// Load .env.local from project root
config({ path: path.resolve(process.cwd(), ".env.local") });

// ============================================================================
// CONSTANTS
// ============================================================================

const PORT = Number(process.env.DEEPGRAM_WS_PORT) || 3001;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const DEEPGRAM_URL =
  "wss://api.deepgram.com/v1/listen?" +
  "model=nova-2&language=en&endpointing=1500&interim_results=true&punctuate=true";

// ============================================================================
// MAIN ENTRYPOINT
// ============================================================================

if (!DEEPGRAM_API_KEY) {
  console.error("[deepgram-ws] DEEPGRAM_API_KEY not set in .env.local");
  process.exit(1);
}

const httpServer = createServer((_req, res) => {
  // Health check endpoint
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

const wss = new WebSocketServer({ server: httpServer, path: "/deepgram" });

wss.on("connection", (clientWs) => {
  console.log("[deepgram-ws] Client connected");
  handleClientConnection(clientWs);
});

httpServer.listen(PORT, () => {
  console.log(`[deepgram-ws] WebSocket server listening on port ${PORT}`);
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Handles a single client WebSocket connection.
 * Opens a Deepgram WebSocket and relays data between client and Deepgram.
 * @param clientWs - The client's WebSocket connection
 */
function handleClientConnection(clientWs: WebSocket) {
  // Open connection to Deepgram
  const dgWs = new WebSocket(DEEPGRAM_URL, {
    headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
  });

  let dgReady = false;

  dgWs.on("open", () => {
    dgReady = true;
    console.log("[deepgram-ws] Connected to Deepgram");
  });

  // Relay Deepgram transcription events to the client
  dgWs.on("message", (data) => {
    if (clientWs.readyState !== WebSocket.OPEN) return;

    try {
      const response = JSON.parse(data.toString());

      // Extract transcript from Deepgram response
      const alternative = response.channel?.alternatives?.[0];
      if (!alternative) return;

      const message = JSON.stringify({
        type: "transcript",
        text: alternative.transcript || "",
        is_final: response.is_final || false,
        speech_final: response.speech_final || false,
      });

      clientWs.send(message);
    } catch {
      // Ignore malformed Deepgram messages
    }
  });

  dgWs.on("error", (err) => {
    console.error("[deepgram-ws] Deepgram error:", err.message);
    sendError(clientWs, "Deepgram connection failed");
    clientWs.close();
  });

  dgWs.on("close", () => {
    console.log("[deepgram-ws] Deepgram connection closed");
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close();
    }
  });

  // Relay client audio chunks to Deepgram
  clientWs.on("message", (data) => {
    if (dgReady && dgWs.readyState === WebSocket.OPEN) {
      dgWs.send(data);
    }
  });

  // Clean up when client disconnects
  clientWs.on("close", () => {
    console.log("[deepgram-ws] Client disconnected");
    if (dgWs.readyState === WebSocket.OPEN) {
      // Send close signal to Deepgram
      dgWs.send(JSON.stringify({ type: "CloseStream" }));
      dgWs.close();
    }
  });

  clientWs.on("error", (err) => {
    console.error("[deepgram-ws] Client error:", err.message);
    if (dgWs.readyState === WebSocket.OPEN) {
      dgWs.close();
    }
  });
}

/**
 * Sends an error message to the client WebSocket.
 * @param ws - The client WebSocket
 * @param message - Error description
 */
function sendError(ws: WebSocket, message: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "error", message }));
  }
}
