import { removeProject } from "@/lib/projects";

export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/projects/[id]">
) {
  const { id } = await ctx.params;
  const removed = await removeProject(id);

  if (!removed) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  return Response.json({ success: true });
}
