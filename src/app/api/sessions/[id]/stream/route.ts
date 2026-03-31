/**
 * GET /api/sessions/[id]/stream
 *
 * Server-Sent Events endpoint for real-time chat streaming.
 * - Subscribes to the session's EventEmitter
 * - Pushes events: text_delta, tool_use_start, tool_use_result, message_end, status_change, user_message
 * - Keeps connection open until client disconnects
 */

import { getEventEmitter, reconnectSession } from "@/lib/session-manager";

// ============================================================================
// ENDPOINT
// ============================================================================

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/sessions/[id]/stream">
) {
  const { id } = await ctx.params;
  let emitter = getEventEmitter(id);

  // Auto-reconnect if session isn't in memory (e.g. after page refresh)
  if (!emitter) {
    console.log("[stream] session not in memory, reconnecting:", id);
    try {
      await reconnectSession(id);
      emitter = getEventEmitter(id);
    } catch {
      // Session doesn't exist on disk
    }
  }

  if (!emitter) {
    console.log("[stream] session not found after reconnect:", id);
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      /** Writes an SSE-formatted event to the stream */
      function sendEvent(eventType: string, data: unknown) {
        const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Stream closed, ignore
        }
      }

      /** Listener receives (eventType, data) from the session emitter */
      function onSse(eventType: string, data: unknown) {
        sendEvent(eventType, data);
      }

      emitter.on("sse", onSse);

      // Send a heartbeat comment every 30s to keep the connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      // Clean up when client disconnects
      request.signal.addEventListener("abort", () => {
        emitter.off("sse", onSse);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
