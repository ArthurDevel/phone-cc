/**
 * Next.js 16 proxy (replaces middleware.ts) for token-based authentication.
 *
 * - Intercepts all requests except static assets, /login, and /api/auth
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

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV !== "development",
  sameSite: "lax" as const,
  maxAge: COOKIE_MAX_AGE,
  path: "/",
};

// ============================================================================
// MAIN HANDLERS
// ============================================================================

/**
 * Authenticates every matched request via cookie or URL token.
 *
 * Checks for a ?token= query param first. If present and valid, sets the auth
 * cookie and redirects to the same URL with the token param stripped. If the
 * cookie is already valid, passes through. Otherwise redirects pages to /login
 * or returns 401 JSON for API routes.
 *
 * @param request - The incoming Next.js request
 * @returns A NextResponse (redirect, pass-through, or 401)
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  // Ensure the token file exists (lazy init on first request)
  await getOrCreateToken();

  const { searchParams } = request.nextUrl;
  const tokenParam = searchParams.get("token");

  // Token in URL takes priority — validate and set cookie
  if (tokenParam) {
    return handleTokenParam(request, tokenParam);
  }

  // Check existing auth cookie
  const cookie = request.cookies.get(COOKIE_NAME);

  if (cookie && (await validateToken(cookie.value))) {
    return NextResponse.next();
  }

  // No valid auth — reject the request
  return handleUnauthenticated(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon-192.png|manifest.json|login(?:/|$)|api/auth).*)",
  ],
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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
