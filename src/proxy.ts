/**
 * Next.js 16 proxy for preview rewriting and token-based authentication.
 *
 * - When a preview cookie is active, rewrites all requests to the upstream dev server
 * - Exempts /preview/* paths from rewrite so the route handler can manage preview sessions
 * - Validates preview ports to prevent SSRF (no privileged ports, no self-loop)
 * - Intercepts all requests except static assets, /login, and /api/auth for auth checks
 * - Validates auth via cookie or ?token= query parameter
 * - Sets an HttpOnly cookie on successful token validation
 * - Redirects unauthenticated page requests to /login
 * - Returns 401 JSON for unauthenticated API requests
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateToken,
  validateToken,
  COOKIE_NAME,
  COOKIE_MAX_AGE,
} from "@/lib/auth";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Cookie name used to store the active preview port */
export const PREVIEW_COOKIE_NAME = "phonecc_preview";

/** Port this app is running on (used to prevent rewrite loops) */
const APP_PORT = parseInt(process.env.PORT || "3000", 10);

// Generate token eagerly on server start (not on first request)
getOrCreateToken();

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https"),
  sameSite: "lax" as const,
  maxAge: COOKIE_MAX_AGE,
  path: "/",
};

// ============================================================================
// MAIN HANDLERS
// ============================================================================

/**
 * Main proxy function. Handles preview rewriting and authentication.
 *
 * Processing order:
 * 1. If path starts with /preview/, skip rewrite (let route handler manage it)
 * 2. If preview cookie is set with a safe port, rewrite to upstream dev server
 * 3. Otherwise, run existing auth logic (token param, cookie, or reject)
 *
 * @param request - The incoming Next.js request
 * @returns A NextResponse (rewrite, redirect, pass-through, or 401)
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;

  // Step 1: Exempt /preview/* from rewrite -- let the route handler handle it
  // (This must come before the preview cookie check to avoid trapping the user)
  if (!pathname.startsWith("/preview/")) {
    // Step 2: Check for preview cookie and rewrite if valid
    const previewCookie = request.cookies.get(PREVIEW_COOKIE_NAME);

    if (previewCookie) {
      const port = parseInt(previewCookie.value, 10);
      const rewriteResponse = handlePreviewRewrite(request, port);

      if (rewriteResponse) {
        return rewriteResponse;
      }
      // If port is unsafe, fall through to auth logic
    }
  }

  // Step 3: Existing auth logic
  const { searchParams } = request.nextUrl;
  const tokenParam = searchParams.get("token");

  // Token in URL takes priority -- validate and set cookie
  if (tokenParam) {
    return handleTokenParam(request, tokenParam);
  }

  // Check existing auth cookie
  const cookie = request.cookies.get(COOKIE_NAME);

  if (cookie && (await validateToken(cookie.value))) {
    return NextResponse.next();
  }

  // No valid auth -- reject the request
  return handleUnauthenticated(request);
}

export const config = {
  matcher: [
    // When preview cookie is set, match everything (including _next/static)
    {
      source: "/(.*)",
      has: [{ type: "cookie", key: "phonecc_preview" }],
    },
    // Normal auth matcher (existing, unchanged)
    "/((?!_next/static|_next/image|favicon.ico|icon-192.png|manifest.json|login(?:/|$)|api/auth).*)",
  ],
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Checks whether a port number is safe to rewrite to.
 *
 * Rejects non-numeric values, privileged ports (< 1024), ports above the
 * valid range (> 65535), and the app's own port (to prevent request loops).
 *
 * @param port - The port number to validate
 * @returns True if the port is safe to use as a rewrite target
 */
export function isPortSafe(port: number): boolean {
  if (Number.isNaN(port)) return false;
  if (port < 1024) return false;
  if (port > 65535) return false;
  if (port === APP_PORT) return false;

  return true;
}

/**
 * Builds a rewrite response to proxy the request to a local dev server.
 *
 * Validates the port via isPortSafe. If safe, constructs a rewrite URL using
 * the original pathname and search params. Returns null if the port is unsafe,
 * allowing the caller to fall through to normal auth logic.
 *
 * @param request - The incoming Next.js request
 * @param port - The target port parsed from the preview cookie
 * @returns A NextResponse.rewrite() response, or null if the port is unsafe
 */
export function handlePreviewRewrite(
  request: NextRequest,
  port: number,
): NextResponse | null {
  if (!isPortSafe(port)) {
    return null;
  }

  const url = new URL(
    request.nextUrl.pathname + request.nextUrl.search,
    `http://localhost:${port}`,
  );

  const response = NextResponse.rewrite(url);
  response.headers.set("x-phonecc-preview", String(port));

  return response;
}

/**
 * Validates a token from the URL query param. If valid, sets the auth cookie
 * and redirects to the same URL with the token param removed. If invalid,
 * redirects to /login.
 *
 * @param request - The incoming request
 * @param token - The token value from the query string
 * @returns A redirect response
 */
async function handleTokenParam(
  request: NextRequest,
  token: string,
): Promise<NextResponse> {
  const isValid = await validateToken(token);

  if (!isValid) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Build redirect URL without the token param
  const redirectUrl = new URL(request.url);
  redirectUrl.searchParams.delete("token");

  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);

  return response;
}

/**
 * Handles requests that have no valid authentication. Page requests are
 * redirected to /login. API requests receive a 401 JSON response.
 *
 * @param request - The unauthenticated request
 * @returns A redirect or 401 response
 */
function handleUnauthenticated(request: NextRequest): NextResponse {
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");

  if (isApiRoute) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}
