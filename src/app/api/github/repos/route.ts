/**
 * GET /api/github/repos
 * Fetches the authenticated user's GitHub repositories using a personal access token.
 */
export async function GET() {
  const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (!token) {
    return Response.json(
      { error: "GITHUB_PERSONAL_ACCESS_TOKEN not set in .env.local" },
      { status: 500 }
    );
  }

  try {
    const repos: Array<{ name: string; html_url: string; default_branch: string }> = [];
    let page = 1;

    // Paginate through all repos
    while (true) {
      const res = await fetch(
        `https://api.github.com/user/repos?per_page=100&sort=updated&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
          },
        }
      );

      if (!res.ok) {
        const body = await res.text();
        return Response.json(
          { error: `GitHub API error: ${res.status} ${body}` },
          { status: res.status }
        );
      }

      const data = (await res.json()) as Array<{
        name: string;
        full_name: string;
        html_url: string;
        default_branch: string;
        private: boolean;
      }>;

      if (data.length === 0) break;

      for (const repo of data) {
        repos.push({
          name: repo.full_name,
          html_url: repo.html_url,
          default_branch: repo.default_branch,
        });
      }

      if (data.length < 100) break;
      page++;
    }

    return Response.json({ repos });
  } catch (err) {
    return Response.json(
      { error: `Failed to fetch repos: ${err}` },
      { status: 500 }
    );
  }
}
