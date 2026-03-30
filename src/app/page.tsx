/**
 * PhoneCC - Main app shell
 *
 * Renders the mobile-first layout with:
 * - Top bar: hamburger menu (left) + branch name (center)
 * - Main content area: chat view (placeholder)
 * - Bottom bar: text input + mic button (placeholder)
 */

// ============================================================================
// MAIN LAYOUT
// ============================================================================

export default function Home() {
  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <header className="flex items-center h-12 px-4 border-b border-border shrink-0">
        <button
          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-hover"
          aria-label="Open menu"
        >
          <HamburgerIcon />
        </button>
        <span className="flex-1 text-center text-sm font-medium text-muted truncate">
          No active session
        </span>
        <div className="w-8" />
      </header>

      {/* Chat area */}
      <main className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-center h-full text-muted text-sm">
          Start a session to begin coding
        </div>
      </main>

      {/* Bottom input bar */}
      <footer className="flex items-center gap-2 px-4 py-3 border-t border-border shrink-0">
        <input
          type="text"
          placeholder="Type a message..."
          className="flex-1 h-10 px-3 rounded-lg bg-surface border border-border text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
          disabled
        />
        <button
          className="w-14 h-14 rounded-full bg-accent flex items-center justify-center shrink-0 hover:bg-accent-hover transition-colors"
          aria-label="Push to talk"
          disabled
        >
          <MicIcon />
        </button>
      </footer>
    </div>
  );
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

function MicIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="1" width="6" height="12" rx="3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}
