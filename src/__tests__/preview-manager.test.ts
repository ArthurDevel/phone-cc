import { describe, it, expect, beforeEach } from "vitest";
import {
  rewriteAgentOutput,
  rewriteUserInput,
  lookupToken,
  cleanupSession,
} from "@/lib/preview-manager";

/**
 * Unit tests for preview-manager.ts
 *
 * Covers:
 * - Token creation and reuse for rewriteAgentOutput
 * - Reverse rewriting for rewriteUserInput
 * - Session cleanup
 * - Session scoping (different sessions get different tokens)
 * - URL variation handling
 */

// ============================================================================
// SETUP
// ============================================================================

beforeEach(() => {
  // Clean up all tokens between tests by cleaning known session IDs
  cleanupSession("session-a");
  cleanupSession("session-b");
  cleanupSession("test-session");
});

// ============================================================================
// rewriteAgentOutput
// ============================================================================

describe("rewriteAgentOutput", () => {
  it("converts localhost:PORT URLs to preview URLs and creates tokens", () => {
    const result = rewriteAgentOutput(
      "session-a",
      "Server running at http://localhost:3002"
    );

    expect(result).toMatch(/^Server running at \/preview\/[a-f0-9-]{36}$/);
    expect(result).not.toContain("localhost");
  });

  it("reuses tokens for the same session+port pair", () => {
    const first = rewriteAgentOutput(
      "session-a",
      "http://localhost:3002"
    );
    const second = rewriteAgentOutput(
      "session-a",
      "http://localhost:3002/other"
    );

    // Extract the token from both results
    const tokenPattern = /\/preview\/([a-f0-9-]{36})/;
    const firstToken = first.match(tokenPattern)?.[1];
    const secondToken = second.match(tokenPattern)?.[1];

    expect(firstToken).toBeTruthy();
    expect(firstToken).toBe(secondToken);
  });

  it("preserves paths in rewritten URLs", () => {
    const result = rewriteAgentOutput(
      "session-a",
      "Open http://localhost:3002/api/health to check"
    );

    expect(result).toMatch(
      /^Open \/preview\/[a-f0-9-]{36}\/api\/health to check$/
    );
  });

  it("rewrites multiple URLs in the same text", () => {
    const result = rewriteAgentOutput(
      "session-a",
      "Frontend at http://localhost:3002 and API at http://localhost:4000/api"
    );

    expect(result).not.toContain("localhost");
    // Should have two different preview tokens (different ports)
    const tokens = [...result.matchAll(/\/preview\/([a-f0-9-]{36})/g)].map(
      (m) => m[1]
    );
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  it("does not modify text without localhost URLs", () => {
    const text = "No URLs here, just regular text.";
    expect(rewriteAgentOutput("session-a", text)).toBe(text);
  });
});

// ============================================================================
// URL VARIATIONS
// ============================================================================

describe("URL variations", () => {
  it.each([
    ["http://localhost:3002", "http:// prefix"],
    ["https://localhost:3002", "https:// prefix"],
    ["localhost:3002", "no protocol"],
    ["http://127.0.0.1:3002", "127.0.0.1"],
    ["http://0.0.0.0:3002", "0.0.0.0"],
  ])("rewrites %s (%s)", (url) => {
    const result = rewriteAgentOutput("session-a", `Visit ${url} now`);
    expect(result).toMatch(/^Visit \/preview\/[a-f0-9-]{36} now$/);
    expect(result).not.toContain("localhost");
    expect(result).not.toContain("127.0.0.1");
    expect(result).not.toContain("0.0.0.0");
  });
});

// ============================================================================
// SESSION SCOPING
// ============================================================================

describe("session scoping", () => {
  it("gives different tokens to different sessions for the same port", () => {
    const resultA = rewriteAgentOutput("session-a", "http://localhost:3002");
    const resultB = rewriteAgentOutput("session-b", "http://localhost:3002");

    const tokenPattern = /\/preview\/([a-f0-9-]{36})/;
    const tokenA = resultA.match(tokenPattern)?.[1];
    const tokenB = resultB.match(tokenPattern)?.[1];

    expect(tokenA).toBeTruthy();
    expect(tokenB).toBeTruthy();
    expect(tokenA).not.toBe(tokenB);
  });
});

// ============================================================================
// rewriteUserInput
// ============================================================================

describe("rewriteUserInput", () => {
  it("converts preview URLs back to localhost:PORT", () => {
    // First create a token by rewriting agent output
    const agentOutput = rewriteAgentOutput(
      "session-a",
      "http://localhost:3002/index.html"
    );
    const token = agentOutput.match(/\/preview\/([a-f0-9-]{36})/)?.[1];
    expect(token).toBeTruthy();

    const userInput = `I see an error at /preview/${token}/index.html`;
    const result = rewriteUserInput(userInput);

    expect(result).toBe("I see an error at http://localhost:3002/index.html");
  });

  it("leaves unknown tokens as-is", () => {
    const text = "/preview/00000000-0000-0000-0000-000000000000/path";
    expect(rewriteUserInput(text)).toBe(text);
  });

  it("rewrites preview URLs without a path", () => {
    rewriteAgentOutput("session-a", "http://localhost:5000");
    const agentOutput = rewriteAgentOutput("session-a", "http://localhost:5000");
    const token = agentOutput.match(/\/preview\/([a-f0-9-]{36})/)?.[1];

    const result = rewriteUserInput(`Check /preview/${token}`);
    expect(result).toBe("Check http://localhost:5000");
  });
});

// ============================================================================
// cleanupSession
// ============================================================================

describe("cleanupSession", () => {
  it("removes all tokens for a given session", () => {
    // Create tokens for two ports in the same session
    rewriteAgentOutput("test-session", "http://localhost:3002");
    rewriteAgentOutput("test-session", "http://localhost:4000");

    // Verify tokens exist via rewriteUserInput
    const agentOutput = rewriteAgentOutput(
      "test-session",
      "http://localhost:3002"
    );
    const token = agentOutput.match(/\/preview\/([a-f0-9-]{36})/)?.[1];
    expect(lookupToken(token!)).toBeDefined();

    // Clean up
    cleanupSession("test-session");

    // Token should no longer resolve
    expect(lookupToken(token!)).toBeUndefined();

    // rewriteUserInput should leave the URL as-is
    const result = rewriteUserInput(`/preview/${token}/path`);
    expect(result).toBe(`/preview/${token}/path`);
  });

  it("does not affect tokens from other sessions", () => {
    rewriteAgentOutput("session-a", "http://localhost:3002");
    rewriteAgentOutput("session-b", "http://localhost:3002");

    const outputB = rewriteAgentOutput("session-b", "http://localhost:3002");
    const tokenB = outputB.match(/\/preview\/([a-f0-9-]{36})/)?.[1];

    // Clean up session-a only
    cleanupSession("session-a");

    // session-b token should still work
    expect(lookupToken(tokenB!)).toBeDefined();
    const result = rewriteUserInput(`/preview/${tokenB}`);
    expect(result).toBe("http://localhost:3002");
  });
});
