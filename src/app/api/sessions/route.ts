import { createSession, listSessions } from "@/lib/session-manager";

export async function GET() {
  const sessions = await listSessions();
  return Response.json({ sessions });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { projectId } = body;

  if (typeof projectId !== "string" || !projectId.trim()) {
    return Response.json(
      { error: "projectId is required" },
      { status: 400 }
    );
  }

  try {
    const session = await createSession(projectId.trim());
    return Response.json(session, { status: 201 });
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode || 500;
    const message =
      err instanceof Error ? err.message : "Failed to create session";
    return Response.json({ error: message }, { status: statusCode });
  }
}
