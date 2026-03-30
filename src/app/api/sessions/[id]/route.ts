import { closeSession } from "@/lib/session-manager";

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/sessions/[id]">
) {
  const { id } = await ctx.params;

  let confirmed = false;
  try {
    const body = await request.json();
    confirmed = body.confirmed === true;
  } catch {
    // No body or invalid JSON — treat as unconfirmed
  }

  const result = await closeSession(id, confirmed);

  if (result === null) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  return Response.json(result);
}
