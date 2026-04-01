/**
 * Catch-all reverse proxy that forwards HTTP requests to localhost ports
 * based on preview tokens.
 *
 * Responsibilities:
 * - Validates preview tokens via lookupToken
 * - Forwards requests to the correct localhost:{port}/{path}
 * - Strips hop-by-hop headers from the proxied response
 * - Rejects unsafe ports (< 1024 and port 3000) for SSRF prevention
 */

import { lookupToken } from "@/lib/preview-manager";

// ============================================================================
// CONSTANTS
// ============================================================================

/** The port the Next.js app runs on -- must be blocked to prevent request loops. */
const APP_PORT = 3000;

/** Minimum allowed port (inclusive). Ports below this are privileged. */
const MIN_ALLOWED_PORT = 1024;

/** Headers that must not be forwarded from the proxied response. */
const HOP_BY_HOP_HEADERS = [
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
];

// ============================================================================
// ENDPOINT HANDLERS
// ============================================================================

export async function GET(
  request: Request,
  ctx: RouteContext<"/preview/[token]/[[...path]]">
) {
  const { token, path } = await ctx.params;
  return proxyRequest(request, token, path);
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/preview/[token]/[[...path]]">
) {
  const { token, path } = await ctx.params;
  return proxyRequest(request, token, path);
}

export async function PUT(
  request: Request,
  ctx: RouteContext<"/preview/[token]/[[...path]]">
) {
  const { token, path } = await ctx.params;
  return proxyRequest(request, token, path);
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/preview/[token]/[[...path]]">
) {
  const { token, path } = await ctx.params;
  return proxyRequest(request, token, path);
}

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/preview/[token]/[[...path]]">
) {
  const { token, path } = await ctx.params;
  return proxyRequest(request, token, path);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Core proxy logic: validates the token, builds the target URL, forwards the
 * request to localhost:{port}/{path}, and returns the response with hop-by-hop
 * headers stripped.
 *
 * @param request - The incoming HTTP request
 * @param token - The preview token string from the URL
 * @param pathSegments - The remaining path segments after the token (undefined when no sub-path)
 * @returns A proxied Response, or a 404 if the token is invalid
 */
export async function proxyRequest(
  request: Request,
  token: string,
  pathSegments: string[] | undefined
): Promise<Response> {
  // Validate token
  const entry = lookupToken(token);
  if (!entry) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // SSRF prevention: reject dangerous ports
  if (entry.port < MIN_ALLOWED_PORT || entry.port === APP_PORT) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Build the target URL
  const path = pathSegments ? pathSegments.join("/") : "";
  const targetUrl = `http://localhost:${entry.port}/${path}`;

  // Forward the request with original headers
  const headers = new Headers(request.headers);
  headers.set("host", `localhost:${entry.port}`);

  const response = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.body,
    // @ts-expect-error -- duplex is required for streaming request bodies in Node
    duplex: "half",
    redirect: "manual",
  });

  // Strip hop-by-hop headers from the response
  const responseHeaders = new Headers(response.headers);
  for (const header of HOP_BY_HOP_HEADERS) {
    responseHeaders.delete(header);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
