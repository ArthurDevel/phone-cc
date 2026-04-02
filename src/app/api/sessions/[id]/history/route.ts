/**
 * GET /api/sessions/[id]/history
 *
 * Returns the in-memory message history for a session.
 * - Returns { messages: Message[] }
 * - 404 if session not found or not active
 */

import { getMessageHistory, reconnectSession } from "@/lib/session-manager";
import { rewriteAgentOutput } from "@/lib/preview-manager";

// ============================================================================
// ENDPOINT
// ============================================================================

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/sessions/[id]/history">
) {
  const { id } = await ctx.params;
  console.log("[history] GET /api/sessions/" + id + "/history");

  // If session isn't in memory yet (e.g. after server restart / page refresh),
  // try to reconnect it so we can load history from the SDK's JSONL file.
  let messages = getMessageHistory(id);
  console.log("[history] getMessageHistory returned:", messages === null ? "null" : messages.length + " messages");
  if (messages === null) {
    try {
      console.log("[history] calling reconnectSession...");
      await reconnectSession(id);
      messages = getMessageHistory(id);
      console.log("[history] after reconnect:", messages === null ? "null" : messages.length + " messages");
    } catch (err) {
      console.log("[history] reconnect error:", err);
    }
  }

  if (messages === null) {
    console.log("[history] returning 404");
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  // Rewrite localhost URLs to preview URLs in assistant messages
  const rewrittenMessages = messages.map((msg) => {
    if (msg.role === "assistant") {
      return {
        ...msg,
        contentBlocks: msg.contentBlocks.map((block) =>
          block.type === "text"
            ? { ...block, text: rewriteAgentOutput(id, block.text) }
            : block
        ),
      };
    }
    return msg;
  });

  console.log("[history] returning", rewrittenMessages.length, "messages");
  return Response.json({ messages: rewrittenMessages });
}
