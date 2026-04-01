/**
 * POST /api/sessions/[id]/message
 *
 * Sends a user message to the session's Claude agent.
 * - Validates text is non-empty
 * - Fires off sendMessage (response streams via SSE, not this endpoint)
 * - Returns 200 immediately
 */

import { sendMessage } from "@/lib/session-manager";
import { rewriteUserInput } from "@/lib/preview-manager";

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

  // Rewrite any preview URLs back to localhost before sending to agent
  const rewrittenText = rewriteUserInput(text.trim());

  // Fire-and-forget: the response streams via SSE
  sendMessage(id, rewrittenText).catch(() => {
    // Errors are emitted via SSE status_change events
  });

  return Response.json({ ok: true });
}
