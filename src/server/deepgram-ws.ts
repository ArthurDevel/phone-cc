/**
 * Standalone WebSocket proxy server for Deepgram Flux speech-to-text.
 *
 * - Finds a free port automatically (starting from DEEPGRAM_WS_PORT or 3001)
 * - Writes the chosen port to .deepgram-ws-port so the Next.js app can discover it
 * - Accepts WebSocket connections from the client at /deepgram
 * - Opens a WebSocket to Deepgram's v2 Flux API (turn-based transcription)
 * - Relays audio chunks (client -> Deepgram) and TurnInfo events (Deepgram -> client)
 * - Keeps DEEPGRAM_API_KEY server-side
 *
 * Start with: tsx src/server/deepgram-ws.ts
 */

import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "dotenv";
import path from "path";
import fs from "fs";

// Load .env.local from project root
config({ path: path.resolve(process.cwd(), ".env.local") });

const START_PORT = Number(process.env.DEEPGRAM_WS_PORT) || 3001;
const PORT_FILE = path.resolve(process.cwd(), ".deepgram-ws-port");
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
// Flux v2 endpoint. Client sends raw linear16 PCM at 16kHz via AudioWorklet.
const DEEPGRAM_URL =
  "wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000";

if (!DEEPGRAM_API_KEY) {
  console.error("[deepgram-ws] DEEPGRAM_API_KEY not set in .env.local");
  process.exit(1);
}

/** Try to listen on `port`. Resolves with the server if successful, rejects on EADDRINUSE. */
function tryListen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") reject(err);
      else throw err;
    });
    server.listen(port, "127.0.0.1", () => resolve(port));
  });
}

async function main() {
  const httpServer = createServer((_req, res) => {
    // Health check + port discovery
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify({ ok: true }));
  });

  // Find a free port BEFORE attaching the WebSocketServer
  let port = START_PORT;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await tryListen(httpServer, port);
      break;
    } catch {
      console.log(`[deepgram-ws] Port ${port} in use, trying ${port + 1}`);
      port++;
    }
  }

  // Attach WSS only after httpServer is listening
  const wss = new WebSocketServer({ server: httpServer, path: "/deepgram" });

  wss.on("connection", (clientWs) => {
    console.log("[deepgram-ws] Client connected");
    handleClientConnection(clientWs);
  });

  // Write the port so the Next.js API route can read it
  fs.writeFileSync(PORT_FILE, String(port));
  console.log(`[deepgram-ws] WebSocket server listening on 127.0.0.1:${port}`);

  // Clean up port file on exit
  for (const sig of ["SIGINT", "SIGTERM", "exit"] as const) {
    process.on(sig, () => {
      try { fs.unlinkSync(PORT_FILE); } catch {}
    });
  }
}

main();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function handleClientConnection(clientWs: WebSocket) {
  const dgWs = new WebSocket(DEEPGRAM_URL, {
    headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
  });

  let dgReady = false;

  dgWs.on("open", () => {
    dgReady = true;
    console.log("[deepgram-ws] Connected to Deepgram");
  });

  dgWs.on("message", (data) => {
    const raw = data.toString();
    const response = JSON.parse(raw);
    console.log("[deepgram-ws] DG message:", response.type, response.event || "", response.code || "");

    if (clientWs.readyState !== WebSocket.OPEN) return;

    if (response.type === "TurnInfo") {
      const isFinal = response.event === "EndOfTurn";
      clientWs.send(JSON.stringify({
        type: "transcript",
        text: response.transcript || "",
        is_final: isFinal,
        speech_final: isFinal,
      }));
    } else if (response.type === "Error") {
      console.error("[deepgram-ws] Deepgram error:", response.description, response.code);
      sendError(clientWs, response.description || "Deepgram error");
    }
  });

  dgWs.on("error", (err) => {
    console.error("[deepgram-ws] Deepgram error:", err.message);
    sendError(clientWs, "Deepgram connection failed");
    clientWs.close();
  });

  dgWs.on("close", () => {
    console.log("[deepgram-ws] Deepgram connection closed");
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  });

  clientWs.on("message", (data) => {
    if (dgReady && dgWs.readyState === WebSocket.OPEN) dgWs.send(data);
  });

  clientWs.on("close", () => {
    console.log("[deepgram-ws] Client disconnected");
    if (dgWs.readyState === WebSocket.OPEN) {
      dgWs.close();
    }
  });

  clientWs.on("error", (err) => {
    console.error("[deepgram-ws] Client error:", err.message);
    if (dgWs.readyState === WebSocket.OPEN) dgWs.close();
  });
}

function sendError(ws: WebSocket, message: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "error", message }));
  }
}
