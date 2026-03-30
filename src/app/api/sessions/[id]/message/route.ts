/**
 * POST /api/sessions/[id]/message
 *
 * Sends a user message to the session's Claude agent.
 * - Validates text is non-empty
 * - Fires off sendMessage (response streams via SSE, not this endpoint)
 * - Returns 200 immediately
 */

import { sendMessage } from "@/lib/session-manager";

// ============================================================================
// ENDPOINT
// ============================================================================

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/sessions/[id]/message">
) {
  const { id } = await ctx.params;

  let text: string;
  try {
    const body = await request.json();
    text = body.text;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }

  // Fire-and-forget: the response streams via SSE
  sendMessage(id, text.trim()).catch(() => {
    // Errors are emitted via SSE status_change events
  });

  return Response.json({ ok: true });
}
