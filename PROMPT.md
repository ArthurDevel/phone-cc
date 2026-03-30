# PhoneCC -- Mobile Voice Coding App

You are building a mobile-first web app that lets a single user have voice conversations with Claude Code SDK agents running in parallel sessions. Each session clones a GitHub repo into its own folder, creates a unique branch, and spins up an independent Claude Code agent.

## Tech Stack

- Next.js 16 (app router), React 19, Tailwind CSS 4
- Claude Code SDK (`@anthropic-ai/claude-code`) for backend agent sessions. No API key needed -- the user logs in via `claude` CLI with their Claude Code subscription. The SDK uses that auth automatically.
- Deepgram (Flux model) for speech-to-text, proxied through our backend
- Filesystem-based session storage (no database)
- GitHub API for PR status display

## Key Architecture Decisions

- **No database.** Sessions are folders on disk at `~/.phonecc/sessions/`. Projects config lives at `~/.phonecc/projects.json`.
- **No auth.** Single user, runs locally.
- **Max 5 concurrent sessions.**
- **Branch naming:** random city name, check for duplicates on the remote, append number if needed (e.g. `tokyo`, `tokyo-2`).
- **Git actions (push, create PR) are prompts sent to the Claude Code agent**, not direct API calls. But PR status is fetched via GitHub API to display in the UI.
- **Deepgram Flux** handles voice-to-text. Audio is streamed from the client to our backend via WebSocket, and our backend proxies to Deepgram. The Deepgram API key never touches the client.
- **Push-to-talk while agent is responding cancels the ongoing response.**
- **Tool use** in chat is shown as collapsed blocks. Click opens a modal with input and output. Do not inline tool input/output.
- **Claude Code agent persistence:** conversation history is persisted to disk so sessions survive server restarts. When reconnecting, the agent resumes with full history.
- **Close session safety:** before deleting a session, check for unpushed commits (`git log origin/{branch}..HEAD`). If there are unpushed commits, require confirmation.

## Your Loop

Every iteration you do ONE of two things. Read `PROGRESS.md` to decide which.

### Option A: PLAN the next TODO feature

Pick the first feature with status `TODO`. Create a plan for it in `.docs/plans/` using the `/create_plan` command. The feature description in `PROGRESS.md` is your spec -- follow it closely. Then update `PROGRESS.md`: set status to `PLANNED` and fill in the plan file path.

### Option B: IMPLEMENT a PLANNED feature

Pick the first feature with status `PLANNED`. Implement it using the `/implement_plan` command, following the plan file. Run tests and make sure the build passes. Then update `PROGRESS.md`: set status to `DONE`.

### Decision Logic

1. If any feature has status `PLANNED` --> IMPLEMENT it (Option B)
2. Else if any feature has status `TODO` --> PLAN the next one (Option A)
3. Else all features are `DONE` --> output `<promise>COMPLETE</promise>`

### Verification

Before marking a feature as `DONE`, you MUST verify it works:

- **Always:** run `pnpm build` -- it must pass with zero errors.
- **Backend/API features:** start the dev server (`pnpm dev`), then use `curl` to hit the API routes and verify correct responses (status codes, JSON shape, error cases).
- **Frontend/UI features:** use the Chrome DevTools MCP tools to navigate to the app in the browser, take screenshots to verify the UI renders correctly, click elements to verify interactions work, and check the console for errors.
- **Combined features:** do both. Curl the API, then verify the UI reflects the data.

If verification fails, fix the issue before marking DONE.

### Rules

- One feature per iteration. Do not plan AND implement in the same iteration.
- Always commit your work at the end of the iteration.
- Always run `pnpm build` before marking a feature DONE. It must pass.
- If a build fails, fix it before moving on.
- Update `PROGRESS.md` as the LAST thing you do each iteration.
