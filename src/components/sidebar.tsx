"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/contexts/session-context";
import { useToast } from "@/contexts/toast-context";
import type { Project } from "@/types/project";

export function Sidebar() {
  const {
    sessions,
    activeSessionId,
    unreadSessions,
    statusMap,
    sidebarOpen,
    loading,
    setSidebarOpen,
    switchSession,
    addSession,
    removeSession,
  } = useSession();

  const { addToast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [creating, setCreating] = useState(false);

  // Fetch projects when sidebar opens or on initial mount (desktop has sidebar always visible)
  useEffect(() => {
    if (sidebarOpen || window.matchMedia("(min-width: 768px)").matches) {
      fetch("/api/projects")
        .then((r) => r.json())
        .then((d) => setProjects(d.projects))
        .catch(() => {});
    }
  }, [sidebarOpen]);

  const handleNewSession = useCallback(() => {
    if (sessions.length >= 5 || projects.length === 0) return;
    setShowProjectPicker(true);
  }, [sessions.length, projects.length]);

  const handlePickProject = useCallback(
    async (projectId: string) => {
      setCreating(true);
      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
        });
        if (res.ok) {
          const session = await res.json();
          addSession(session);
          setSidebarOpen(false);
          setShowProjectPicker(false);
        } else {
          const data = await res.json().catch(() => ({ error: "Unknown error" }));
          if (res.status === 409) {
            addToast("Maximum 5 sessions reached. Close a session to start a new one.", "warning");
          } else {
            addToast(data.error || "Failed to create session", "error");
          }
        }
      } catch {
        addToast("Network error creating session", "error");
      } finally {
        setCreating(false);
      }
    },
    [addSession, setSidebarOpen, addToast]
  );

  const handleCloseSession = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      const data = await res.json();

      if (data.requiresConfirmation) {
        const confirmed = window.confirm(
          `This session has ${data.count} unpushed commit(s). Are you sure you want to close it?`
        );
        if (!confirmed) return;
        const res2 = await fetch(`/api/sessions/${id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: true }),
        });
        if (!res2.ok) return;
      }

      removeSession(id);
    },
    [removeSession]
  );

  const handleRowClick = useCallback(
    (id: string) => {
      switchSession(id);
      setSidebarOpen(false);
    },
    [switchSession, setSidebarOpen]
  );

  const newSessionDisabled = sessions.length >= 5 || projects.length === 0;

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-200 md:relative md:inset-auto md:opacity-100 md:pointer-events-auto md:z-auto ${
        sidebarOpen
          ? "opacity-100 pointer-events-auto"
          : "opacity-0 pointer-events-none"
      }`}
    >
      {/* Backdrop (mobile only) */}
      <div
        className="absolute inset-0 bg-black/50 md:hidden"
        onClick={() => {
          setSidebarOpen(false);
          setShowProjectPicker(false);
        }}
      />

      {/* Panel */}
      <div
        className={`relative w-72 h-full bg-surface flex flex-col transition-transform duration-200 ease-out md:translate-x-0 md:border-r md:border-border md:shrink-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-12 px-4 border-b border-border shrink-0">
          <span className="text-sm font-semibold">PhoneCC</span>
          <button
            onClick={() => {
              setSidebarOpen(false);
              setShowProjectPicker(false);
            }}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-hover"
            aria-label="Close menu"
          >
            <XIcon />
          </button>
        </div>

        {/* New Session Button */}
        <div className="px-4 pt-4 pb-2">
          {!showProjectPicker ? (
            <>
              <button
                onClick={handleNewSession}
                disabled={newSessionDisabled}
                className="w-full h-9 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                + New Session
              </button>
              {sessions.length >= 5 && (
                <p className="text-xs text-muted mt-1.5 text-center">
                  Max 5 sessions. Close one to start new.
                </p>
              )}
              {projects.length === 0 && sessions.length < 5 && (
                <p className="text-xs text-muted mt-1.5 text-center">
                  Link a project in Settings first.
                </p>
              )}
            </>
          ) : (
            <div className="space-y-1">
              <p className="text-xs text-muted mb-2">Select a project:</p>
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handlePickProject(p.id)}
                  disabled={creating}
                  className="w-full text-left px-3 py-2 rounded-lg bg-background hover:bg-surface-hover text-sm disabled:opacity-50 transition-colors"
                >
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted truncate">{p.repoUrl}</div>
                </button>
              ))}
              <button
                onClick={() => setShowProjectPicker(false)}
                className="w-full text-center text-xs text-muted mt-1 py-1"
              >
                Cancel
              </button>
              {creating && (
                <p className="text-xs text-accent text-center mt-1">
                  Creating session...
                </p>
              )}
            </div>
          )}
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {loading ? (
            <div className="space-y-2">
              <div className="animate-skeleton h-12 w-full" />
              <div className="animate-skeleton h-12 w-full" />
              <div className="animate-skeleton h-12 w-full" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-xs text-muted text-center py-4">
              No active sessions
            </p>
          ) : (
            <div className="space-y-1">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  onClick={() => handleRowClick(session.id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                    session.id === activeSessionId
                      ? "bg-background"
                      : "hover:bg-surface-hover"
                  }`}
                >
                  {/* Status dot */}
                  <div
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      getStatusDotClass(statusMap[session.id], session.status)
                    }`}
                  />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {session.branchName}
                    </div>
                    <div className="text-xs text-muted truncate">
                      {session.projectName}
                    </div>
                  </div>

                  {/* Unread dot + Close button */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {unreadSessions.has(session.id) &&
                      session.id !== activeSessionId && (
                        <div className="w-2 h-2 rounded-full bg-danger" />
                      )}
                    <button
                      onClick={(e) => handleCloseSession(session.id, e)}
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-background text-muted hover:text-danger transition-colors"
                      aria-label={`Close ${session.branchName}`}
                    >
                      <XSmallIcon />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Divider + Settings */}
        <div className="border-t border-border px-4 py-3 shrink-0">
          <Link
            href="/settings"
            onClick={() => setSidebarOpen(false)}
            className="flex items-center gap-2 text-sm text-muted hover:text-foreground transition-colors"
          >
            <GearIcon />
            Settings
          </Link>
        </div>
      </div>
    </div>
  );
}

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function XSmallIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}

/**
 * Returns the CSS class for a session's status dot.
 * @param runtimeStatus - The runtime status from statusMap (if tracked)
 * @param sessionStatus - The session's base status (active/disconnected)
 */
function getStatusDotClass(
  runtimeStatus: string | undefined,
  sessionStatus: string
): string {
  if (sessionStatus === "disconnected" && !runtimeStatus) return "bg-muted";

  switch (runtimeStatus) {
    case "thinking":
      return "bg-warning animate-pulse";
    case "error":
      return "bg-danger";
    case "idle":
      return "bg-success";
    default:
      return sessionStatus === "active" ? "bg-success" : "bg-muted";
  }
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M6.5 1.5h3l.5 2 1.5.87 2-.5 1.5 2.6-1.5 1.5v1.96l1.5 1.5-1.5 2.6-2-.5-1.5.87-.5 2h-3l-.5-2-1.5-.87-2 .5-1.5-2.6 1.5-1.5V6.97l-1.5-1.5 1.5-2.6 2 .5 1.5-.87z" />
    </svg>
  );
}
