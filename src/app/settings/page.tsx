"use client";

/**
 * Settings page for PhoneCC.
 *
 * - Manage linked GitHub projects (add/remove)
 * - Check for and apply system updates via the updater service
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/types/project";
import type { RemoteStatus } from "@/types/update";

// ============================================================================
// CONSTANTS
// ============================================================================

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

// ============================================================================
// TYPES
// ============================================================================

interface GitHubRepo {
  name: string;
  html_url: string;
  default_branch: string;
}

interface UpdateStep {
  step: string;
  status: string;
  message: string;
}

type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "update-available"
  | "updating"
  | "restarting"
  | "error";

export default function SettingsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // GitHub repos
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [reposFetched, setReposFetched] = useState(false);
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);

  // App settings
  const [enableCloudMcp, setEnableCloudMcp] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);

  // System update
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [updateInfo, setUpdateInfo] = useState<RemoteStatus | null>(null);
  const [updateLog, setUpdateLog] = useState<UpdateStep[]>([]);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then((data) => setProjects(data.projects))
      .finally(() => setLoading(false));

    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        setEnableCloudMcp(data.enableCloudMcpServers ?? false);
      })
      .finally(() => setSettingsLoading(false));
  }, []);

  async function toggleCloudMcp() {
    const newValue = !enableCloudMcp;
    setEnableCloudMcp(newValue);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enableCloudMcpServers: newValue }),
    });
  }

  async function fetchRepos() {
    setReposLoading(true);
    setReposError(null);
    try {
      const res = await fetch("/api/github/repos");
      const data = await res.json();
      if (!res.ok) {
        setReposError(data.error || "Failed to fetch repos");
        return;
      }
      setRepos(data.repos);
      setReposFetched(true);
    } catch {
      setReposError("Failed to fetch repos");
    } finally {
      setReposLoading(false);
    }
  }

  async function handleLinkRepo(repo: GitHubRepo) {
    setSubmitting(repo.html_url);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: repo.name.split("/").pop() || repo.name,
          repoUrl: repo.html_url,
          defaultBranch: repo.default_branch,
        }),
      });
      if (res.ok) {
        const project = await res.json();
        setProjects((prev) => [project, ...prev]);
      }
    } finally {
      setSubmitting(null);
    }
  }

  async function handleDelete(id: string, projectName: string) {
    if (!window.confirm(`Delete "${projectName}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (res.ok) {
      setProjects((prev) => prev.filter((p) => p.id !== id));
    }
  }

  // ============================================================================
  // UPDATE HANDLERS
  // ============================================================================

  /**
   * Check whether a newer version is available by calling GET /api/update.
   * Sets updateStatus to "up-to-date" or "update-available".
   * A 409 means an update is already running.
   */
  async function handleCheckUpdate(): Promise<void> {
    setUpdateStatus("checking");
    setUpdateError(null);
    setUpdateInfo(null);
    setUpdateLog([]);

    try {
      const res = await fetch("/api/update");

      if (res.status === 409) {
        setUpdateStatus("updating");
        return;
      }

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data: RemoteStatus = await res.json();
      setUpdateInfo(data);
      setUpdateStatus(data.upToDate ? "up-to-date" : "update-available");
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : "Failed to check for updates");
      setUpdateStatus("error");
    }
  }

  /**
   * Trigger the update by calling POST /api/update.
   * Reads the NDJSON stream line by line to populate updateLog.
   * When the stream ends, switches to "restarting" and starts polling.
   */
  async function handleStartUpdate(): Promise<void> {
    setUpdateStatus("updating");
    setUpdateError(null);
    setUpdateLog([]);

    try {
      const res = await fetch("/api/update", { method: "POST" });

      if (res.status === 409) {
        setUpdateError("An update is already in progress");
        setUpdateStatus("error");
        return;
      }

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let hadError = false;

      // Read NDJSON stream line by line
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const step: UpdateStep = JSON.parse(line);
          setUpdateLog((prev) => {
            // Replace existing entry for same step, or append
            const idx = prev.findIndex((s) => s.step === step.step);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = step;
              return updated;
            }
            return [...prev, step];
          });

          if (step.status === "error") {
            hadError = true;
          }
        }
      }

      if (hadError) {
        setUpdateError("Update failed -- check the log above");
        setUpdateStatus("error");
        return;
      }

      // Stream ended normally -- server is restarting
      setUpdateStatus("restarting");
      pollUntilBack();
    } catch {
      // Connection dropped -- expected when the server restarts
      setUpdateStatus("restarting");
      pollUntilBack();
    }
  }

  /**
   * Poll GET /api/update every 2s until the server responds.
   * On success, reloads the page. After 120s, shows an error.
   */
  function pollUntilBack(): void {
    const startTime = Date.now();

    // Clear any existing poll timer
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    pollTimerRef.current = setInterval(async () => {
      // Timeout after 120 seconds
      if (Date.now() - startTime > POLL_TIMEOUT_MS) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        setUpdateError("Server did not come back. SSH in to investigate.");
        setUpdateStatus("error");
        return;
      }

      try {
        const res = await fetch("/api/update");
        if (res.ok) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          window.location.reload();
        }
      } catch {
        // Server still down -- keep polling
      }
    }, POLL_INTERVAL_MS);
  }

  // Filter repos: exclude already-linked ones and apply search
  const linkedUrls = new Set(projects.map((p) => p.repoUrl));
  const filteredRepos = repos.filter((r) => {
    if (linkedUrls.has(r.html_url)) return false;
    if (search.trim()) {
      return r.name.toLowerCase().includes(search.toLowerCase());
    }
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center h-12 px-4 border-b border-border shrink-0">
        <button
          onClick={() => router.push("/")}
          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-hover"
          aria-label="Go back"
        >
          <ChevronLeftIcon />
        </button>
        <span className="flex-1 text-center text-sm font-medium">Settings</span>
        <div className="w-8" />
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Agent Settings */}
        <h2 className="text-xs uppercase tracking-wider text-muted mb-3">
          Agent
        </h2>

        <div className="bg-surface rounded-lg p-3 mb-6">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <div className="text-sm font-medium">
                Enable{" "}
                <a
                  href="https://claude.ai/integrations"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  claude.ai integrations
                </a>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enableCloudMcp}
              disabled={settingsLoading}
              onClick={toggleCloudMcp}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
                enableCloudMcp ? "bg-accent" : "bg-border"
              } ${settingsLoading ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <span
                className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transform transition-transform duration-200 mt-0.5 ${
                  enableCloudMcp ? "translate-x-[22px]" : "translate-x-0.5"
                }`}
              />
            </button>
          </label>
        </div>

        {/* Linked Projects */}
        <h2 className="text-xs uppercase tracking-wider text-muted mb-3">
          Linked Projects
        </h2>

        {loading ? (
          <div className="space-y-2">
            <div className="animate-skeleton h-16 w-full" />
            <div className="animate-skeleton h-16 w-full" />
          </div>
        ) : projects.length === 0 ? (
          <div className="text-muted text-sm text-center py-6">
            No projects linked yet.
          </div>
        ) : (
          <div className="space-y-2 mb-6">
            {projects.map((project) => (
              <div
                key={project.id}
                className="bg-surface rounded-lg p-3 flex items-start gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{project.name}</div>
                  <div className="text-xs text-muted truncate">
                    {project.repoUrl}
                  </div>
                  <span className="inline-block mt-1 bg-accent/20 text-accent text-xs px-2 py-0.5 rounded-full">
                    {project.defaultBranch}
                  </span>
                </div>
                <button
                  onClick={() => handleDelete(project.id, project.name)}
                  className="text-danger hover:text-danger/80 shrink-0 mt-0.5"
                  aria-label={`Delete ${project.name}`}
                >
                  <XIcon />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add from GitHub */}
        <h2 className="text-xs uppercase tracking-wider text-muted mb-3 mt-6">
          Add from GitHub
        </h2>

        {!reposFetched ? (
          <button
            onClick={fetchRepos}
            disabled={reposLoading}
            className="w-full h-10 px-4 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {reposLoading ? "Fetching..." : "Fetch my repositories"}
          </button>
        ) : (
          <>
            <input
              type="text"
              placeholder="Search repos..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-surface border border-border text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent mb-3"
            />
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {filteredRepos.length === 0 ? (
                <div className="text-muted text-sm text-center py-4">
                  {search ? "No matching repos" : "All repos already linked"}
                </div>
              ) : (
                filteredRepos.map((repo) => (
                  <button
                    key={repo.html_url}
                    onClick={() => handleLinkRepo(repo)}
                    disabled={submitting === repo.html_url}
                    className="w-full text-left bg-surface hover:bg-surface-hover rounded-lg p-3 flex items-center gap-3 transition-colors disabled:opacity-50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{repo.name}</div>
                      <div className="text-xs text-muted">{repo.default_branch}</div>
                    </div>
                    <span className="text-xs text-accent shrink-0">
                      {submitting === repo.html_url ? "Adding..." : "Link"}
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}

        {reposError && (
          <div className="text-danger text-sm mt-2">{reposError}</div>
        )}

        {/* System */}
        <h2 className="text-xs uppercase tracking-wider text-muted mb-3 mt-6">
          System
        </h2>

        {/* Idle -- show check button */}
        {updateStatus === "idle" && (
          <button
            onClick={handleCheckUpdate}
            className="w-full h-10 px-4 rounded-lg bg-surface hover:bg-surface-hover border border-border text-sm font-medium transition-colors"
          >
            Check for updates
          </button>
        )}

        {/* Checking */}
        {updateStatus === "checking" && (
          <button
            disabled
            className="w-full h-10 px-4 rounded-lg bg-surface border border-border text-sm font-medium opacity-50 cursor-not-allowed"
          >
            Checking...
          </button>
        )}

        {/* Up to date */}
        {updateStatus === "up-to-date" && updateInfo && (
          <div className="bg-surface rounded-lg p-3">
            <div className="text-sm font-medium text-foreground">Up to date</div>
            <div className="text-xs text-muted mt-1">
              Current commit: {updateInfo.currentCommit.slice(0, 7)}
            </div>
            <button
              onClick={handleCheckUpdate}
              className="mt-2 text-xs text-accent hover:text-accent-hover"
            >
              Check again
            </button>
          </div>
        )}

        {/* Update available */}
        {updateStatus === "update-available" && updateInfo && (
          <div className="bg-surface rounded-lg p-3 space-y-2">
            <div className="text-sm font-medium text-foreground">
              Update available ({updateInfo.commitsBehind} commit{updateInfo.commitsBehind !== 1 ? "s" : ""} behind)
            </div>
            <div className="text-xs text-muted space-y-0.5">
              <div>Current: {updateInfo.currentCommit.slice(0, 7)}</div>
              <div>Remote: {updateInfo.remoteCommit.slice(0, 7)}</div>
            </div>
            <button
              onClick={handleStartUpdate}
              className="w-full h-10 px-4 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
            >
              Update now
            </button>
          </div>
        )}

        {/* Updating -- show log */}
        {updateStatus === "updating" && (
          <div className="bg-surface rounded-lg p-3 space-y-1.5">
            <div className="text-sm font-medium text-foreground mb-2">Updating...</div>
            {updateLog.map((entry) => (
              <div key={entry.step} className="flex items-center gap-2 text-xs">
                <span className={
                  entry.status === "done"
                    ? "text-accent"
                    : entry.status === "error"
                      ? "text-danger"
                      : "text-muted"
                }>
                  {entry.status === "done" ? "done" : entry.status === "error" ? "fail" : "..."}
                </span>
                <span className="text-foreground">{entry.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* Restarting */}
        {updateStatus === "restarting" && (
          <div className="bg-surface rounded-lg p-3">
            <div className="text-sm font-medium text-foreground">Server is restarting...</div>
            <div className="text-xs text-muted mt-1">
              The page will reload automatically when the server is back.
            </div>
          </div>
        )}

        {/* Error */}
        {updateStatus === "error" && (
          <div className="bg-surface rounded-lg p-3 space-y-2">
            {updateLog.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {updateLog.map((entry) => (
                  <div key={entry.step} className="flex items-center gap-2 text-xs">
                    <span className={
                      entry.status === "done"
                        ? "text-accent"
                        : entry.status === "error"
                          ? "text-danger"
                          : "text-muted"
                    }>
                      {entry.status === "done" ? "done" : entry.status === "error" ? "fail" : "..."}
                    </span>
                    <span className="text-foreground">{entry.message}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="text-danger text-sm">{updateError}</div>
            <button
              onClick={() => {
                setUpdateStatus("idle");
                setUpdateError(null);
                setUpdateInfo(null);
                setUpdateLog([]);
              }}
              className="w-full h-10 px-4 rounded-lg bg-surface hover:bg-surface-hover border border-border text-sm font-medium transition-colors"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 4l-6 6 6 6" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
