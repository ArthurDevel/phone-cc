"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/types/project";

interface GitHubRepo {
  name: string;
  html_url: string;
  default_branch: string;
}

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

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then((data) => setProjects(data.projects))
      .finally(() => setLoading(false));
  }, []);

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
