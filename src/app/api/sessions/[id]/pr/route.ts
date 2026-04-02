/**
 * GET /api/sessions/[id]/pr
 *
 * Fetches the most recent pull request for a session's branch from GitHub.
 *
 * Responsibilities:
 * - Reads session metadata to get repoUrl and branchName
 * - Queries GitHub REST API for PRs on that branch
 * - Returns { pr: PullRequest } or { pr: null }
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import type { PullRequest } from "@/types/pr";

// ============================================================================
// CONSTANTS
// ============================================================================

const SESSION_METADATA_DIR = path.join(os.homedir(), ".phonecc", "session-metadata");

// ============================================================================
// ENDPOINT
// ============================================================================

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/sessions/[id]/pr">
) {
  const { id } = await ctx.params;
  const metaDir = path.join(SESSION_METADATA_DIR, id);

  // Read session metadata
  let metadata: { repoUrl: string; branchName: string };
  try {
    const raw = await fs.readFile(path.join(metaDir, "session.json"), "utf-8");
    metadata = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const parsed = parseGitHubUrl(metadata.repoUrl);
  if (!parsed) {
    return Response.json({ pr: null });
  }

  const pat = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (!pat) {
    return Response.json({ error: "GITHUB_PERSONAL_ACCESS_TOKEN not configured" }, { status: 502 });
  }

  try {
    const pr = await fetchPullRequest(parsed.owner, parsed.repo, metadata.branchName, pat);
    return Response.json({ pr });
  } catch (err) {
    const message = err instanceof Error ? err.message : "GitHub API error";
    return Response.json({ error: message }, { status: 502 });
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parses a GitHub URL to extract owner and repo name.
 * @param url - GitHub repository URL (e.g. https://github.com/owner/repo)
 * @returns { owner, repo } or null if not a valid GitHub URL
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Fetches the most recent PR for a branch from GitHub's REST API.
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param branch - Branch name to look for
 * @param pat - GitHub personal access token
 * @returns PullRequest or null if no PR exists
 */
async function fetchPullRequest(
  owner: string,
  repo: string,
  branch: string,
  pat: string
): Promise<PullRequest | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=all&per_page=1`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status}`);
  }

  const pulls = await res.json();
  if (!Array.isArray(pulls) || pulls.length === 0) {
    return null;
  }

  const pr = pulls[0];
  return {
    number: pr.number,
    title: pr.title,
    state: pr.merged_at ? "merged" : pr.state,
    url: pr.html_url,
    createdAt: pr.created_at,
    headBranch: pr.head?.ref || branch,
    baseBranch: pr.base?.ref || "main",
  };
}
