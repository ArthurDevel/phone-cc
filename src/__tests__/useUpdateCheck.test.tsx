// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import type { RemoteStatus } from "@/types/update";

/**
 * Unit tests for useUpdateCheck hook.
 *
 * Covers:
 * - Returning update info when API reports commits behind
 * - Returning null when API reports up-to-date
 * - Using cached result when cache is fresh (< 1 hour)
 * - Re-fetching when cache is stale (> 1 hour)
 * - Returning null on fetch failure
 * - Dismissing the banner for a specific remote commit
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const CACHE_KEY = "phonecc:update-check";
const DISMISSED_KEY = "phonecc:update-dismissed";

const BEHIND_STATUS: RemoteStatus = {
  upToDate: false,
  currentCommit: "aaa111",
  remoteCommit: "bbb222",
  commitsBehind: 3,
};

const UP_TO_DATE_STATUS: RemoteStatus = {
  upToDate: true,
  currentCommit: "aaa111",
  remoteCommit: "aaa111",
  commitsBehind: 0,
};

// ============================================================================
// LOCALSTORAGE MOCK
// ============================================================================

// Node 25 ships a built-in localStorage that lacks Web Storage API methods.
// Override it with a simple in-memory implementation for tests.
const store: Record<string, string> = {};

const localStorageMock: Storage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    for (const key of Object.keys(store)) {
      delete store[key];
    }
  },
  get length() {
    return Object.keys(store).length;
  },
  key: (index: number) => Object.keys(store)[index] ?? null,
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

// ============================================================================
// SETUP
// ============================================================================

beforeEach(() => {
  localStorageMock.clear();
  vi.restoreAllMocks();
});

// ============================================================================
// TESTS
// ============================================================================

describe("useUpdateCheck", () => {
  it("returns update info when API reports commits behind and no cache exists", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(BEHIND_STATUS), { status: 200 })
    );

    const { result } = renderHook(() => useUpdateCheck());

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    expect(result.current!.commitsBehind).toBe(3);
    expect(result.current!.remoteCommit).toBe("bbb222");
    expect(result.current!.currentCommit).toBe("aaa111");
    expect(typeof result.current!.dismiss).toBe("function");
  });

  it("returns null when API reports up-to-date", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(UP_TO_DATE_STATUS), { status: 200 })
    );

    const { result } = renderHook(() => useUpdateCheck());

    // Wait for the effect to settle, then confirm still null
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    expect(result.current).toBeNull();
  });

  it("uses cached result and does NOT call fetch when cache is less than 1 hour old", async () => {
    // Pre-populate localStorage with a fresh cache (checked 5 minutes ago)
    const freshCache = {
      checkedAt: Date.now() - 5 * 60 * 1000,
      status: BEHIND_STATUS,
    };
    localStorageMock.setItem(CACHE_KEY, JSON.stringify(freshCache));

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(BEHIND_STATUS), { status: 200 })
    );

    const { result } = renderHook(() => useUpdateCheck());

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current!.commitsBehind).toBe(3);
  });

  it("calls fetch when cache is older than 1 hour", async () => {
    // Pre-populate localStorage with a stale cache (checked 2 hours ago)
    const staleCache = {
      checkedAt: Date.now() - 2 * 60 * 60 * 1000,
      status: BEHIND_STATUS,
    };
    localStorageMock.setItem(CACHE_KEY, JSON.stringify(staleCache));

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(BEHIND_STATUS), { status: 200 })
    );

    const { result } = renderHook(() => useUpdateCheck());

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns null when fetch fails (network error / 503)", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useUpdateCheck());

    // Wait for the effect to settle
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    expect(result.current).toBeNull();
  });

  it("calling dismiss() hides the banner (hook returns null for the dismissed SHA)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(BEHIND_STATUS), { status: 200 })
    );

    const { result } = renderHook(() => useUpdateCheck());

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    // Dismiss the banner
    act(() => {
      result.current!.dismiss();
    });

    expect(result.current).toBeNull();
    // Verify localStorage was updated
    expect(localStorageMock.getItem(DISMISSED_KEY)).toBe("bbb222");
  });
});
