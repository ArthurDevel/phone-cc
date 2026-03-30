"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/types/project";

export default function SettingsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then((data) => setProjects(data.projects))
      .finally(() => setLoading(false));
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !repoUrl.trim() || !defaultBranch.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, repoUrl, defaultBranch }),
      });
      if (res.ok) {
        const project = await res.json();
        setProjects((prev) => [project, ...prev]);
        setName("");
        setRepoUrl("");
        setDefaultBranch("main");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string, projectName: string) {
    if (!window.confirm(`Delete "${projectName}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (res.ok) {
      setProjects((prev) => prev.filter((p) => p.id !== id));
    }
  }

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
        <h2 className="text-xs uppercase tracking-wider text-muted mb-3">
          Linked Projects
        </h2>

        {loading ? (
          <div className="text-muted text-sm text-center py-8">Loading...</div>
        ) : projects.length === 0 ? (
          <div className="text-muted text-sm text-center py-8">
            No projects linked yet. Add one below.
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

        {/* Add Project Form */}
        <h2 className="text-xs uppercase tracking-wider text-muted mb-3 mt-6">
          Add Project
        </h2>
        <form onSubmit={handleAdd} className="space-y-3">
          <input
            type="text"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full h-10 px-3 rounded-lg bg-surface border border-border text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
          />
          <input
            type="text"
            placeholder="Repository URL (https://github.com/user/repo)"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            className="w-full h-10 px-3 rounded-lg bg-surface border border-border text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
          />
          <input
            type="text"
            placeholder="Default branch"
            value={defaultBranch}
            onChange={(e) => setDefaultBranch(e.target.value)}
            className="w-full h-10 px-3 rounded-lg bg-surface border border-border text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={submitting || !name.trim() || !repoUrl.trim()}
            className="w-full h-10 px-4 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Adding..." : "Add"}
          </button>
        </form>
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
