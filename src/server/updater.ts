/**
 * Standalone HTTP server that handles self-updating the PhoneCC application.
 *
 * - Binds to 127.0.0.1 (localhost only) starting from port 9473
 * - Writes chosen port to .updater-port for discovery by the Next.js app
 * - Provides GET /status to check for available updates
 * - Provides POST /update to run the full update pipeline with NDJSON streaming
 * - Prevents concurrent updates with an in-memory flag
 *
 * Start with: tsx src/server/updater.ts
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "http";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

// ============================================================================
// CONSTANTS
// ============================================================================

const START_PORT = Number(process.env.UPDATER_PORT) || 9473;
const PORT_FILE = path.resolve(process.cwd(), ".updater-port");
const PROJECT_DIR = process.cwd();
const GIT_FETCH_TIMEOUT_MS = 10_000;

// ============================================================================
// TYPES
// ============================================================================

interface UpdateStep {
  step: string;
  status: "running" | "done" | "error";
  message: string;
}

interface RemoteStatus {
  upToDate: boolean;
  currentCommit: string;
  remoteCommit: string;
  commitsBehind: number;
}

interface CommandResult {
  stdout: string;
  exitCode: number;
}

// ============================================================================
// STATE
// ============================================================================

let isUpdating = false;

// ============================================================================
// ENDPOINTS
// ============================================================================

/**
 * GET /status -- Fetches from remote and compares local vs remote HEAD.
 * Returns RemoteStatus JSON. Returns 409 if an update is in progress.
 * @param _req - incoming HTTP request
 * @param res - outgoing HTTP response
 */
async function handleStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (isUpdating) {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Update in progress" }));
    return;
  }

  try {
    const branch = await detectBranch();

    // Fetch remote with timeout
    await runCommand("git", ["fetch", "origin", branch], GIT_FETCH_TIMEOUT_MS);

    // Get local and remote commit hashes
    const { stdout: currentCommit } = await runCommand("git", ["rev-parse", "HEAD"]);
    const { stdout: remoteCommit } = await runCommand("git", ["rev-parse", `origin/${branch}`]);

    // Count how many commits we are behind
    const { stdout: countStr } = await runCommand("git", [
      "rev-list",
      "--count",
      `HEAD..origin/${branch}`,
    ]);
    const commitsBehind = Number(countStr.trim());

    const status: RemoteStatus = {
      upToDate: commitsBehind === 0,
      currentCommit: currentCommit.trim(),
      remoteCommit: remoteCommit.trim(),
      commitsBehind,
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[updater] Status check failed:", message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

/**
 * POST /update -- Runs the full update pipeline with NDJSON streaming.
 * Pipeline: git fetch -> git reset --hard -> pnpm install -> pnpm build -> restart services.
 * Aborts on first failure. Returns 409 if an update is already in progress.
 * @param _req - incoming HTTP request
 * @param res - outgoing HTTP response
 */
async function handleUpdate(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (isUpdating) {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Update already in progress" }));
    return;
  }

  isUpdating = true;
  res.writeHead(200, { "Content-Type": "application/x-ndjson" });

  try {
    const branch = await detectBranch();

    const steps: Array<{ step: string; cmd: string; args: string[] }> = [
      { step: "git_fetch", cmd: "git", args: ["fetch", "origin", branch] },
      { step: "git_reset", cmd: "git", args: ["reset", "--hard", `origin/${branch}`] },
      { step: "pnpm_install", cmd: "pnpm", args: ["install", "--frozen-lockfile"] },
      { step: "pnpm_build", cmd: "pnpm", args: ["build"] },
      { step: "restart", cmd: "sudo", args: ["systemctl", "restart", "phonecc"] },
      { step: "restart_ws", cmd: "sudo", args: ["systemctl", "restart", "phonecc-ws"] },
    ];

    for (const { step, cmd, args } of steps) {
      // Send "running" status
      writeStep(res, { step, status: "running", message: `Running ${step}...` });

      try {
        await runCommand(cmd, args);
        writeStep(res, { step, status: "done", message: `${step} completed` });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeStep(res, { step, status: "error", message });
        // Abort pipeline on first failure
        return;
      }
    }
  } finally {
    isUpdating = false;
    res.end();
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Spawns a child process and captures its stdout. Throws on non-zero exit code.
 * @param cmd - the command to run
 * @param args - arguments to pass to the command
 * @param timeoutMs - optional timeout in milliseconds
 * @returns the captured stdout and exit code
 */
function runCommand(cmd: string, args: string[], timeoutMs?: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;

    const child = spawn(cmd, args, {
      cwd: PROJECT_DIR,
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to run ${cmd}: ${err.message}`));
    });

    child.on("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(
          new Error(`${cmd} ${args.join(" ")} exited with code ${exitCode}: ${stderr.trim()}`)
        );
        return;
      }
      resolve({ stdout, exitCode: exitCode ?? 0 });
    });
  });
}

/**
 * Returns the branch to check for updates against.
 * Always checks against main, regardless of which branch is currently checked out.
 * @returns "main"
 */
function detectBranch(): string {
  return "main";
}

/**
 * Writes an UpdateStep as a single NDJSON line to the response stream.
 * @param res - the HTTP response to write to
 * @param step - the update step to serialize
 */
function writeStep(res: ServerResponse, step: UpdateStep): void {
  console.log(`[updater] ${step.step}: ${step.status} -- ${step.message}`);
  res.write(JSON.stringify(step) + "\n");
}

/**
 * Attempts to bind a server to the given port on 127.0.0.1.
 * Resolves with the port number on success, rejects on EADDRINUSE.
 * @param server - the HTTP server instance
 * @param port - the port number to try
 * @returns the port number that was successfully bound
 */
function tryListen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") reject(err);
      else throw err;
    });
    server.listen(port, "127.0.0.1", () => resolve(port));
  });
}

// ============================================================================
// ENTRY POINT
// ============================================================================

/**
 * Starts the updater HTTP server with port discovery and signal handlers.
 */
async function main(): Promise<void> {
  const httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/status") {
      handleStatus(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/update") {
      handleUpdate(req, res);
      return;
    }

    // Health check for any other route
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  // Find a free port starting from START_PORT
  let port = START_PORT;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await tryListen(httpServer, port);
      break;
    } catch {
      console.log(`[updater] Port ${port} in use, trying ${port + 1}`);
      port++;
    }
  }

  // Write the port so the Next.js API route can discover it
  fs.writeFileSync(PORT_FILE, String(port));
  console.log(`[updater] Updater server listening on 127.0.0.1:${port}`);

  // Clean up port file on exit
  for (const sig of ["SIGINT", "SIGTERM", "exit"] as const) {
    process.on(sig, () => {
      try {
        fs.unlinkSync(PORT_FILE);
      } catch {}
    });
  }
}

main();
