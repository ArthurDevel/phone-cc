/**
 * ChatView - Main chat interface for interacting with Claude agents.
 *
 * Responsibilities:
 * - Renders message bubbles (user and assistant) with markdown support
 * - Subscribes to SSE stream for real-time message updates
 * - Loads message history on session switch
 * - Shows tool use rows (collapsed) with full-screen detail modal on click
 * - Auto-scrolls to bottom, with a scroll-to-bottom pill when scrolled up
 * - Shows thinking indicator (pulsing dots) while agent is processing
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/contexts/session-context";
import { renderMarkdown } from "@/lib/markdown";
import type { Message, ToolUse } from "@/types/message";

// ============================================================================
// CONSTANTS
// ============================================================================

const AUTO_SCROLL_THRESHOLD = 100;

// ============================================================================
// EVENT HANDLERS / HOOKS
// ============================================================================

/**
 * Manages SSE connection and message state for a session.
 * @param sessionId - The active session ID (or null)
 * @returns messages, status, and sendMessage function
 */
function useChatStream(sessionId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<"idle" | "thinking" | "error">("idle");
  const eventSourceRef = useRef<EventSource | null>(null);

  // Load history and connect SSE when session changes
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setStatus("idle");
      return;
    }

    let cancelled = false;

    // Fetch existing message history
    fetch(`/api/sessions/${sessionId}/history`)
      .then((res) => (res.ok ? res.json() : { messages: [] }))
      .then((data) => {
        if (!cancelled) setMessages(data.messages || []);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });

    // Connect to SSE stream
    const es = new EventSource(`/api/sessions/${sessionId}/stream`);
    eventSourceRef.current = es;

    es.addEventListener("user_message", (e) => {
      if (cancelled) return;
      const data = JSON.parse(e.data);
      setMessages((prev) => [...prev, data.message]);
    });

    es.addEventListener("text_delta", (e) => {
      if (cancelled) return;
      const data = JSON.parse(e.data);
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        // Append text to existing assistant message, or create a new one
        if (last && last.role === "assistant") {
          updated[updated.length - 1] = {
            ...last,
            content: last.content + data.text,
          };
        } else {
          updated.push({
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.text,
            toolUses: [],
            timestamp: Date.now(),
          });
        }
        return updated;
      });
    });

    es.addEventListener("tool_use_start", (e) => {
      if (cancelled) return;
      const data = JSON.parse(e.data);
      setMessages((prev) => {
        const updated = [...prev];
        let last = updated[updated.length - 1];
        if (!last || last.role !== "assistant") {
          last = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "",
            toolUses: [],
            timestamp: Date.now(),
          };
          updated.push(last);
        }
        updated[updated.length - 1] = {
          ...last,
          toolUses: [
            ...last.toolUses,
            {
              id: data.id,
              toolName: data.toolName,
              input: data.toolInput || {},
              output: "",
              status: "running",
            },
          ],
        };
        return updated;
      });
    });

    es.addEventListener("tool_use_result", (e) => {
      if (cancelled) return;
      const data = JSON.parse(e.data);
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === "assistant") {
          updated[updated.length - 1] = {
            ...last,
            toolUses: last.toolUses.map((t) =>
              t.id === data.id
                ? { ...t, output: data.output, status: data.status }
                : t
            ),
          };
        }
        return updated;
      });
    });

    es.addEventListener("message_end", () => {
      if (cancelled) return;
      setStatus("idle");
    });

    es.addEventListener("status_change", (e) => {
      if (cancelled) return;
      const data = JSON.parse(e.data);
      setStatus(data.status);
    });

    return () => {
      cancelled = true;
      es.close();
      eventSourceRef.current = null;
    };
  }, [sessionId]);

  /** Sends a message to the active session */
  const sendMessage = useCallback(
    async (text: string) => {
      if (!sessionId) return;
      await fetch(`/api/sessions/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
    },
    [sessionId]
  );

  return { messages, status, sendMessage };
}

// ============================================================================
// COMPONENTS
// ============================================================================

/** User message bubble - right-aligned with accent background */
function UserBubble({ message }: { message: Message }) {
  return (
    <div className="flex justify-end">
      <div className="bg-accent text-white rounded-2xl rounded-br-sm max-w-[80%] px-4 py-2 text-sm">
        {message.content}
      </div>
    </div>
  );
}

/**
 * Assistant message bubble - left-aligned with surface background.
 * Renders markdown content and tool use rows.
 * @param message - The assistant message to render
 * @param onToolClick - Callback when a tool use row is clicked
 */
function AssistantBubble({
  message,
  onToolClick,
}: {
  message: Message;
  onToolClick: (toolUse: ToolUse) => void;
}) {
  return (
    <div className="flex justify-start">
      <div className="bg-surface text-foreground rounded-2xl rounded-bl-sm max-w-[80%] px-4 py-2 text-sm">
        {message.content && (
          <div
            className="whitespace-pre-wrap break-words"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />
        )}
        {message.toolUses.map((toolUse) => (
          <ToolUseRow
            key={toolUse.id}
            toolUse={toolUse}
            onClick={() => onToolClick(toolUse)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Compact row showing a tool use: icon + name + status badge.
 * Clickable to open the detail modal.
 */
function ToolUseRow({
  toolUse,
  onClick,
}: {
  toolUse: ToolUse;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full bg-background/50 rounded px-3 py-1.5 mt-1 cursor-pointer hover:bg-background text-left text-xs"
    >
      <WrenchIcon />
      <span className="font-medium truncate">{toolUse.toolName}</span>
      <span className="ml-auto shrink-0">
        {toolUse.status === "running" && <SpinnerIcon />}
        {toolUse.status === "completed" && (
          <span className="text-success">completed</span>
        )}
        {toolUse.status === "failed" && (
          <span className="text-danger">failed</span>
        )}
      </span>
    </button>
  );
}

/**
 * Full-screen modal showing tool use input and output.
 * @param toolUse - The tool use to display details for
 * @param onClose - Callback to close the modal
 */
function ToolUseModal({
  toolUse,
  onClose,
}: {
  toolUse: ToolUse;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-bold">{toolUse.toolName}</h2>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-hover"
          aria-label="Close"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Input section */}
        <div>
          <h3 className="text-xs font-medium text-muted mb-1">Input</h3>
          <pre className="bg-surface rounded-lg p-3 overflow-x-auto">
            <code className="font-mono text-xs">
              {JSON.stringify(toolUse.input, null, 2)}
            </code>
          </pre>
        </div>

        {/* Output section */}
        <div>
          <h3 className="text-xs font-medium text-muted mb-1">Output</h3>
          <pre className="bg-surface rounded-lg p-3 overflow-x-auto max-h-[60vh] overflow-y-auto">
            <code className="font-mono text-xs whitespace-pre-wrap break-words">
              {toolUse.output || (toolUse.status === "running" ? "Running..." : "(empty)")}
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}

/** Three pulsing dots indicating the agent is thinking */
function ThinkingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-surface rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1.5">
        <span className="w-2 h-2 bg-muted rounded-full animate-pulse" />
        <span className="w-2 h-2 bg-muted rounded-full animate-pulse [animation-delay:150ms]" />
        <span className="w-2 h-2 bg-muted rounded-full animate-pulse [animation-delay:300ms]" />
      </div>
    </div>
  );
}

/** Empty state when no messages exist */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted text-sm gap-2">
      <MicIconLarge />
      <span>Start a conversation</span>
    </div>
  );
}

// ============================================================================
// ICONS
// ============================================================================

function WrenchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" opacity="0.75" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function MicIconLarge() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
      <rect x="9" y="1" width="6" height="12" rx="3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </svg>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Main chat view component.
 * Renders the message list, handles SSE streaming, and provides message input.
 */
export function ChatView() {
  const { activeSessionId } = useSession();
  const { messages, status, sendMessage } = useChatStream(activeSessionId);

  const [inputText, setInputText] = useState("");
  const [toolModal, setToolModal] = useState<ToolUse | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (isAtBottomRef.current && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, [messages, status]);

  /** Checks whether the user has scrolled away from the bottom */
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom =
      el.scrollTop + el.clientHeight >= el.scrollHeight - AUTO_SCROLL_THRESHOLD;
    isAtBottomRef.current = atBottom;
    setShowScrollButton(!atBottom);
  }, []);

  /** Scrolls to the bottom of the chat */
  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    isAtBottomRef.current = true;
    setShowScrollButton(false);
  }, []);

  /** Sends the current input text as a message */
  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || !activeSessionId) return;
    setInputText("");
    sendMessage(text);
  }, [inputText, activeSessionId, sendMessage]);

  /** Handles Enter key to send message */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // No active session
  if (!activeSessionId) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm">
        Start a session to begin coding
      </div>
    );
  }

  return (
    <>
      {/* Message list */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-3"
      >
        {messages.length === 0 && status !== "thinking" ? (
          <EmptyState />
        ) : (
          <>
            {messages.map((msg) =>
              msg.role === "user" ? (
                <UserBubble key={msg.id} message={msg} />
              ) : (
                <AssistantBubble
                  key={msg.id}
                  message={msg}
                  onToolClick={setToolModal}
                />
              )
            )}
            {status === "thinking" && <ThinkingIndicator />}
          </>
        )}
      </div>

      {/* Scroll-to-bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-surface border border-border rounded-full px-3 py-1.5 text-xs flex items-center gap-1 shadow-lg hover:bg-surface-hover z-10"
        >
          <ArrowDownIcon />
          <span>New messages</span>
        </button>
      )}

      {/* Input bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-border shrink-0">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className="flex-1 h-10 px-3 rounded-lg bg-surface border border-border text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
        />
        <button
          onClick={handleSend}
          disabled={!inputText.trim()}
          className="w-10 h-10 rounded-full bg-accent flex items-center justify-center shrink-0 hover:bg-accent-hover transition-colors disabled:opacity-50"
          aria-label="Send message"
        >
          <SendIcon />
        </button>
      </div>

      {/* Tool use detail modal */}
      {toolModal && (
        <ToolUseModal toolUse={toolModal} onClose={() => setToolModal(null)} />
      )}
    </>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}
