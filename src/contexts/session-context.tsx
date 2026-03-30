/**
 * SessionContext - Global state for session management.
 *
 * Responsibilities:
 * - Tracks all sessions, active session, unread notifications, sidebar state
 * - Auto-reconnects disconnected sessions on switch
 * - Persists last active session ID in localStorage
 * - Restores last active session on page reload
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session } from "@/types/session";

// ============================================================================
// CONSTANTS
// ============================================================================

const STORAGE_KEY = "phonecc:lastActiveSessionId";

// ============================================================================
// TYPES
// ============================================================================

interface SessionContextValue {
  sessions: Session[];
  activeSessionId: string | null;
  activeSession: Session | undefined;
  unreadSessions: Set<string>;
  sidebarOpen: boolean;
  loading: boolean;
  setSidebarOpen: (open: boolean) => void;
  switchSession: (id: string) => void;
  addSession: (session: Session) => void;
  removeSession: (id: string) => void;
  refreshSessions: () => Promise<Session[]>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

// ============================================================================
// PROVIDER
// ============================================================================

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [unreadSessions, setUnreadSessions] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  /** Fetches the session list from the API */
  const refreshSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions);
        return data.sessions as Session[];
      }
    } finally {
      setLoading(false);
    }
    return [] as Session[];
  }, []);

  // On mount: fetch sessions and restore last active session from localStorage
  useEffect(() => {
    refreshSessions().then((fetchedSessions) => {
      const lastId = localStorage.getItem(STORAGE_KEY);
      if (lastId && fetchedSessions.some((s: Session) => s.id === lastId)) {
        // Auto-reconnect if disconnected, then switch
        const session = fetchedSessions.find((s: Session) => s.id === lastId);
        if (session?.status === "disconnected") {
          reconnectAndSwitch(lastId);
        } else {
          setActiveSessionId(lastId);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist active session ID to localStorage whenever it changes
  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem(STORAGE_KEY, activeSessionId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [activeSessionId]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId),
    [sessions, activeSessionId]
  );

  /**
   * Reconnects a disconnected session and switches to it.
   * @param id - Session ID to reconnect
   */
  const reconnectAndSwitch = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/sessions/${id}/reconnect`, { method: "POST" });
      if (res.ok) {
        // Update session status to active in state
        setSessions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, status: "active" as const } : s))
        );
      }
    } catch {
      // If reconnect fails, still switch to show whatever state we have
    }
    setActiveSessionId(id);
    setUnreadSessions((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  /**
   * Switches to a session, auto-reconnecting if it's disconnected.
   * @param id - Session ID to switch to
   */
  const switchSession = useCallback(
    (id: string) => {
      const session = sessions.find((s) => s.id === id);
      if (session?.status === "disconnected") {
        reconnectAndSwitch(id);
      } else {
        setActiveSessionId(id);
        setUnreadSessions((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [sessions, reconnectAndSwitch]
  );

  /**
   * Adds a newly created session and switches to it.
   * @param session - The new session to add
   */
  const addSession = useCallback((session: Session) => {
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
  }, []);

  /**
   * Removes a session from the list. Clears active if it was the removed one.
   * @param id - Session ID to remove
   */
  const removeSession = useCallback(
    (id: string) => {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSessionId === id) {
        setActiveSessionId(null);
      }
      setUnreadSessions((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [activeSessionId]
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      sessions,
      activeSessionId,
      activeSession,
      unreadSessions,
      sidebarOpen,
      loading,
      setSidebarOpen,
      switchSession,
      addSession,
      removeSession,
      refreshSessions,
    }),
    [
      sessions,
      activeSessionId,
      activeSession,
      unreadSessions,
      sidebarOpen,
      loading,
      switchSession,
      addSession,
      removeSession,
      refreshSessions,
    ]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

// ============================================================================
// HOOK
// ============================================================================

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
