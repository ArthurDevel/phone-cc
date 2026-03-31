/**
 * POST endpoint to validate an auth token and set the session cookie.
 *
 * - Accepts { token: string } in the request body
 * - Rate-limits to 5 attempts per IP per minute
 * - Sets an HttpOnly cookie on successful validation
 * - Logs failed attempts with console.warn
 */

import { NextResponse } from "next/server";
import { validateToken, COOKIE_NAME, COOKIE_MAX_AGE } from "@/lib/auth";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum validation attempts per IP before rate limiting kicks in */
const MAX_ATTEMPTS = 5;

/** Window duration in milliseconds (1 minute) */
const WINDOW_MS = 60_000;

// ============================================================================
// RATE LIMITER STATE
// ============================================================================

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/** In-memory rate limit tracker keyed by client IP */
const rateLimitMap = new Map<string, RateLimitEntry>();

// ============================================================================
// MAIN HANDLERS
// ============================================================================

/**
 * Validates a token and sets the auth cookie on success.
 *
 * @param request - The incoming request with { token: string } body
 * @returns 200 with Set-Cookie on success, 401 on invalid token, 429 if rate limited
 */
export async function POST(request: Request): Promise<NextResponse> {
  const clientIp = getClientIp(request);

  // Check rate limit before doing any work
  if (isRateLimited(clientIp)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 },
    );
  }

  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const token = body.token;
  if (!token || typeof token !== "string") {
    return NextResponse.json(
      { error: "Token is required." },
      { status: 400 },
    );
  }

  const valid = await validateToken(token);

  if (!valid) {
    console.warn(`[auth] Failed token validation from IP: ${clientIp}`);
    return NextResponse.json(
      { error: "Invalid token" },
      { status: 401 },
    );
  }

  // Token is valid -- set the auth cookie and return success
  const isProduction = process.env.NODE_ENV !== "development";
  const response = NextResponse.json({ ok: true }, { status: 200 });

  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });

  return response;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extracts the client IP from the request headers.
 *
 * @param request - The incoming request
 * @returns The client IP string, or "unknown" if not available
 */
function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // x-forwarded-for can contain multiple IPs; take the first one
    return forwarded.split(",")[0].trim();
  }
  return "unknown";
}

/**
 * Checks whether a client IP has exceeded the rate limit and records the attempt.
 * Cleans up expired entries on each call.
 *
 * @param ip - The client IP to check
 * @returns True if the IP is rate limited, false otherwise
 */
function isRateLimited(ip: string): boolean {
  const now = Date.now();

  // Clean up expired entries
  for (const [key, entry] of rateLimitMap) {
    if (now >= entry.resetTime) {
      rateLimitMap.delete(key);
    }
  }

  const entry = rateLimitMap.get(ip);

  if (!entry) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + WINDOW_MS });
    return false;
  }

  // Window has expired, start fresh
  if (now >= entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + WINDOW_MS });
    return false;
  }

  entry.count += 1;

  if (entry.count > MAX_ATTEMPTS) {
    return true;
  }

  return false;
}
