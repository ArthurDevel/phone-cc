/**
 * Home page - Main app layout with top bar, sidebar, and chat view.
 *
 * Responsibilities:
 * - Renders top bar with hamburger, branch name, PR badge, and git action buttons
 * - Renders sidebar and chat view
 * - Polls for PR status on active session
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/contexts/session-context";
import { Sidebar } from "@/components/sidebar";
import { ChatView } from "@/components/chat-view";
import type { PullRequest } from "@/types/pr";

// ============================================================================
// CONSTANTS
// ============================================================================

const PR_POLL_INTERVAL = 60_000;
const PUSH_PROMPT = "Push all committed changes to the remote repository on the current branch. Use git push.";
const PR_PROMPT = "Create a pull request from the current branch to main. Use gh pr create with a descriptive title and body based on the changes made.";

// ============================================================================
// EVENT HANDLERS / HOOKS
// ============================================================================

/**
 * Polls the PR API for the active session and returns the current PR (if any).
 * @param sessionId - The active session ID (or null)
 * @returns The current PullRequest or null
 */
function usePrBadge(sessionId: string | null) {
  const [pr, setPr] = useState<PullRequest | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setPr(null);
      return;
    }

    let cancelled = false;

    const fetchPr = () => {
      fetch(`/api/sessions/${sessionId}/pr`)
        .then((res) => (res.ok ? res.json() : { pr: null }))
        .then((data) => {
          if (!cancelled) setPr(data.pr || null);
        })
        .catch(() => {
          if (!cancelled) setPr(null);
        });
    };

    fetchPr();
    const interval = setInterval(fetchPr, PR_POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId]);

  return pr;
}

// ============================================================================
// RENDER
// ============================================================================

export default function Home() {
  const { activeSession, activeSessionId, statusMap, setSidebarOpen } = useSession();
  const pr = usePrBadge(activeSessionId);
  const sendingRef = useRef(false);

  /** Sends a predefined message to the active session's agent */
  const sendAgentMessage = useCallback(
    async (text: string) => {
      if (!activeSessionId || sendingRef.current) return;
      sendingRef.current = true;
      try {
        await fetch(`/api/sessions/${activeSessionId}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
      } finally {
        sendingRef.current = false;
      }
    },
    [activeSessionId]
  );

  return (
    <div className="flex flex-col h-full">
      <Sidebar />

      {/* Top bar */}
      <header className="flex items-center h-12 px-4 border-b border-border shrink-0">
        <button
          onClick={() => setSidebarOpen(true)}
          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-hover"
          aria-label="Open menu"
        >
          <HamburgerIcon />
        </button>

        {/* Branch name + PR badge */}
        <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
          <span
            className={`text-sm font-medium truncate ${
              getBranchNameColor(activeSessionId ? statusMap[activeSessionId] : undefined, !!activeSession)
            }`}
          >
            {activeSession?.branchName ?? "PhoneCC"}
          </span>
          {pr && (
            <a
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-0.5 rounded-full bg-success/20 text-success text-[10px] font-medium shrink-0 hover:bg-success/30"
            >
              PR #{pr.number}
            </a>
          )}
        </div>

        {/* Git action buttons */}
        {activeSessionId ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => sendAgentMessage(PUSH_PROMPT)}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-hover"
              aria-label="Push changes"
              title="Push changes"
            >
              <PushIcon />
            </button>
            <button
              onClick={() => sendAgentMessage(PR_PROMPT)}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-hover"
              aria-label="Create PR"
              title="Create PR"
            >
              <PrIcon />
            </button>
          </div>
        ) : (
          <div className="w-8" />
        )}
      </header>

      <ChatView />
    </div>
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Returns the text color class for the branch name based on runtime status.
 * @param runtimeStatus - The session's runtime status
 * @param hasSession - Whether a session is active
 */
function getBranchNameColor(runtimeStatus: string | undefined, hasSession: boolean): string {
  if (!hasSession) return "text-muted";

  switch (runtimeStatus) {
    case "thinking":
      return "text-warning";
    case "error":
      return "text-danger";
    case "disconnected":
      return "text-muted";
    default:
      return "text-foreground";
  }
}

// ============================================================================
// ICONS
// ============================================================================

function HamburgerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 5h14M3 10h14M3 15h14" />
    </svg>
  );
}

function PushIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function PrIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  );
}
