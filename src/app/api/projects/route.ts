import { readProjects, addProject } from "@/lib/projects";

export async function GET() {
  const projects = await readProjects();
  return Response.json({ projects });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { name, repoUrl, defaultBranch } = body;

  if (
    typeof name !== "string" || !name.trim() ||
    typeof repoUrl !== "string" || !repoUrl.trim() ||
    typeof defaultBranch !== "string" || !defaultBranch.trim()
  ) {
    return Response.json(
      { error: "name, repoUrl, and defaultBranch are required" },
      { status: 400 }
    );
  }

  const project = await addProject({
    name: name.trim(),
    repoUrl: repoUrl.trim(),
    defaultBranch: defaultBranch.trim(),
  });

  return Response.json(project, { status: 201 });
}
