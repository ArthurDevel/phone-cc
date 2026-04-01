"use client";

/**
 * Hook that checks for available updates on mount, with a 1-hour localStorage cache.
 *
 * - Fetches GET /api/update when the cache is stale or missing
 * - Caches the result in localStorage to avoid repeated API calls
 * - Supports per-update dismissal (keyed by remote commit SHA)
 * - Fails silently -- returns null on any error
 */

import { useState, useEffect, useCallback } from "react";
import type { RemoteStatus } from "@/types/update";

// ============================================================================
// CONSTANTS
// ============================================================================

const CACHE_TTL_MS = 3_600_000; // 1 hour
const CACHE_KEY = "phonecc:update-check";
const DISMISSED_KEY = "phonecc:update-dismissed";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result returned by useUpdateCheck when an update is available and not dismissed.
 *
 * @property commitsBehind - Number of commits the local version is behind
 * @property currentCommit - Current local commit SHA
 * @property remoteCommit - Remote commit SHA
 * @property dismiss - Callback to dismiss the banner for this remote commit
 */
export interface UpdateCheckResult {
  commitsBehind: number;
  currentCommit: string;
  remoteCommit: string;
  dismiss: () => void;
}

interface CachedCheck {
  checkedAt: number;
  status: RemoteStatus;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Reads the cached update check from localStorage.
 * @returns The cached check if fresh, or null if stale/missing/corrupt
 */
function readFreshCache(): RemoteStatus | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const cached: CachedCheck = JSON.parse(raw);
    if (Date.now() - cached.checkedAt < CACHE_TTL_MS) {
      return cached.status;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Writes the update check result to localStorage with the current timestamp.
 * @param status - The RemoteStatus to cache
 */
function writeCache(status: RemoteStatus): void {
  try {
    const cached: CachedCheck = { checkedAt: Date.now(), status };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  } catch {
    // localStorage unavailable -- ignore
  }
}

/**
 * Reads the dismissed remote commit SHA from localStorage.
 * @returns The dismissed SHA, or null if none
 */
function readDismissedSha(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/**
 * Writes the dismissed remote commit SHA to localStorage.
 * @param sha - The remote commit SHA to dismiss
 */
function writeDismissedSha(sha: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, sha);
  } catch {
    // localStorage unavailable -- ignore
  }
}

// ============================================================================
// MAIN HOOK
// ============================================================================

/**
 * Checks for available updates on mount, using a 1-hour localStorage cache.
 * Returns update info when behind and not dismissed, null otherwise.
 *
 * @returns UpdateCheckResult if an update is available and not dismissed, null otherwise
 */
export function useUpdateCheck(): UpdateCheckResult | null {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [dismissedSha, setDismissedSha] = useState<string | null>(() =>
    readDismissedSha()
  );

  // Fetch or read cached status on mount
  useEffect(() => {
    let cancelled = false;

    async function check(): Promise<void> {
      // Try cache first
      const cached = readFreshCache();
      if (cached) {
        if (!cancelled) setStatus(cached);
        return;
      }

      // Cache stale or missing -- fetch from API
      try {
        const response = await fetch("/api/update");
        if (!response.ok) return;

        const data: RemoteStatus = await response.json();
        writeCache(data);
        if (!cancelled) setStatus(data);
      } catch {
        // Network error -- fail silently
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, []);

  // Dismiss callback -- writes to localStorage AND updates state for re-render
  const dismiss = useCallback(() => {
    if (!status?.remoteCommit) return;
    writeDismissedSha(status.remoteCommit);
    setDismissedSha(status.remoteCommit);
  }, [status?.remoteCommit]);

  // Return null if no status, up-to-date, or dismissed
  if (!status) return null;
  if (status.upToDate) return null;
  if (status.remoteCommit === dismissedSha) return null;

  return {
    commitsBehind: status.commitsBehind,
    currentCommit: status.currentCommit,
    remoteCommit: status.remoteCommit,
    dismiss,
  };
}
