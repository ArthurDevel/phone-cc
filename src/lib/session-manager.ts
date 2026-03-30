import fs from "fs/promises";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { readProjects } from "@/lib/projects";
import { CITIES } from "@/lib/cities";
import type { Session, SessionMetadata } from "@/types/session";

const execFileAsync = promisify(execFile);

const SESSIONS_DIR = path.join(os.homedir(), ".phonecc", "sessions");
const MAX_SESSIONS = 5;

interface AgentEntry {
  query: Query;
  abortController: AbortController;
  sdkSessionId: string;
}

// In-memory agent map — lost on server restart, recovered via reconnect
const agents = new Map<string, AgentEntry>();

async function ensureSessionsDir() {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

async function readSessionMetadata(
  sessionDir: string
): Promise<SessionMetadata | null> {
  try {
    const data = await fs.readFile(
      path.join(sessionDir, "session.json"),
      "utf-8"
    );
    return JSON.parse(data) as SessionMetadata;
  } catch {
    return null;
  }
}

async function getLocalSessionNames(): Promise<string[]> {
  try {
    const entries = await fs.readdir(SESSIONS_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function getRemoteBranches(repoUrl: string): Promise<Set<string>> {
  try {
    const pat = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    const authUrl = pat
      ? repoUrl.replace("https://", `https://${pat}@`)
      : repoUrl;
    const { stdout } = await execFileAsync("git", [
      "ls-remote",
      "--heads",
      authUrl,
    ]);
    const branches = new Set<string>();
    for (const line of stdout.split("\n")) {
      const match = line.match(/refs\/heads\/(.+)$/);
      if (match) branches.add(match[1]);
    }
    return branches;
  } catch {
    return new Set();
  }
}

async function generateBranchName(repoUrl: string): Promise<string> {
  const localNames = new Set(await getLocalSessionNames());
  const remoteBranches = await getRemoteBranches(repoUrl);

  // Shuffle cities for randomness
  const shuffled = [...CITIES].sort(() => Math.random() - 0.5);

  for (const city of shuffled) {
    if (!localNames.has(city) && !remoteBranches.has(city)) {
      return city;
    }
  }

  // All cities taken — append suffix
  for (const city of shuffled) {
    for (let i = 2; i <= 100; i++) {
      const name = `${city}-${i}`;
      if (!localNames.has(name) && !remoteBranches.has(name)) {
        return name;
      }
    }
  }

  throw new Error("Could not generate a unique branch name");
}

function buildCloneUrl(repoUrl: string): string {
  const pat = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (!pat) return repoUrl;
  // Convert https://github.com/user/repo to https://PAT@github.com/user/repo.git
  let url = repoUrl;
  if (!url.endsWith(".git")) url += ".git";
  return url.replace("https://", `https://${pat}@`);
}

async function readSdkSessionId(sessionDir: string): Promise<string | undefined> {
  try {
    return (await fs.readFile(path.join(sessionDir, ".sdk-session-id"), "utf-8")).trim();
  } catch {
    return undefined;
  }
}

async function writeSdkSessionId(sessionDir: string, id: string) {
  await fs.writeFile(path.join(sessionDir, ".sdk-session-id"), id, "utf-8");
}

function spawnAgent(
  sessionId: string,
  cwd: string,
  resumeSessionId?: string
): void {
  const abortController = new AbortController();
  const q = query({
    prompt: "You are a coding agent. Wait for user instructions.",
    options: {
      cwd,
      abortController,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      resume: resumeSessionId,
      includePartialMessages: true,
      maxTurns: 1,
    },
  });

  const entry: AgentEntry = {
    query: q,
    abortController,
    sdkSessionId: resumeSessionId || "",
  };
  agents.set(sessionId, entry);

  // Consume the generator in background to capture session ID
  (async () => {
    try {
      for await (const message of q) {
        if (message.type === "system" && message.subtype === "init") {
          entry.sdkSessionId = message.session_id;
          await writeSdkSessionId(cwd, message.session_id);
        }
        if (message.type === "result") {
          break;
        }
      }
    } catch {
      // Agent process ended
    }
  })();
}

export async function createSession(projectId: string): Promise<Session> {
  const projects = await readProjects();
  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    throw Object.assign(new Error("Project not found"), { statusCode: 404 });
  }

  await ensureSessionsDir();
  const localNames = await getLocalSessionNames();
  if (localNames.length >= MAX_SESSIONS) {
    throw Object.assign(
      new Error("Maximum 5 sessions reached. Close a session to start a new one."),
      { statusCode: 409 }
    );
  }

  const branchName = await generateBranchName(project.repoUrl);
  const sessionDir = path.join(SESSIONS_DIR, branchName);
  const cloneUrl = buildCloneUrl(project.repoUrl);

  try {
    // Clone
    await execFileAsync("git", [
      "clone",
      "--branch",
      project.defaultBranch,
      cloneUrl,
      sessionDir,
    ]);

    // Create branch
    await execFileAsync("git", ["checkout", "-b", branchName], {
      cwd: sessionDir,
    });
  } catch (err) {
    // Clean up on failure
    await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => {});
    const message =
      err instanceof Error ? err.message : "Failed to clone repository";
    throw Object.assign(new Error(`Failed to clone repository: ${message}`), {
      statusCode: 500,
    });
  }

  const metadata: SessionMetadata = {
    id: branchName,
    branchName,
    projectName: project.name,
    repoUrl: project.repoUrl,
    createdAt: new Date().toISOString(),
  };

  await fs.writeFile(
    path.join(sessionDir, "session.json"),
    JSON.stringify(metadata, null, 2),
    "utf-8"
  );

  spawnAgent(branchName, sessionDir);

  return { ...metadata, status: "active" };
}

export async function listSessions(): Promise<Session[]> {
  await ensureSessionsDir();
  const names = await getLocalSessionNames();
  const sessions: Session[] = [];

  for (const name of names) {
    const sessionDir = path.join(SESSIONS_DIR, name);
    const metadata = await readSessionMetadata(sessionDir);
    if (!metadata) continue;

    sessions.push({
      ...metadata,
      status: agents.has(name) ? "active" : "disconnected",
    });
  }

  sessions.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return sessions;
}

export async function closeSession(
  id: string,
  confirmed: boolean
): Promise<{
  deleted: boolean;
  requiresConfirmation?: boolean;
  warning?: string;
  count?: number;
  commits?: string[];
} | null> {
  const sessionDir = path.join(SESSIONS_DIR, id);
  try {
    await fs.access(sessionDir);
  } catch {
    return null; // not found
  }

  if (!confirmed) {
    // Check for unpushed commits
    try {
      const metadata = await readSessionMetadata(sessionDir);
      const branchName = metadata?.branchName || id;
      const { stdout } = await execFileAsync(
        "git",
        ["log", `origin/${branchName}..HEAD`, "--oneline"],
        { cwd: sessionDir }
      );
      const lines = stdout.trim().split("\n").filter(Boolean);
      if (lines.length > 0) {
        return {
          deleted: false,
          requiresConfirmation: true,
          warning: "unpushed_commits",
          count: lines.length,
          commits: lines,
        };
      }
    } catch {
      // If git log fails (no remote tracking), proceed with deletion
    }
  }

  // Kill agent if running
  const agent = agents.get(id);
  if (agent) {
    agent.abortController.abort();
    agent.query.close();
    agents.delete(id);
  }

  await fs.rm(sessionDir, { recursive: true, force: true });
  return { deleted: true };
}

export async function reconnectSession(id: string): Promise<Session | null> {
  const sessionDir = path.join(SESSIONS_DIR, id);
  try {
    await fs.access(sessionDir);
  } catch {
    return null;
  }

  const metadata = await readSessionMetadata(sessionDir);
  if (!metadata) return null;

  // Already active
  if (agents.has(id)) {
    return { ...metadata, status: "active" };
  }

  const sdkSessionId = await readSdkSessionId(sessionDir);
  spawnAgent(id, sessionDir, sdkSessionId);

  return { ...metadata, status: "active" };
}

export function getAgent(sessionId: string): AgentEntry | undefined {
  return agents.get(sessionId);
}
