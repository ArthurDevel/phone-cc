/**
 * POST /api/sessions/[id]/cancel
 *
 * Aborts the agent's current processing for a session.
 * - Calls cancelProcessing() on the session manager
 * - Returns { ok: true } always (idempotent)
 */

import { cancelProcessing } from "@/lib/session-manager";

// ============================================================================
// ENDPOINT
// ============================================================================

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/sessions/[id]/cancel">
) {
  const { id } = await ctx.params;
  cancelProcessing(id);
  return Response.json({ ok: true });
}
