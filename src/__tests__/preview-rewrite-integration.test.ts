/**
 * Integration test: verifies that sendMessage in session-manager actually
 * rewrites localhost URLs and delivers the rewritten content in the
 * message_end SSE event.
 *
 * This mocks the Claude SDK's `query` to return a controlled stream,
 * then listens on the real EventEmitter to verify the observable outcome.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "events";
import { cleanupSession } from "@/lib/preview-manager";

// ============================================================================
// MOCK: Claude SDK query function
// ============================================================================

/**
 * Creates an async iterable that yields SDK messages simulating a simple
 * assistant response containing the given text.
 */
async function* fakeQuery(text: string) {
  // 1. init message with a session ID
  yield { type: "system", subtype: "init", session_id: "sdk-session-123" };

  // 2. content_block_start (text block)
  yield {
    type: "stream_event",
    event: {
      type: "content_block_start",
      content_block: { type: "text", text: "" },
    },
  };

  // 3. text deltas
  yield {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text },
    },
  };

  // 4. result
  yield { type: "result" };
}

// Mock the SDK before importing session-manager
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

// Mock fs/projects/cities to avoid real file system access
vi.mock("fs/promises", () => ({
  default: {
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockRejectedValue(new Error("not found")),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockRejectedValue(new Error("not found")),
  },
}));

vi.mock("@/lib/projects", () => ({
  readProjects: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/cities", () => ({
  CITIES: ["test-city"],
}));

// Now import
import { sendMessage, getEventEmitter, getAgent } from "@/lib/session-manager";
import { query } from "@anthropic-ai/claude-agent-sdk";

const mockedQuery = vi.mocked(query);

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Injects a fake agent entry into the agents map so sendMessage can find it.
 * Returns the emitter to listen on.
 */
function injectFakeAgent(sessionId: string): EventEmitter {
  const emitter = new EventEmitter();
  const agents = (globalThis as any).__phonecc_agents as Map<string, any>;
  agents.set(sessionId, {
    sdkSessionId: "sdk-session-123",
    cwd: "/tmp/test",
    emitter,
    processing: false,
    messages: [],
    currentQuery: null,
    currentAbort: null,
  });
  return emitter;
}

// ============================================================================
// SETUP
// ============================================================================

beforeEach(() => {
  cleanupSession("test-session");
  const agents = (globalThis as any).__phonecc_agents as Map<string, any>;
  agents.delete("test-session");
});

// ============================================================================
// TESTS
// ============================================================================

describe("sendMessage rewrites localhost URLs in message_end", () => {
  it("emits message_end with preview URLs, not localhost URLs", async () => {
    const emitter = injectFakeAgent("test-session");
    mockedQuery.mockReturnValue(
      fakeQuery("The dev server is running at http://localhost:3002") as any
    );

    // Collect all SSE events
    const events: Array<{ type: string; data: any }> = [];
    emitter.on("sse", (type: string, data: any) => {
      events.push({ type, data });
    });

    await sendMessage("test-session", "start the server");

    // Find the message_end event
    const messageEnd = events.find((e) => e.type === "message_end");
    expect(messageEnd).toBeDefined();
    expect(messageEnd!.data.content).toBeDefined();
    expect(messageEnd!.data.content).not.toContain("localhost");
    expect(messageEnd!.data.content).toMatch(/\/preview\/[a-f0-9-]{36}/);
    expect(messageEnd!.data.content).toContain(
      "The dev server is running at"
    );
  });

  it("does NOT rewrite text without localhost URLs", async () => {
    const emitter = injectFakeAgent("test-session");
    mockedQuery.mockReturnValue(
      fakeQuery("All done, no servers running.") as any
    );

    const events: Array<{ type: string; data: any }> = [];
    emitter.on("sse", (type: string, data: any) => {
      events.push({ type, data });
    });

    await sendMessage("test-session", "hello");

    const messageEnd = events.find((e) => e.type === "message_end");
    expect(messageEnd).toBeDefined();
    expect(messageEnd!.data.content).toBe("All done, no servers running.");
  });
});
