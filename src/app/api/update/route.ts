/**
 * Proxy route for the standalone updater service.
 *
 * Reads the `.updater-port` file to discover the updater's port, then forwards
 * requests to the local updater HTTP server on 127.0.0.1.
 *
 * Responsibilities:
 * - GET: proxy to updater /status endpoint, return JSON with remote status info
 * - POST: proxy to updater /update endpoint, stream NDJSON progress back to client
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Ensure this route is never statically cached -- every request must reach the
// updater service so we get a fresh git-fetch comparison.
export const dynamic = "force-dynamic";

// ============================================================================
// CONSTANTS
// ============================================================================

const PORT_FILE = path.resolve(process.cwd(), ".updater-port");

// ============================================================================
// ENDPOINTS
// ============================================================================

/**
 * Check update status by proxying to the updater service.
 * @returns JSON with remote status info, or 503 if updater is unreachable
 */
export async function GET(): Promise<NextResponse> {
  const port = readPortFile();
  if (!port) {
    return NextResponse.json(
      { error: "Updater service not running" },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`);
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json(
      { error: "Updater service unreachable" },
      { status: 503 },
    );
  }
}

/**
 * Trigger an update by proxying to the updater service.
 * Streams NDJSON progress lines back to the client.
 * @returns Streaming NDJSON response, or 503 if updater is unreachable
 */
export async function POST(): Promise<NextResponse> {
  const port = readPortFile();
  if (!port) {
    return NextResponse.json(
      { error: "Updater service not running" },
      { status: 503 },
    );
  }

  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/update`, {
      method: "POST",
    });
  } catch {
    return NextResponse.json(
      { error: "Updater service unreachable" },
      { status: 503 },
    );
  }

  // If the updater returned an error status (e.g. 409 Conflict), forward it
  if (!response.ok || !response.body) {
    const data = await response.text();
    return new NextResponse(data, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
    });
  }

  // Stream the NDJSON response back to the client
  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Read the updater port from the .updater-port file.
 * @returns The port string, or null if the file does not exist
 */
function readPortFile(): string | null {
  try {
    return fs.readFileSync(PORT_FILE, "utf-8").trim();
  } catch {
    return null;
  }
}
