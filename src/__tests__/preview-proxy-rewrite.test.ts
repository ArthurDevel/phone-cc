/**
 * Tests for the path-based preview proxy with Service Worker injection.
 *
 * Covers:
 * - proxy.ts: auth-only behavior (no preview logic)
 * - Route handler: token lookup, SSRF prevention, upstream proxying,
 *   HTML rewriting, SW script serving, passthrough for non-HTML
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { getRedirectUrl } from "next/experimental/testing/server";

// ============================================================================
// MOCKS
// ============================================================================

vi.mock("@/lib/auth", () => ({
  getOrCreateToken: vi.fn(),
  validateToken: vi.fn().mockResolvedValue(false),
  COOKIE_NAME: "phonecc_token",
  COOKIE_MAX_AGE: 86400,
}));

vi.mock("@/lib/preview-manager", () => ({
  lookupToken: vi.fn(),
}));

// Mock global fetch for upstream proxy tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ============================================================================
// IMPORTS (after mocks)
// ============================================================================

import { proxy, config } from "@/proxy";
import { lookupToken } from "@/lib/preview-manager";

// ============================================================================
// SETUP
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// TESTS: proxy() -- AUTH ONLY
// ============================================================================

describe("proxy() -- auth only", () => {
  it("redirects unauthenticated page requests to /login", async () => {
    const request = new NextRequest("http://localhost:3000/dashboard");
    const response = await proxy(request);
    expect(getRedirectUrl(response)).toContain("/login");
  });

  it("returns 401 for unauthenticated API requests", async () => {
    const request = new NextRequest("http://localhost:3000/api/something");
    const response = await proxy(request);
    expect(response.status).toBe(401);
  });
});

// ============================================================================
// TESTS: config.matcher
// ============================================================================

describe("config.matcher", () => {
  it("excludes /preview/ paths from auth", () => {
    const pattern = config.matcher[0] as string;
    expect(pattern).toContain("preview/");
  });
});

// ============================================================================
// TESTS: ROUTE HANDLER (preview/[token]/[[...path]]/route.ts)
// ============================================================================

describe("preview route handler", () => {
  let GET: typeof import("@/app/preview/[token]/[[...path]]/route").GET;
  let POST: typeof import("@/app/preview/[token]/[[...path]]/route").POST;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/preview/[token]/[[...path]]/route");
    GET = mod.GET;
    POST = mod.POST;
  });

  it("returns 404 for an unknown token", async () => {
    vi.mocked(lookupToken).mockReturnValue(undefined);

    const request = new Request("http://localhost:3000/preview/bad-token");
    const ctx = { params: Promise.resolve({ token: "bad-token", path: undefined }) };
    const response = await GET(request, ctx as any);

    expect(response.status).toBe(404);
  });

  it("returns 404 for SSRF: port < 1024", async () => {
    vi.mocked(lookupToken).mockReturnValue({
      token: "t1", port: 22, sessionId: "s1", createdAt: new Date(),
    });

    const request = new Request("http://localhost:3000/preview/t1");
    const ctx = { params: Promise.resolve({ token: "t1", path: undefined }) };
    const response = await GET(request, ctx as any);

    expect(response.status).toBe(404);
  });

  it("returns 404 for SSRF: port === APP_PORT (3000)", async () => {
    vi.mocked(lookupToken).mockReturnValue({
      token: "t1", port: 3000, sessionId: "s1", createdAt: new Date(),
    });

    const request = new Request("http://localhost:3000/preview/t1");
    const ctx = { params: Promise.resolve({ token: "t1", path: undefined }) };
    const response = await GET(request, ctx as any);

    expect(response.status).toBe(404);
  });

  it("proxies to upstream and returns the response", async () => {
    vi.mocked(lookupToken).mockReturnValue({
      token: "abc-123", port: 3002, sessionId: "s1", createdAt: new Date(),
    });

    mockFetch.mockResolvedValue(new Response("Hello from upstream", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }));

    const request = new Request("http://localhost:3000/preview/abc-123/page");
    const ctx = { params: Promise.resolve({ token: "abc-123", path: ["page"] }) };
    const response = await GET(request, ctx as any);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello from upstream");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3002/page",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("proxies root path when no path segments", async () => {
    vi.mocked(lookupToken).mockReturnValue({
      token: "abc-123", port: 3002, sessionId: "s1", createdAt: new Date(),
    });

    mockFetch.mockResolvedValue(new Response("root", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }));

    const request = new Request("http://localhost:3000/preview/abc-123");
    const ctx = { params: Promise.resolve({ token: "abc-123", path: undefined }) };
    await GET(request, ctx as any);

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3002/",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns 502 when upstream is unreachable", async () => {
    vi.mocked(lookupToken).mockReturnValue({
      token: "abc-123", port: 3002, sessionId: "s1", createdAt: new Date(),
    });

    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const request = new Request("http://localhost:3000/preview/abc-123");
    const ctx = { params: Promise.resolve({ token: "abc-123", path: undefined }) };
    const response = await GET(request, ctx as any);

    expect(response.status).toBe(502);
  });

  it("rewrites absolute paths in HTML responses", async () => {
    vi.mocked(lookupToken).mockReturnValue({
      token: "abc-123", port: 3002, sessionId: "s1", createdAt: new Date(),
    });

    const html = '<html><head></head><body><a href="/about">About</a><img src="/logo.png"></body></html>';
    mockFetch.mockResolvedValue(new Response(html, {
      status: 200,
      headers: { "content-type": "text/html" },
    }));

    const request = new Request("http://localhost:3000/preview/abc-123");
    const ctx = { params: Promise.resolve({ token: "abc-123", path: undefined }) };
    const response = await GET(request, ctx as any);

    const body = await response.text();
    expect(body).toContain('href="/preview/abc-123/about"');
    expect(body).toContain('src="/preview/abc-123/logo.png"');
  });

  it("injects Service Worker registration script into HTML", async () => {
    vi.mocked(lookupToken).mockReturnValue({
      token: "abc-123", port: 3002, sessionId: "s1", createdAt: new Date(),
    });

    const html = "<html><head></head><body>Hello</body></html>";
    mockFetch.mockResolvedValue(new Response(html, {
      status: 200,
      headers: { "content-type": "text/html" },
    }));

    const request = new Request("http://localhost:3000/preview/abc-123");
    const ctx = { params: Promise.resolve({ token: "abc-123", path: undefined }) };
    const response = await GET(request, ctx as any);

    const body = await response.text();
    expect(body).toContain("serviceWorker");
    expect(body).toContain("__preview-sw.js");
    expect(body).toContain("/preview/abc-123/");
  });

  it("serves the Service Worker script at __preview-sw.js", async () => {
    vi.mocked(lookupToken).mockReturnValue({
      token: "abc-123", port: 3002, sessionId: "s1", createdAt: new Date(),
    });

    const request = new Request("http://localhost:3000/preview/abc-123/__preview-sw.js");
    const ctx = { params: Promise.resolve({ token: "abc-123", path: ["__preview-sw.js"] }) };
    const response = await GET(request, ctx as any);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    const body = await response.text();
    expect(body).toContain('/preview/abc-123');
    expect(body).toContain("self.addEventListener");
    // Should NOT have called upstream fetch
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("passes JS responses through unmodified", async () => {
    vi.mocked(lookupToken).mockReturnValue({
      token: "abc-123", port: 3002, sessionId: "s1", createdAt: new Date(),
    });

    const js = 'fetch("/_next/data/build/page.json")';
    mockFetch.mockResolvedValue(new Response(js, {
      status: 200,
      headers: { "content-type": "application/javascript" },
    }));

    const request = new Request("http://localhost:3000/preview/abc-123/_next/chunk.js");
    const ctx = { params: Promise.resolve({ token: "abc-123", path: ["_next", "chunk.js"] }) };
    const response = await GET(request, ctx as any);

    // JS should NOT be rewritten — the SW handles runtime path interception
    expect(await response.text()).toBe(js);
  });

  it("passes JSON responses through unmodified", async () => {
    vi.mocked(lookupToken).mockReturnValue({
      token: "abc-123", port: 3002, sessionId: "s1", createdAt: new Date(),
    });

    const json = '{"href":"/about"}';
    mockFetch.mockResolvedValue(new Response(json, {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const request = new Request("http://localhost:3000/preview/abc-123");
    const ctx = { params: Promise.resolve({ token: "abc-123", path: undefined }) };
    const response = await GET(request, ctx as any);

    expect(await response.text()).toBe(json);
  });

  it("rewrites Location header on redirects", async () => {
    vi.mocked(lookupToken).mockReturnValue({
      token: "abc-123", port: 3002, sessionId: "s1", createdAt: new Date(),
    });

    mockFetch.mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "/login" },
    }));

    const request = new Request("http://localhost:3000/preview/abc-123");
    const ctx = { params: Promise.resolve({ token: "abc-123", path: undefined }) };
    const response = await GET(request, ctx as any);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/preview/abc-123/login");
  });

  it("forwards POST requests with body", async () => {
    vi.mocked(lookupToken).mockReturnValue({
      token: "abc-123", port: 3002, sessionId: "s1", createdAt: new Date(),
    });

    mockFetch.mockResolvedValue(new Response('{"ok":true}', {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const request = new Request("http://localhost:3000/preview/abc-123/api/data", {
      method: "POST",
      body: JSON.stringify({ name: "test" }),
    });
    const ctx = { params: Promise.resolve({ token: "abc-123", path: ["api", "data"] }) };
    const response = await POST(request, ctx as any);

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3002/api/data",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("renders error page for upstream 500s", async () => {
    vi.mocked(lookupToken).mockReturnValue({
      token: "abc-123", port: 3002, sessionId: "s1", createdAt: new Date(),
    });

    const html = '<html><script id="__NEXT_DATA__" type="application/json">{"err":{"message":"Supabase config missing","stack":"Error: Supabase config missing\\n    at init"}}</script></html>';
    mockFetch.mockResolvedValue(new Response(html, {
      status: 500,
      headers: { "content-type": "text/html" },
    }));

    const request = new Request("http://localhost:3000/preview/abc-123");
    const ctx = { params: Promise.resolve({ token: "abc-123", path: undefined }) };
    const response = await GET(request, ctx as any);

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain("Supabase config missing");
    expect(body).toContain("localhost:3002");
  });
});
