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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSession, type RuntimeStatus } from "@/contexts/session-context";
import { renderMarkdown } from "@/lib/markdown";
import { PrCard } from "@/components/pr-card";
import type { Message, ToolUse } from "@/types/message";
import type { PullRequest } from "@/types/pr";
import { uuid } from "@/lib/uuid";

// ============================================================================
// CONSTANTS
// ============================================================================

const AUTO_SCROLL_THRESHOLD = 100;
async function getDeepgramWsUrl(): Promise<string> {
  const res = await fetch("/api/voice");
  if (!res.ok) throw new Error("Deepgram WS server not running");
  const { wsUrl } = await res.json();
  return wsUrl;
}
const PR_URL_PATTERN = /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;

/** Resolves relative /preview/ paths to full URLs using the current origin */
function resolvePreviewUrls(content: string): string {
  return content.replace(
    /\/preview\/([a-f0-9-]{36})(\/[^\s)"'>]*)?/g,
    `${window.location.origin}/preview/$1$2`
  );
}

// ============================================================================
// EVENT HANDLERS / HOOKS
// ============================================================================

const MAX_RECONNECT_DELAY = 30_000;

/**
 * Manages SSE connection and message state for a session.
 * Includes exponential backoff reconnection on SSE errors.
 * @param sessionId - The active session ID (or null)
 * @param onStatusChange - Callback to propagate status changes to the context
 * @returns messages, status, reconnecting flag, failedMessageId, sendMessage, and retrySend
 */
function useChatStream(
  sessionId: string | null,
  onStatusChange?: (id: string, status: RuntimeStatus) => void
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<"idle" | "thinking" | "error">("idle");
  const [reconnecting, setReconnecting] = useState(false);
  const [failedMessageId, setFailedMessageId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryDelayRef = useRef(1000);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when sessionId changes (render-time, not in effect)
  const [prevSessionId, setPrevSessionId] = useState(sessionId);
  if (sessionId !== prevSessionId) {
    setPrevSessionId(sessionId);
    if (!sessionId) {
      setMessages([]);
      setStatus("idle");
      setReconnecting(false);
      setLoadingHistory(false);
    } else {
      setLoadingHistory(true);
    }
  }

  // Load history and connect SSE when session changes
  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    retryDelayRef.current = 1000;

    // Fetch existing message history
    fetch(`/api/sessions/${sessionId}/history`)
      .then((res) => (res.ok ? res.json() : { messages: [] }))
      .then((data) => {
        if (!cancelled) {
          const msgs = (data.messages || []).map((m: Message) =>
            m.role === "assistant" && m.content
              ? { ...m, content: resolvePreviewUrls(m.content) }
              : m
          );
          setMessages(msgs);
        }
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    /** Connects (or reconnects) to the SSE stream */
    function connectSse() {
      if (cancelled) return;

      const es = new EventSource(`/api/sessions/${sessionId}/stream`);
      eventSourceRef.current = es;

      es.onopen = () => {
        retryDelayRef.current = 1000;
        if (!cancelled) setReconnecting(false);
      };

      es.onerror = () => {
        if (cancelled) return;
        es.close();
        eventSourceRef.current = null;
        setReconnecting(true);

        // Re-fetch history on reconnect to catch missed messages
        fetch(`/api/sessions/${sessionId}/history`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (!cancelled && data?.messages) {
              const msgs = data.messages.map((m: Message) =>
                m.role === "assistant" && m.content
                  ? { ...m, content: resolvePreviewUrls(m.content) }
                  : m
              );
              setMessages(msgs);
            }
          })
          .catch(() => {});

        // Exponential backoff retry
        const delay = retryDelayRef.current;
        retryDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
        retryTimerRef.current = setTimeout(connectSse, delay);
      };

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
          if (last && last.role === "assistant") {
            updated[updated.length - 1] = {
              ...last,
              content: last.content + data.text,
            };
          } else {
            updated.push({
              id: uuid(),
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
              id: uuid(),
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

      es.addEventListener("message_end", (e) => {
        if (cancelled) return;
        // Replace streamed content with the final rewritten version (preview URLs)
        const data = JSON.parse(e.data);
        console.log("[message_end] received data:", JSON.stringify(data).slice(0, 300));
        console.log("[message_end] data.content is null?", data.content == null, "type:", typeof data.content);
        if (data.content != null) {
          const resolved = resolvePreviewUrls(data.content);
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === "assistant") {
              updated[updated.length - 1] = { ...last, content: resolved };
            }
            return updated;
          });
        }
        setStatus("idle");
        if (sessionId && onStatusChange) onStatusChange(sessionId, "idle");
      });

      es.addEventListener("status_change", (e) => {
        if (cancelled) return;
        const data = JSON.parse(e.data);
        setStatus(data.status);
        if (sessionId && onStatusChange) onStatusChange(sessionId, data.status);
      });
    }

    connectSse();

    return () => {
      cancelled = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (eventSourceRef.current) eventSourceRef.current.close();
      eventSourceRef.current = null;
    };
  }, [sessionId, onStatusChange]);

  /** Sends a message to the active session, tracks failures */
  const sendMessage = useCallback(
    async (text: string) => {
      if (!sessionId) return;
      setFailedMessageId(null);
      try {
        const res = await fetch(`/api/sessions/${sessionId}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          // Find the user message we just added and mark it failed
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "user") setFailedMessageId(last.id);
            return prev;
          });
        }
      } catch {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "user") setFailedMessageId(last.id);
          return prev;
        });
      }
    },
    [sessionId]
  );

  /** Retries sending the failed message */
  const retrySend = useCallback(
    (messageId: string) => {
      const msg = messages.find((m) => m.id === messageId);
      if (msg && msg.role === "user") {
        setFailedMessageId(null);
        sendMessage(msg.content);
      }
    },
    [messages, sendMessage]
  );

  return { messages, status, reconnecting, failedMessageId, loadingHistory, sendMessage, retrySend };
}

/**
 * Manages push-to-talk voice input via Deepgram WebSocket proxy.
 * @param sessionId - The active session ID (or null)
 * @param status - Current agent status (idle/thinking/error)
 * @param onTranscript - Callback when a final transcript is ready to send
 * @returns recording state, interim text, and pointer event handlers
 */
function useVoiceInput(
  sessionId: string | null,
  status: "idle" | "thinking" | "error",
  onTranscript: (text: string) => void
) {
  const [recording, setRecording] = useState(false);
  const [interimText, setInterimText] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const completedTurnsRef = useRef<string[]>([]);
  const currentTurnRef = useRef("");
  const stoppingRef = useRef(false);
  const sentRef = useRef(false);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Returns the full accumulated transcript (completed turns + current in-progress turn) */
  const getFullTranscript = () => {
    const parts = [...completedTurnsRef.current];
    if (currentTurnRef.current.trim()) parts.push(currentTurnRef.current.trim());
    return parts.join(" ");
  };

  /** Fully tears down WS, audio context, and mic */
  const teardown = useCallback(() => {
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) wsRef.current.close();
      wsRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    stoppingRef.current = false;
    completedTurnsRef.current = [];
    currentTurnRef.current = "";
    setRecording(false);
    setInterimText("");
  }, []);

  /** Stops recording: kills audio, waits briefly for Deepgram EndOfTurn, then sends whatever we have */
  const stopRecording = useCallback(() => {
    console.log("[voice] stopRecording called");

    // Stop sending audio immediately
    if (workletRef.current) {
      workletRef.current.disconnect();
      workletRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }

    // If WS is open, wait up to 3s for Deepgram to send EndOfTurn
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      stoppingRef.current = true;
      sentRef.current = false;
      stopTimeoutRef.current = setTimeout(() => {
        if (sentRef.current) return;
        sentRef.current = true;
        console.log("[voice] EndOfTurn timeout, sending accumulated text");
        const text = getFullTranscript();
        if (text) onTranscript(text);
        teardown();
      }, 3000);
    } else {
      teardown();
    }

    setRecording(false);
  }, [onTranscript, teardown]);

  /** Starts recording: gets mic, opens WebSocket, streams audio */
  const startRecording = useCallback(async () => {
    console.log("[voice] startRecording called, sessionId:", sessionId, "status:", status);
    if (!sessionId) {
      console.log("[voice] no sessionId, aborting");
      return;
    }

    try {
      console.log("[voice] requesting mic access");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("[voice] mic access granted");
      mediaStreamRef.current = stream;

      const wsUrl = await getDeepgramWsUrl();
      console.log("[voice] opening WS to", wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      setInterimText("");
      setRecording(true);

      ws.onopen = async () => {
        console.log("[voice] WS opened");

        // Use AudioContext + AudioWorklet to capture raw linear16 PCM at 16kHz
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        audioCtxRef.current = audioCtx;

        // Register the PCM worklet processor inline via a Blob URL
        const processorCode = `
          class PcmProcessor extends AudioWorkletProcessor {
            process(inputs) {
              const input = inputs[0];
              if (input.length > 0) {
                const float32 = input[0];
                // Convert float32 [-1,1] to int16 linear16
                const int16 = new Int16Array(float32.length);
                for (let i = 0; i < float32.length; i++) {
                  const s = Math.max(-1, Math.min(1, float32[i]));
                  int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
                }
                this.port.postMessage(int16.buffer, [int16.buffer]);
              }
              return true;
            }
          }
          registerProcessor("pcm-processor", PcmProcessor);
        `;
        const blob = new Blob([processorCode], { type: "application/javascript" });
        const blobUrl = URL.createObjectURL(blob);

        await audioCtx.audioWorklet.addModule(blobUrl);
        URL.revokeObjectURL(blobUrl);

        const source = audioCtx.createMediaStreamSource(stream);
        const worklet = new AudioWorkletNode(audioCtx, "pcm-processor");
        workletRef.current = worklet;

        // Send raw PCM chunks to WebSocket
        worklet.port.onmessage = (e: MessageEvent) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(e.data);
          }
        };

        source.connect(worklet);
        worklet.connect(audioCtx.destination);
        console.log("[voice] AudioWorklet started (linear16, 16kHz)");
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          console.log("[voice] WS message:", data.type, data.event || "", data.text?.slice(0, 50) || "");

          if (data.type === "transcript") {
            // Update the current in-progress turn
            if (data.text) {
              currentTurnRef.current = data.text;
            }
            // Always show full accumulated text as preview
            setInterimText(getFullTranscript());

            if (data.speech_final) {
              // Turn finished — archive it and reset current
              if (data.text) {
                completedTurnsRef.current.push(data.text.trim());
                currentTurnRef.current = "";
              }

              // If user already released the button, send everything now
              if (stoppingRef.current && !sentRef.current) {
                sentRef.current = true;
                const text = getFullTranscript();
                console.log("[voice] EndOfTurn + button released, sending:", text);
                if (text) onTranscript(text);
                setInterimText("");
                teardown();
              }
            }
          } else if (data.type === "error") {
            console.error("[voice] error from server:", data.message);
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onerror = (err) => {
        console.error("[voice] WS error:", err);
        stopRecording();
      };

      ws.onclose = (e) => {
        console.log("[voice] WS closed, code:", e.code, "reason:", e.reason);
      };
    } catch (err) {
      console.error("[voice] startRecording failed:", err);
      setRecording(false);
    }
  }, [sessionId, status, onTranscript, stopRecording, teardown]);

  const handlePointerDown = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(50);
    startRecording();
  }, [startRecording]);

  const handlePointerUp = useCallback(() => {
    stopRecording();
  }, [stopRecording]);

  return {
    recording,
    interimText,
    handlePointerDown,
    handlePointerUp,
  };
}

// ============================================================================
// COMPONENTS
// ============================================================================

/**
 * User message bubble - right-aligned with accent background.
 * Shows "Failed to send" + Retry button if send failed.
 */
function UserBubble({
  message,
  failed,
  onRetry,
}: {
  message: Message;
  failed?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-end animate-message-in">
      <div className="bg-accent text-white rounded-2xl rounded-br-sm max-w-[80%] px-4 py-2 text-sm">
        {message.content}
      </div>
      {failed && (
        <div className="flex items-center gap-2 mt-1 text-xs">
          <span className="text-danger">Failed to send</span>
          <button onClick={onRetry} className="text-accent hover:underline">
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Assistant message bubble - left-aligned with surface background.
 * Renders markdown content, tool use rows, and detected PR cards.
 * @param message - The assistant message to render
 * @param onToolClick - Callback when a tool use row is clicked
 * @param sessionId - Active session ID for PR fetching
 */
function AssistantBubble({
  message,
  onToolClick,
  sessionId,
}: {
  message: Message;
  onToolClick: (toolUse: ToolUse) => void;
  sessionId: string | null;
}) {
  const hasPrUrl = PR_URL_PATTERN.test(message.content);
  const pr = usePrDetection(sessionId, hasPrUrl);

  return (
    <div className="flex justify-start animate-message-in">
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
        {pr && <PrCard pr={pr} />}
      </div>
    </div>
  );
}

/**
 * Fetches PR info when a PR URL is detected in a message.
 * @param sessionId - Session ID to query
 * @param hasPrUrl - Whether the message content contains a PR URL
 * @returns PullRequest or null
 */
function usePrDetection(sessionId: string | null, hasPrUrl: boolean): PullRequest | null {
  const [pr, setPr] = useState<PullRequest | null>(null);
  const [prevKey, setPrevKey] = useState(`${sessionId}:${hasPrUrl}`);
  const key = `${sessionId}:${hasPrUrl}`;
  if (key !== prevKey) {
    setPrevKey(key);
    if (!sessionId || !hasPrUrl) setPr(null);
  }

  useEffect(() => {
    if (!sessionId || !hasPrUrl) return;

    fetch(`/api/sessions/${sessionId}/pr`)
      .then((res) => (res.ok ? res.json() : { pr: null }))
      .then((data) => setPr(data.pr || null))
      .catch(() => setPr(null));
  }, [sessionId, hasPrUrl]);

  return pr;
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
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto animate-modal-in">
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

/** Error card shown when the agent crashes or disconnects */
function ErrorCard({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-sm">
      <p className="text-danger font-medium">Agent disconnected unexpectedly</p>
      <button
        onClick={onReconnect}
        className="mt-2 px-3 py-1 rounded bg-danger/20 text-danger text-xs hover:bg-danger/30"
      >
        Reconnect
      </button>
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
  const { activeSessionId, setSessionStatus } = useSession();
  const { messages, status, reconnecting, failedMessageId, loadingHistory, sendMessage, retrySend } =
    useChatStream(activeSessionId, setSessionStatus);

  const [inputText, setInputText] = useState("");
  const [toolModal, setToolModal] = useState<ToolUse | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const { recording, interimText, handlePointerDown, handlePointerUp } =
    useVoiceInput(activeSessionId, status, sendMessage);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 96) + "px"; // max 4 lines ~96px
  }, [inputText]);

  // visualViewport API: keep input above mobile keyboard
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const handleResize = () => {
      const offset = window.innerHeight - vv.height - vv.offsetTop;
      setKeyboardHeight(Math.max(0, offset));
    };

    vv.addEventListener("resize", handleResize);
    vv.addEventListener("scroll", handleResize);
    return () => {
      vv.removeEventListener("resize", handleResize);
      vv.removeEventListener("scroll", handleResize);
    };
  }, []);

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
    if (navigator.vibrate) navigator.vibrate(30);
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
        className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3"
      >
        {loadingHistory ? (
          <div className="flex items-center justify-center h-full">
            <SpinnerIcon />
          </div>
        ) : messages.length === 0 && status !== "thinking" ? (
          <EmptyState />
        ) : (
          <>
            {messages.map((msg) =>
              msg.role === "user" ? (
                <UserBubble
                  key={msg.id}
                  message={msg}
                  failed={msg.id === failedMessageId}
                  onRetry={() => retrySend(msg.id)}
                />
              ) : (
                <AssistantBubble
                  key={msg.id}
                  message={msg}
                  onToolClick={setToolModal}
                  sessionId={activeSessionId}
                />
              )
            )}
            {reconnecting && (
              <div className="text-center text-muted text-xs italic py-2">
                Reconnecting...
              </div>
            )}
            {status === "error" && (
              <ErrorCard
                onReconnect={async () => {
                  if (!activeSessionId) return;
                  await fetch(`/api/sessions/${activeSessionId}/reconnect`, { method: "POST" });
                }}
              />
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
      <div
        className="relative flex items-end gap-2 px-4 py-3 border-t border-border shrink-0"
        style={keyboardHeight > 0 ? { paddingBottom: keyboardHeight + 12 } : undefined}
      >
        {/* Live transcript preview */}
        {interimText && (
          <div className="absolute bottom-full left-0 right-0 px-4 py-2 text-sm text-muted italic bg-background/90 border-t border-border">
            {interimText}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          className="flex-1 min-h-[40px] max-h-24 px-3 py-2 rounded-lg bg-surface border border-border text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent resize-none"
        />

        {/* Send button (visible when text is entered) */}
        {inputText.trim() ? (
          <button
            onClick={handleSend}
            className="w-10 h-10 rounded-full bg-accent flex items-center justify-center shrink-0 hover:bg-accent-hover transition-colors"
            aria-label="Send message"
          >
            <SendIcon />
          </button>
        ) : null}

        {/* Mic button (push-to-talk) */}
        <button
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={recording ? handlePointerUp : undefined}
          className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 transition-transform transition-colors relative active:scale-95 ${
            recording
              ? "bg-danger"
              : "bg-accent hover:bg-accent-hover"
          }`}
          aria-label="Push to talk"
        >
          {/* Pulsing ring animation when recording */}
          {recording && (
            <span className="absolute inset-0 rounded-full bg-danger animate-ping opacity-30" />
          )}
          <MicIcon />
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
