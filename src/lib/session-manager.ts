import fs from "fs/promises";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { EventEmitter } from "events";
import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { readProjects } from "@/lib/projects";
import { CITIES } from "@/lib/cities";
import type { Session, SessionMetadata } from "@/types/session";
import type { Message, ToolUse } from "@/types/message";

const execFileAsync = promisify(execFile);

const SESSIONS_DIR = path.join(os.homedir(), ".phonecc", "sessions");
const MAX_SESSIONS = 5;

interface AgentEntry {
  sdkSessionId: string;
  cwd: string;
  emitter: EventEmitter;
  processing: boolean;
  messages: Message[];
  currentQuery: Query | null;
  currentAbort: AbortController | null;
}

const agents = new Map<string, AgentEntry>();

// ---------------------------------------------------------------------------
// SDK session history reader
// ---------------------------------------------------------------------------

/**
 * Reads the SDK's JSONL session file and converts it to our Message[] format.
 * The SDK stores sessions at ~/.claude/projects/{encoded-path}/{session-id}.jsonl
 */
async function loadMessagesFromSdk(cwd: string, sdkSessionId: string): Promise<Message[]> {
  if (!sdkSessionId) return [];

  // The SDK encodes the cwd path: / becomes - , leading - is kept
  const encodedPath = "-" + cwd.replace(/\//g, "-");
  const jsonlPath = path.join(
    os.homedir(),
    ".claude",
    "projects",
    encodedPath,
    `${sdkSessionId}.jsonl`
  );

  let data: string;
  try {
    data = await fs.readFile(jsonlPath, "utf-8");
  } catch {
    return [];
  }

  const messages: Message[] = [];
  let currentAssistant: Message | null = null;

  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "user" && entry.message) {
      const msg = entry.message as { role: string; content: unknown };
      if (msg.role !== "user") continue;

      // Extract text from user messages (skip tool_result messages)
      const content = msg.content;
      if (typeof content === "string") {
        messages.push({
          id: (entry.uuid as string) || crypto.randomUUID(),
          role: "user",
          content,
          toolUses: [],
          timestamp: new Date((entry.timestamp as string) || Date.now()).getTime(),
        });
        currentAssistant = null;
      } else if (Array.isArray(content)) {
        // Check if this is a user text message or a tool_result
        const textBlocks = (content as Array<{ type: string; text?: string }>).filter(
          (b) => b.type === "text" && b.text
        );
        const toolResults = (content as Array<{ type: string; tool_use_id?: string; content?: unknown }>).filter(
          (b) => b.type === "tool_result"
        );

        if (textBlocks.length > 0 && toolResults.length === 0) {
          messages.push({
            id: (entry.uuid as string) || crypto.randomUUID(),
            role: "user",
            content: textBlocks.map((b) => b.text).join(""),
            toolUses: [],
            timestamp: new Date((entry.timestamp as string) || Date.now()).getTime(),
          });
          currentAssistant = null;
        }

        // Attach tool results to the current assistant message
        if (toolResults.length > 0 && currentAssistant) {
          for (const tr of toolResults) {
            const toolUse = currentAssistant.toolUses.find(
              (t) => t.id === tr.tool_use_id
            );
            if (toolUse) {
              let output = "";
              if (typeof tr.content === "string") {
                output = tr.content;
              } else if (Array.isArray(tr.content)) {
                output = (tr.content as Array<{ type: string; text?: string }>)
                  .map((c) => (c.type === "text" ? c.text || "" : ""))
                  .join("");
              }
              toolUse.output = output;
              toolUse.status = (tr as { is_error?: boolean }).is_error ? "failed" : "completed";
            }
          }
        }
      }
    }

    if (entry.type === "assistant" && entry.message) {
      const msg = entry.message as {
        role: string;
        content: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }>;
      };
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;

      if (!currentAssistant) {
        currentAssistant = {
          id: (entry.uuid as string) || crypto.randomUUID(),
          role: "assistant",
          content: "",
          toolUses: [],
          timestamp: new Date((entry.timestamp as string) || Date.now()).getTime(),
        };
        messages.push(currentAssistant);
      }

      for (const block of msg.content) {
        if (block.type === "text" && block.text) {
          currentAssistant.content += block.text;
        } else if (block.type === "tool_use" && block.id && block.name) {
          // Only add if not already present (SDK emits multiple assistant entries for same turn)
          if (!currentAssistant.toolUses.find((t) => t.id === block.id)) {
            currentAssistant.toolUses.push({
              id: block.id,
              toolName: block.name,
              input: (block.input as Record<string, unknown>) || {},
              output: "",
              status: "running",
            });
          }
        }
      }
    }

    // result type marks end of a turn
    if (entry.type === "result") {
      currentAssistant = null;
    }
  }

  return messages;
}

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

  const shuffled = [...CITIES].sort(() => Math.random() - 0.5);

  for (const city of shuffled) {
    if (!localNames.has(city) && !remoteBranches.has(city)) {
      return city;
    }
  }

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

function ensureAgent(sessionId: string, cwd: string, sdkSessionId?: string, existingMessages?: Message[]): AgentEntry {
  let entry = agents.get(sessionId);
  if (!entry) {
    entry = {
      sdkSessionId: sdkSessionId || "",
      cwd,
      emitter: new EventEmitter(),
      processing: false,
      messages: existingMessages || [],
      currentQuery: null,
      currentAbort: null,
    };
    entry.emitter.setMaxListeners(20);
    agents.set(sessionId, entry);
  }
  return entry;
}

export async function sendMessage(sessionId: string, text: string): Promise<void> {
  const entry = agents.get(sessionId);
  if (!entry) throw new Error("Session not active");

  // Add user message
  const userMsg: Message = {
    id: crypto.randomUUID(),
    role: "user",
    content: text,
    toolUses: [],
    timestamp: Date.now(),
  };
  entry.messages.push(userMsg);
  entry.emitter.emit("sse", "user_message", { message: userMsg });

  entry.processing = true;
  entry.emitter.emit("sse", "status_change", { status: "thinking" });

  const abortController = new AbortController();
  entry.currentAbort = abortController;

  const q = query({
    prompt: text,
    options: {
      cwd: entry.cwd,
      abortController,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      resume: entry.sdkSessionId || undefined,
      includePartialMessages: true,
    },
  });
  entry.currentQuery = q;

  let currentAssistantMsg: Message | null = null;

  try {
    for await (const message of q) {
      if (message.type === "system" && message.subtype === "init") {
        entry.sdkSessionId = message.session_id;
        await writeSdkSessionId(entry.cwd, message.session_id);
        continue;
      }

      if (message.type === "stream_event") {
        const event = message.event;

        if (event.type === "content_block_start") {
          if (!currentAssistantMsg) {
            currentAssistantMsg = {
              id: crypto.randomUUID(),
              role: "assistant",
              content: "",
              toolUses: [],
              timestamp: Date.now(),
            };
            entry.messages.push(currentAssistantMsg);
          }

          if (event.content_block.type === "tool_use") {
            const toolUse: ToolUse = {
              id: event.content_block.id,
              toolName: event.content_block.name,
              input: {},
              output: "",
              status: "running",
            };
            currentAssistantMsg.toolUses.push(toolUse);
            entry.emitter.emit("sse", "tool_use_start", {
              id: toolUse.id,
              toolName: toolUse.toolName,
              toolInput: {},
            });
          }
        }

        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta" && currentAssistantMsg) {
            currentAssistantMsg.content += event.delta.text;
            entry.emitter.emit("sse", "text_delta", { text: event.delta.text });
          }
          if (event.delta.type === "input_json_delta" && currentAssistantMsg) {
            // Tool input arrives as JSON deltas — we'll get the full input from the assistant message
          }
        }

        continue;
      }

      if (message.type === "assistant" && currentAssistantMsg) {
        // Extract complete tool inputs from the full message
        const content = message.message.content;
        for (const block of content) {
          if (block.type === "tool_use") {
            const toolUse = currentAssistantMsg.toolUses.find(
              (t) => t.id === block.id
            );
            if (toolUse) {
              toolUse.input = block.input as Record<string, unknown>;
            }
          }
        }
      }

      if (message.type === "user" && currentAssistantMsg) {
        // Tool results come in user messages
        const userContent = message.message.content;
        if (Array.isArray(userContent)) {
          for (const block of userContent) {
            if (
              typeof block === "object" &&
              block !== null &&
              "type" in block &&
              block.type === "tool_result"
            ) {
              const resultBlock = block as {
                type: "tool_result";
                tool_use_id: string;
                content?: string | Array<{ type: string; text?: string }>;
                is_error?: boolean;
              };
              const toolUse = currentAssistantMsg.toolUses.find(
                (t) => t.id === resultBlock.tool_use_id
              );
              if (toolUse) {
                let output = "";
                if (typeof resultBlock.content === "string") {
                  output = resultBlock.content;
                } else if (Array.isArray(resultBlock.content)) {
                  output = resultBlock.content
                    .map((c) => (c.type === "text" ? c.text || "" : ""))
                    .join("");
                }
                toolUse.output = output;
                toolUse.status = resultBlock.is_error ? "failed" : "completed";
                entry.emitter.emit("sse", "tool_use_result", {
                  id: toolUse.id,
                  toolName: toolUse.toolName,
                  output,
                  status: toolUse.status,
                });
              }
            }
          }
        }
      }

      if (message.type === "result") {
        entry.emitter.emit("sse", "message_end", {});
        currentAssistantMsg = null;
        break;
      }
    }
  } catch {
    if (!abortController.signal.aborted) {
      entry.emitter.emit("sse", "status_change", { status: "error" });
    }
    entry.processing = false;
    entry.currentQuery = null;
    entry.currentAbort = null;
    return;
  }

  entry.processing = false;
  entry.currentQuery = null;
  entry.currentAbort = null;
  entry.emitter.emit("sse", "status_change", { status: "idle" });
}

export function getEventEmitter(sessionId: string): EventEmitter | null {
  return agents.get(sessionId)?.emitter || null;
}

export function getMessageHistory(sessionId: string): Message[] | null {
  const entry = agents.get(sessionId);
  if (!entry) return null;
  return entry.messages;
}

export function isProcessing(sessionId: string): boolean {
  return agents.get(sessionId)?.processing || false;
}

export function cancelProcessing(sessionId: string): void {
  const entry = agents.get(sessionId);
  if (entry?.currentAbort) {
    entry.currentAbort.abort();
  }
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
    await execFileAsync("git", [
      "clone",
      "--branch",
      project.defaultBranch,
      cloneUrl,
      sessionDir,
    ]);

    await execFileAsync("git", ["checkout", "-b", branchName], {
      cwd: sessionDir,
    });

    await execFileAsync("git", ["push", "-u", "origin", branchName], {
      cwd: sessionDir,
    });
  } catch (err) {
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

  ensureAgent(branchName, sessionDir);

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
    return null;
  }

  if (!confirmed) {
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
      // proceed with deletion
    }
  }

  const agent = agents.get(id);
  if (agent) {
    if (agent.currentAbort) agent.currentAbort.abort();
    if (agent.currentQuery) agent.currentQuery.close();
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

  if (agents.has(id)) {
    return { ...metadata, status: "active" };
  }

  const sdkSessionId = await readSdkSessionId(sessionDir);
  const messages = await loadMessagesFromSdk(sessionDir, sdkSessionId || "");
  ensureAgent(id, sessionDir, sdkSessionId, messages);

  return { ...metadata, status: "active" };
}

export function getAgent(sessionId: string): AgentEntry | undefined {
  return agents.get(sessionId);
}
