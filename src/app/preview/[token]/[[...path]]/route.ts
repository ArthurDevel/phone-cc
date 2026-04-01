/**
 * Preview proxy route. Proxies requests to an upstream dev server based on
 * the preview token. All paths under /preview/<token>/* are forwarded to
 * the corresponding localhost port.
 *
 * Uses a Service Worker (injected into HTML responses) to intercept all
 * runtime requests (fetch, script, img, css, etc.) and rewrite absolute
 * paths to stay within the /preview/<token> prefix. This replaces fragile
 * text-based JS/CSS rewriting.
 *
 * The initial HTML still gets href/src attribute rewriting for the first
 * page load (before the SW activates).
 */

import { lookupToken } from "@/lib/preview-manager";

// ============================================================================
// CONSTANTS
// ============================================================================

const APP_PORT = parseInt(process.env.PORT || "3000", 10);
const MIN_ALLOWED_PORT = 1024;
const MAX_PORT = 65535;

/** Headers that should not be forwarded to the upstream */
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
]);

/** Special path that serves the Service Worker script */
const SW_SCRIPT_PATH = "__preview-sw.js";

// ============================================================================
// HANDLER
// ============================================================================

async function handleProxy(
  request: Request,
  ctx: RouteContext<"/preview/[token]/[[...path]]">,
): Promise<Response> {
  const { token, path } = await ctx.params;

  const entry = lookupToken(token);
  if (!entry) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // SSRF prevention
  if (entry.port < MIN_ALLOWED_PORT || entry.port > MAX_PORT || entry.port === APP_PORT) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Serve the Service Worker script
  if (path?.[0] === SW_SCRIPT_PATH && path.length === 1) {
    return new Response(buildServiceWorker(token), {
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-cache",
        "service-worker-allowed": `/preview/${token}/`,
      },
    });
  }

  // Build upstream URL: /preview/<token>/foo/bar → localhost:<port>/foo/bar
  const upstreamPath = path ? `/${path.join("/")}` : "/";
  const url = new URL(request.url);
  const upstream = `http://localhost:${entry.port}${upstreamPath}${url.search}`;

  // Forward headers, stripping hop-by-hop
  const headers = new Headers();
  for (const [key, value] of request.headers) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  }

  // Fetch from upstream
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
      redirect: "manual",
    });
  } catch {
    return Response.json(
      { error: "Upstream server not reachable" },
      { status: 502 },
    );
  }

  // Copy response headers, stripping hop-by-hop and content-encoding
  // (fetch() auto-decompresses, so forwarding content-encoding would cause
  // ERR_CONTENT_DECODING_FAILED in the browser)
  const responseHeaders = new Headers();
  for (const [key, value] of upstreamResponse.headers) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || lower === "content-encoding" || lower === "content-length") {
      continue;
    }
    responseHeaders.set(key, value);
  }

  // Handle redirects: rewrite Location header to stay within preview prefix
  const location = upstreamResponse.headers.get("location");
  if (location) {
    responseHeaders.set("location", rewriteLocation(location, entry.port, token));
  }

  const contentType = upstreamResponse.headers.get("content-type") ?? "";

  // For server errors returning HTML, the upstream likely failed to SSR.
  // The client-side error overlay needs the HMR WebSocket which doesn't
  // work through the proxy. Render our own error page.
  if (upstreamResponse.status >= 500 && contentType.includes("text/html")) {
    const html = await upstreamResponse.text();
    return new Response(buildErrorPage(html, entry.port), {
      status: upstreamResponse.status,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // For HTML responses: rewrite attributes + inject SW registration
  if (contentType.includes("text/html")) {
    const html = await upstreamResponse.text();
    const rewritten = rewriteHtml(html, token);

    return new Response(rewritten, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  }

  // All other responses (JS, CSS, JSON, images, etc.) pass through unmodified.
  // The Service Worker handles runtime path rewriting on the client side.
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

// All HTTP methods use the same handler
export const GET = handleProxy;
export const POST = handleProxy;
export const PUT = handleProxy;
export const PATCH = handleProxy;
export const DELETE = handleProxy;
export const HEAD = handleProxy;
export const OPTIONS = handleProxy;

// ============================================================================
// HTML REWRITING (initial page load only — SW handles the rest)
// ============================================================================

const PREFIX_PATTERN = /preview\/[a-f0-9-]{36}/;

/**
 * Rewrites HTML for the initial page load before the Service Worker is active.
 * - Rewrites href/src/action attributes to include the preview prefix
 * - Removes Next.js FOUC prevention (body{display:none})
 * - Injects the Service Worker registration script
 */
function rewriteHtml(html: string, token: string): string {
  const prefix = `/preview/${token}`;
  let result = html;

  // Remove Next.js FOUC prevention — it relies on client JS to unhide,
  // which may fail in proxied context (no HMR WebSocket)
  result = result.replace(
    /<style data-next-hide-fouc="true">body\{display:none\}<\/style>/,
    "",
  );

  // Rewrite href="/...", src="/...", action="/..."
  result = result.replace(
    /((?:href|src|action)\s*=\s*["'])(\/(?!\/)[^"']*)/gi,
    (_match, attr: string, path: string) => {
      if (PREFIX_PATTERN.test(path)) return _match;
      return `${attr}${prefix}${path}`;
    },
  );

  // Rewrite bare /_next/ paths in the full HTML (catches RSC payload strings
  // inside <script> blocks like "src":"/_next/static/..." that React uses to
  // load chunks before the Service Worker is active)
  const prefixedNext = `${prefix}/_next/`;
  result = result.replaceAll(prefixedNext, "\0PREFIXED\0");
  result = result.replaceAll("/_next/", prefixedNext);
  result = result.replaceAll("\0PREFIXED\0", prefixedNext);

  // Inject SW registration script right after <head> (or at start if no <head>)
  const swScript = buildSwRegistrationScript(token);
  if (result.includes("<head>")) {
    result = result.replace("<head>", `<head>${swScript}`);
  } else if (result.includes("<head ")) {
    result = result.replace(/<head [^>]*>/, `$&${swScript}`);
  } else {
    result = swScript + result;
  }

  return result;
}

// ============================================================================
// SERVICE WORKER
// ============================================================================

/**
 * Returns an inline <script> that registers the preview Service Worker.
 */
function buildSwRegistrationScript(token: string): string {
  const scope = `/preview/${token}/`;
  const swUrl = `/preview/${token}/${SW_SCRIPT_PATH}`;
  return `<script>if("serviceWorker"in navigator){navigator.serviceWorker.register("${swUrl}",{scope:"${scope}"})}</script>`;
}

/**
 * Returns the Service Worker source code. It intercepts all fetch requests
 * and rewrites absolute paths (starting with /) to stay within the preview
 * prefix. This catches runtime-constructed URLs that static HTML rewriting
 * would miss (e.g., fetch("/api/foo"), dynamic import("/_next/...")).
 */
function buildServiceWorker(token: string): string {
  return `// Preview proxy Service Worker for token: ${token}
const PREFIX = "/preview/${token}";

self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Only intercept same-origin requests
  if (url.origin !== self.location.origin) return;

  // Already prefixed — pass through
  if (url.pathname.startsWith(PREFIX + "/") || url.pathname === PREFIX) return;

  // Rewrite absolute paths to go through the preview proxy
  if (url.pathname.startsWith("/")) {
    url.pathname = PREFIX + url.pathname;
    e.respondWith(fetch(new Request(url.toString(), e.request)));
  }
});
`;
}

// ============================================================================
// ERROR PAGE
// ============================================================================

const NEXT_DATA_REGEX = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

/**
 * Builds a self-contained error page for upstream 500s. Extracts the error
 * from __NEXT_DATA__ if present, otherwise shows a generic message.
 */
function buildErrorPage(html: string, port: number): string {
  let errorMessage = "Internal Server Error";
  let errorStack = "";

  const match = html.match(NEXT_DATA_REGEX);
  if (match) {
    try {
      const data = JSON.parse(match[1]);
      if (data.err?.message) {
        errorMessage = data.err.message;
        errorStack = data.err.stack ?? "";
      }
    } catch {
      // Couldn't parse __NEXT_DATA__, use generic message
    }
  }

  const escapedMessage = errorMessage
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const escapedStack = errorStack
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Preview Error</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 2rem; background: #111; color: #e0e0e0; }
    .error-box { max-width: 800px; margin: 2rem auto; background: #1a1a2e; border: 1px solid #e74c3c; border-radius: 8px; padding: 1.5rem; }
    h1 { color: #e74c3c; font-size: 1.1rem; margin: 0 0 0.5rem; }
    .port { color: #888; font-size: 0.85rem; margin-bottom: 1rem; }
    .message { color: #f0f0f0; white-space: pre-wrap; word-break: break-word; font-size: 0.95rem; line-height: 1.5; }
    .stack { margin-top: 1rem; padding: 1rem; background: #0d0d1a; border-radius: 4px; font-family: monospace; font-size: 0.8rem; color: #888; white-space: pre-wrap; word-break: break-all; max-height: 300px; overflow: auto; }
  </style>
</head>
<body>
  <div class="error-box">
    <h1>500 — Server Error</h1>
    <div class="port">upstream localhost:${port}</div>
    <div class="message">${escapedMessage}</div>
    ${escapedStack ? `<div class="stack">${escapedStack}</div>` : ""}
  </div>
</body>
</html>`;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Rewrites a Location header value. If it points to the same upstream,
 * convert it to a preview-prefixed path.
 */
function rewriteLocation(location: string, port: number, token: string): string {
  const localPrefix = `http://localhost:${port}`;
  if (location.startsWith(localPrefix)) {
    const path = location.slice(localPrefix.length) || "/";
    return `/preview/${token}${path}`;
  }

  if (location.startsWith("/") && !PREFIX_PATTERN.test(location)) {
    return `/preview/${token}${location}`;
  }

  return location;
}
