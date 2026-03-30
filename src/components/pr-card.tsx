/**
 * PrCard - Compact card displaying pull request information.
 *
 * Responsibilities:
 * - Shows PR title, number, and status badge
 * - Links to GitHub PR page
 */

"use client";

import type { PullRequest } from "@/types/pr";

// ============================================================================
// CONSTANTS
// ============================================================================

const STATUS_STYLES: Record<PullRequest["state"], string> = {
  open: "bg-success/20 text-success",
  merged: "bg-purple-500/20 text-purple-400",
  closed: "bg-danger/20 text-danger",
};

const STATUS_LABELS: Record<PullRequest["state"], string> = {
  open: "Open",
  merged: "Merged",
  closed: "Closed",
};

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Renders a compact PR card with title, number, status badge, and GitHub link.
 * @param pr - The pull request data to display
 */
export function PrCard({ pr }: { pr: PullRequest }) {
  return (
    <div className="bg-surface border border-border rounded-lg px-3 py-2 mt-2 text-xs">
      <div className="flex items-center gap-2">
        <GitMergeIcon />
        <span className="font-bold truncate">{pr.title}</span>
        <span className="text-muted shrink-0">#{pr.number}</span>
        <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${STATUS_STYLES[pr.state]}`}>
          {STATUS_LABELS[pr.state]}
        </span>
      </div>
      <a
        href={pr.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent hover:underline mt-1 inline-block"
      >
        View on GitHub
      </a>
    </div>
  );
}

// ============================================================================
// ICONS
// ============================================================================

function GitMergeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  );
}
