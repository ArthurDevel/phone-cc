/**
 * Tests for the cookie-based preview proxy rewrite system.
 *
 * Covers:
 * - proxy.ts: rewrite behavior with preview cookies, auth fallthrough, SSRF prevention
 * - isPortSafe: port validation logic
 * - handlePreviewRewrite: rewrite response construction
 * - Route handler (route.ts): token validation, cookie setting, redirects
 * - Exit route (exit/route.ts): cookie clearing and redirect
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  isRewrite,
  getRewrittenUrl,
  getRedirectUrl,
} from "next/experimental/testing/server";

// ============================================================================
// MOCKS
// ============================================================================

// Mock @/lib/auth so proxy() can call validateToken without real token logic
vi.mock("@/lib/auth", () => ({
  getOrCreateToken: vi.fn(),
  validateToken: vi.fn().mockResolvedValue(false),
  COOKIE_NAME: "phonecc_token",
  COOKIE_MAX_AGE: 86400,
}));

// Mock @/lib/preview-manager for route handler tests
vi.mock("@/lib/preview-manager", () => ({
  lookupToken: vi.fn(),
  PREVIEW_COOKIE_NAME: "phonecc_preview",
}));

// Mock next/headers for route handler tests
const mockCookieSet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    set: mockCookieSet,
  }),
}));

// Mock next/navigation -- redirect() throws like in real Next.js
const redirectError = new Error("NEXT_REDIRECT");
vi.mock("next/navigation", () => ({
  redirect: vi.fn().mockImplementation(() => {
    throw redirectError;
  }),
}));

// ============================================================================
// IMPORTS (after mocks)
// ============================================================================

import {
  proxy,
  config,
  isPortSafe,
  handlePreviewRewrite,
  PREVIEW_COOKIE_NAME,
} from "@/proxy";
import { lookupToken } from "@/lib/preview-manager";
import { redirect } from "next/navigation";

// ============================================================================
// SETUP
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  mockCookieSet.mockClear();
});

// ============================================================================
// TESTS: proxy() -- PREVIEW REWRITE BEHAVIOR
// ============================================================================

describe("proxy() -- preview rewrite behavior", () => {
  it("rewrites to localhost:{port} when preview cookie is set with a valid port", async () => {
    const request = new NextRequest("http://localhost:3000/some/path?q=1", {
      headers: { cookie: "phonecc_preview=3002" },
    });

    const response = await proxy(request);

    expect(isRewrite(response)).toBe(true);
    expect(getRewrittenUrl(response)).toBe(
      "http://localhost:3002/some/path?q=1"
    );
  });

  it("does NOT redirect to /login when preview cookie is set (bypasses auth)", async () => {
    const request = new NextRequest("http://localhost:3000/dashboard", {
      headers: { cookie: "phonecc_preview=3002" },
    });

    const response = await proxy(request);

    // Should rewrite, not redirect
    expect(isRewrite(response)).toBe(true);
    expect(getRedirectUrl(response)).toBeNull();
  });

  it("falls through to auth logic when NO preview cookie is set", async () => {
    const request = new NextRequest("http://localhost:3000/dashboard");

    const response = await proxy(request);

    // No auth cookie either, so should redirect to /login
    expect(isRewrite(response)).toBe(false);
    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl).toContain("/login");
  });

  it("SSRF: cookie with port 22 (< 1024) does NOT trigger a rewrite", async () => {
    const request = new NextRequest("http://localhost:3000/page", {
      headers: { cookie: "phonecc_preview=22" },
    });

    const response = await proxy(request);

    expect(isRewrite(response)).toBe(false);
  });

  it("SSRF: cookie with port 3000 (APP_PORT) does NOT trigger a rewrite", async () => {
    const request = new NextRequest("http://localhost:3000/page", {
      headers: { cookie: "phonecc_preview=3000" },
    });

    const response = await proxy(request);

    expect(isRewrite(response)).toBe(false);
  });

  it("SSRF: cookie with port 99999 (> 65535) does NOT trigger a rewrite", async () => {
    const request = new NextRequest("http://localhost:3000/page", {
      headers: { cookie: "phonecc_preview=99999" },
    });

    const response = await proxy(request);

    expect(isRewrite(response)).toBe(false);
  });

  it("SSRF: cookie with non-numeric value does NOT trigger a rewrite", async () => {
    const request = new NextRequest("http://localhost:3000/page", {
      headers: { cookie: "phonecc_preview=abc" },
    });

    const response = await proxy(request);

    expect(isRewrite(response)).toBe(false);
  });

  it("exempts /preview/* paths from rewrite even when preview cookie is set", async () => {
    const request = new NextRequest(
      "http://localhost:3000/preview/some-token",
      {
        headers: { cookie: "phonecc_preview=3002" },
      }
    );

    const response = await proxy(request);

    // Should NOT rewrite -- falls through to auth logic
    expect(isRewrite(response)).toBe(false);
  });
});

// ============================================================================
// TESTS: isPortSafe()
// ============================================================================

describe("isPortSafe()", () => {
  it("returns true for valid ports (3002, 8080)", () => {
    expect(isPortSafe(3002)).toBe(true);
    expect(isPortSafe(8080)).toBe(true);
  });

  it("returns false for port < 1024", () => {
    expect(isPortSafe(80)).toBe(false);
    expect(isPortSafe(443)).toBe(false);
    expect(isPortSafe(1023)).toBe(false);
  });

  it("returns false for port 3000 (APP_PORT)", () => {
    expect(isPortSafe(3000)).toBe(false);
  });

  it("returns false for port > 65535", () => {
    expect(isPortSafe(65536)).toBe(false);
    expect(isPortSafe(99999)).toBe(false);
  });

  it("returns false for NaN", () => {
    expect(isPortSafe(NaN)).toBe(false);
  });
});

// ============================================================================
// TESTS: handlePreviewRewrite()
// ============================================================================

describe("handlePreviewRewrite()", () => {
  it("returns a rewrite response for a safe port", () => {
    const request = new NextRequest("http://localhost:3000/hello?x=1");

    const response = handlePreviewRewrite(request, 3002);

    expect(response).not.toBeNull();
    expect(isRewrite(response!)).toBe(true);
    expect(getRewrittenUrl(response!)).toBe("http://localhost:3002/hello?x=1");
  });

  it("returns null for an unsafe port", () => {
    const request = new NextRequest("http://localhost:3000/hello");

    expect(handlePreviewRewrite(request, 22)).toBeNull();
    expect(handlePreviewRewrite(request, 3000)).toBeNull();
    expect(handlePreviewRewrite(request, 99999)).toBeNull();
  });

  it("sets x-phonecc-preview response header", () => {
    const request = new NextRequest("http://localhost:3000/page");

    const response = handlePreviewRewrite(request, 4000);

    expect(response).not.toBeNull();
    expect(response!.headers.get("x-phonecc-preview")).toBe("4000");
  });
});

// ============================================================================
// TESTS: ROUTE HANDLER (preview/[token]/[[...path]]/route.ts)
// ============================================================================

describe("preview route handler (GET)", () => {
  // We need to dynamically import the route handler so mocks are in place
  let GET: typeof import("@/app/preview/[token]/[[...path]]/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCookieSet.mockClear();

    // Re-import to get fresh module with mocks applied
    const mod = await import("@/app/preview/[token]/[[...path]]/route");
    GET = mod.GET;
  });

  it("sets cookie and redirects to '/' for a valid token", async () => {
    const mockedLookup = vi.mocked(lookupToken);
    mockedLookup.mockReturnValue({
      token: "abc-123",
      port: 3002,
      sessionId: "s1",
      createdAt: new Date(),
    });

    const request = new Request("http://localhost:3000/preview/abc-123");
    const ctx = { params: Promise.resolve({ token: "abc-123", path: undefined }) };

    await expect(GET(request, ctx as any)).rejects.toThrow(redirectError);

    // Should have set the preview cookie with the port
    expect(mockCookieSet).toHaveBeenCalledWith(
      "phonecc_preview",
      "3002",
      expect.objectContaining({ maxAge: 14400, httpOnly: true, path: "/" })
    );

    // Should have called redirect("/")
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("returns 404 for an invalid token", async () => {
    const mockedLookup = vi.mocked(lookupToken);
    mockedLookup.mockReturnValue(undefined);

    const request = new Request("http://localhost:3000/preview/bad-token");
    const ctx = { params: Promise.resolve({ token: "bad-token", path: undefined }) };

    const response = await GET(request, ctx as any);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Not found");
  });

  it("SSRF: token pointing to port 3000 returns 404", async () => {
    const mockedLookup = vi.mocked(lookupToken);
    mockedLookup.mockReturnValue({
      token: "ssrf-token",
      port: 3000,
      sessionId: "s1",
      createdAt: new Date(),
    });

    const request = new Request("http://localhost:3000/preview/ssrf-token");
    const ctx = { params: Promise.resolve({ token: "ssrf-token", path: undefined }) };

    const response = await GET(request, ctx as any);

    expect(response.status).toBe(404);
  });

  it("SSRF: token pointing to port < 1024 returns 404", async () => {
    const mockedLookup = vi.mocked(lookupToken);
    mockedLookup.mockReturnValue({
      token: "low-port",
      port: 22,
      sessionId: "s1",
      createdAt: new Date(),
    });

    const request = new Request("http://localhost:3000/preview/low-port");
    const ctx = { params: Promise.resolve({ token: "low-port", path: undefined }) };

    const response = await GET(request, ctx as any);

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// TESTS: EXIT ROUTE (preview/exit/route.ts)
// ============================================================================

describe("exit route handler (GET)", () => {
  let exitGET: typeof import("@/app/preview/exit/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCookieSet.mockClear();

    const mod = await import("@/app/preview/exit/route");
    exitGET = mod.GET;
  });

  it("clears the cookie (maxAge 0) and redirects to '/'", async () => {
    const request = new Request("http://localhost:3000/preview/exit");

    await expect(exitGET(request)).rejects.toThrow(redirectError);

    // Should clear the cookie by setting maxAge to 0
    expect(mockCookieSet).toHaveBeenCalledWith(
      "phonecc_preview",
      "",
      expect.objectContaining({ maxAge: 0, httpOnly: true, path: "/" })
    );

    // Should redirect to "/"
    expect(redirect).toHaveBeenCalledWith("/");
  });
});
