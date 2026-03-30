"use client";

import { useSession } from "@/contexts/session-context";
import { Sidebar } from "@/components/sidebar";
import { ChatView } from "@/components/chat-view";

export default function Home() {
  const { activeSession, setSidebarOpen } = useSession();

  return (
    <div className="flex flex-col h-full">
      {/* Sidebar */}
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
        <span
          className={`flex-1 text-center text-sm font-medium truncate ${
            activeSession ? "text-foreground" : "text-muted"
          }`}
        >
          {activeSession?.branchName ?? "PhoneCC"}
        </span>
        <div className="w-8" />
      </header>

      {/* Chat area + input bar (managed by ChatView) */}
      <ChatView />
    </div>
  );
}

function HamburgerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 5h14M3 10h14M3 15h14" />
    </svg>
  );
}

