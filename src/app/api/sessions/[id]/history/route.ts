/**
 * GET /api/sessions/[id]/history
 *
 * Returns the in-memory message history for a session.
 * - Returns { messages: Message[] }
 * - 404 if session not found or not active
 */

import { getMessageHistory } from "@/lib/session-manager";

// ============================================================================
// ENDPOINT
// ============================================================================

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/sessions/[id]/history">
) {
  const { id } = await ctx.params;
  const messages = getMessageHistory(id);

  if (messages === null) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  return Response.json({ messages });
}
