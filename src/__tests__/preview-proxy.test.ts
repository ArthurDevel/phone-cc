/**
 * Integration tests for the preview proxy route handler.
 *
 * Covers:
 * - 404 for invalid/unknown tokens
 * - Forwarding GET requests to a real localhost HTTP server
 * - Forwarding POST requests with body
 * - SSRF prevention (port 3000, ports < 1024)
 * - Hop-by-hop header stripping
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import { proxyRequest } from "@/app/preview/[token]/[[...path]]/route";
import {
  rewriteAgentOutput,
  lookupToken,
  cleanupSession,
} from "@/lib/preview-manager";

// ============================================================================
// TEST SERVER SETUP
// ============================================================================

let server: http.Server;
let serverPort: number;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    // Echo back request info as JSON
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.url === "/echo" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ echoed: body }));
      });
      return;
    }

    if (req.url === "/hop-headers") {
      res.writeHead(200, {
        "Content-Type": "text/plain",
        "Transfer-Encoding": "chunked",
        Connection: "keep-alive",
        "Keep-Alive": "timeout=5",
        Upgrade: "websocket",
        "X-Custom": "preserved",
      });
      res.end("hop test");
      return;
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`path: ${req.url}, method: ${req.method}`);
  });

  // Listen on a random available port
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        serverPort = addr.port;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

beforeEach(() => {
  cleanupSession("proxy-test");
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Creates a token for the test server port and returns the token string.
 *
 * @returns The UUID token string
 */
function createTestToken(): string {
  const output = rewriteAgentOutput(
    "proxy-test",
    `http://localhost:${serverPort}`
  );
  const match = output.match(/\/preview\/([a-f0-9-]{36})/);
  if (!match) throw new Error("Failed to extract token from rewritten URL");
  return match[1];
}

// ============================================================================
// TESTS: INVALID TOKENS
// ============================================================================

describe("invalid tokens", () => {
  it("returns 404 for an unknown token", async () => {
    const request = new Request("http://localhost:3000/preview/badtoken123");
    const response = await proxyRequest(request, "badtoken123", undefined);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Not found");
  });

  it("returns 404 for a valid UUID format but non-existent token", async () => {
    const request = new Request("http://localhost:3000/preview/00000000-0000-0000-0000-000000000000");
    const response = await proxyRequest(
      request,
      "00000000-0000-0000-0000-000000000000",
      undefined
    );

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// TESTS: GET PROXYING
// ============================================================================

describe("GET proxying", () => {
  it("forwards GET requests and returns the response body and status", async () => {
    const token = createTestToken();
    const request = new Request("http://localhost:3000/preview/" + token + "/health");
    const response = await proxyRequest(request, token, ["health"]);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
  });

  it("forwards requests with no sub-path", async () => {
    const token = createTestToken();
    const request = new Request("http://localhost:3000/preview/" + token);
    const response = await proxyRequest(request, token, undefined);

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("path: /");
    expect(body).toContain("method: GET");
  });

  it("forwards multi-segment paths", async () => {
    const token = createTestToken();
    const request = new Request("http://localhost:3000/preview/" + token + "/api/v1/users");
    const response = await proxyRequest(request, token, ["api", "v1", "users"]);

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe("path: /api/v1/users, method: GET");
  });
});

// ============================================================================
// TESTS: POST PROXYING
// ============================================================================

describe("POST proxying", () => {
  it("forwards POST requests with body", async () => {
    const token = createTestToken();
    const request = new Request("http://localhost:3000/preview/" + token + "/echo", {
      method: "POST",
      body: "hello world",
    });
    const response = await proxyRequest(request, token, ["echo"]);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.echoed).toBe("hello world");
  });
});

// ============================================================================
// TESTS: SSRF PREVENTION
// ============================================================================

describe("SSRF prevention", () => {
  it("rejects port 3000", async () => {
    // Manually create a token pointing at port 3000
    rewriteAgentOutput("proxy-test", "http://localhost:3000");
    const output = rewriteAgentOutput("proxy-test", "http://localhost:3000");
    const token = output.match(/\/preview\/([a-f0-9-]{36})/)?.[1];
    expect(token).toBeTruthy();

    // Verify the token exists and points to port 3000
    const entry = lookupToken(token!);
    expect(entry?.port).toBe(3000);

    const request = new Request("http://localhost:3000/preview/" + token);
    const response = await proxyRequest(request, token!, undefined);

    expect(response.status).toBe(404);
  });

  it("rejects ports below 1024", async () => {
    // Create a token for port 80 -- the regex requires 4+ digits, so we
    // need to directly manipulate. Instead, create via rewriteAgentOutput
    // with a 4-digit port under 1024.
    rewriteAgentOutput("proxy-test", "http://localhost:1023");
    const output = rewriteAgentOutput("proxy-test", "http://localhost:1023");
    const token = output.match(/\/preview\/([a-f0-9-]{36})/)?.[1];
    expect(token).toBeTruthy();

    const request = new Request("http://localhost:3000/preview/" + token);
    const response = await proxyRequest(request, token!, undefined);

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// TESTS: HOP-BY-HOP HEADER STRIPPING
// ============================================================================

describe("hop-by-hop header stripping", () => {
  it("strips Transfer-Encoding, Connection, Keep-Alive, and Upgrade from response", async () => {
    const token = createTestToken();
    const request = new Request("http://localhost:3000/preview/" + token + "/hop-headers");
    const response = await proxyRequest(request, token, ["hop-headers"]);

    expect(response.status).toBe(200);
    expect(response.headers.has("transfer-encoding")).toBe(false);
    expect(response.headers.has("connection")).toBe(false);
    expect(response.headers.has("keep-alive")).toBe(false);
    expect(response.headers.has("upgrade")).toBe(false);
    // Custom headers should be preserved
    expect(response.headers.get("x-custom")).toBe("preserved");
  });
});
