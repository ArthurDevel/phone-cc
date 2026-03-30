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
  refreshSessions: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [unreadSessions, setUnreadSessions] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId),
    [sessions, activeSessionId]
  );

  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setUnreadSessions((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const addSession = useCallback((session: Session) => {
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
  }, []);

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

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
