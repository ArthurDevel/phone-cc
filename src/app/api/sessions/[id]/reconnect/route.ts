import { reconnectSession } from "@/lib/session-manager";

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/sessions/[id]/reconnect">
) {
  const { id } = await ctx.params;
  const session = await reconnectSession(id);

  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  return Response.json(session);
}
