/**
 * Preview entry point. Validates a preview token, sets a cookie identifying
 * the active preview port, and redirects to "/".
 *
 * Responsibilities:
 * - Validates preview tokens via lookupToken
 * - Checks port safety (SSRF prevention)
 * - Sets the phonecc_preview cookie with the target port
 * - Redirects the browser to "/" where proxy.ts will handle rewriting
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { lookupToken, PREVIEW_COOKIE_NAME } from "@/lib/preview-manager";

// ============================================================================
// CONSTANTS
// ============================================================================

/** The port the Next.js app runs on -- must be blocked to prevent request loops. */
const APP_PORT = parseInt(process.env.PORT || "3000", 10);

/** Minimum allowed port (inclusive). Ports below this are privileged. */
const MIN_ALLOWED_PORT = 1024;

/** Maximum valid port number. */
const MAX_PORT = 65535;

// ============================================================================
// ENDPOINT HANDLERS
// ============================================================================

/**
 * Validates the preview token, sets the preview cookie, and redirects to "/".
 *
 * @param _request - The incoming request (unused)
 * @param ctx - Route context containing the token param
 * @returns A redirect response to "/"
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/preview/[token]/[[...path]]">
) {
  const { token } = await ctx.params;

  const entry = lookupToken(token);
  if (!entry) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // SSRF prevention: reject privileged, self-referencing, or out-of-range ports
  if (entry.port < MIN_ALLOWED_PORT || entry.port === APP_PORT || entry.port > MAX_PORT) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const cookieStore = await cookies();
  cookieStore.set(PREVIEW_COOKIE_NAME, String(entry.port), {
    maxAge: 14400,
    httpOnly: true,
    path: "/",
  });

  redirect("/");
}
