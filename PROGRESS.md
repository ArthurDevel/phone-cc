# Progress

## Status Legend

- `TODO` -- not started
- `PLANNED` -- plan written, ready to implement
- `DONE` -- implemented, build passes, verified

---

## Feature 1: Project Scaffolding & Environment

**Status:** DONE

### What was built

- Next.js 16 project configured for mobile-first PWA
- Root layout with viewport meta (`width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`)
- PWA manifest at `/public/manifest.json` (name: "PhoneCC", standalone, dark theme)
- `.env.example` with required keys: `DEEPGRAM_API_KEY`, `GITHUB_PERSONAL_ACCESS_TOKEN` (no Anthropic API key needed -- Claude Code SDK uses CLI auth from the user's Claude Code subscription)
- Dark theme by default with CSS variables for colors: `--background`, `--foreground`, `--muted`, `--border`, `--accent`, `--surface`, `--danger`, `--success`, `--warning`
- Base mobile layout in `page.tsx`:
  - Top bar: hamburger icon (left), session branch name (center, placeholder "No active session")
  - Main area: centered placeholder text "Start a session to begin coding"
  - Bottom bar: disabled text input field + disabled floating circular mic button (indigo accent color, 56px)
- All data stored under `~/.phonecc/` (sessions in `~/.phonecc/sessions/`, projects in `~/.phonecc/projects.json`)
- `pnpm build` passes

---

## Feature 2: Settings Page

**Status:** DONE
**Plan file:** `.docs/plans/2026.03.30-feature-2-settings-page.md`

### What was built

- Settings page at `/settings` for managing linked GitHub projects
- Project type definition in `src/types/project.ts`
- Filesystem storage helper in `src/lib/projects.ts` (reads/writes `~/.phonecc/projects.json`)
- API routes:
  - `GET /api/projects` -- returns `{ projects: Project[] }`
  - `POST /api/projects` -- creates project with UUID, returns 201
  - `DELETE /api/projects/[id]` -- removes project, returns 404 if not found
- Settings page UI with:
  - Header with back arrow and "Settings" title
  - Linked Projects list with name, repo URL, branch badge, delete button
  - Add Project form with name, repo URL, default branch fields
  - Empty state: "No projects linked yet. Add one below."
  - Confirm dialog before deleting a project
- `pnpm build` passes
- All API endpoints verified with curl
- UI verified in Chrome MCP: form renders, projects add/delete correctly, back button works

---

## Feature 3: Session Backend

**Status:** DONE
**Plan file:** `.docs/plans/2026.03.30-feature-3-session-backend.md`

### What was built

- Session manager in `src/lib/session-manager.ts` with in-memory agent map
- Uses `@anthropic-ai/claude-agent-sdk` (v0.2.87) for Claude agent processes
- City name list in `src/lib/cities.ts` (50 cities, lowercase kebab-case)
- Session type definitions in `src/types/session.ts`
- API routes:
  - `POST /api/sessions` -- creates session (clone repo, create branch, spawn agent). 404 if project not found, 409 if max 5 sessions.
  - `GET /api/sessions` -- lists all sessions with status (active/disconnected)
  - `DELETE /api/sessions/[id]` -- closes session with unpushed commit safety check
  - `POST /api/sessions/[id]/reconnect` -- reconnects disconnected session, resumes SDK conversation
- Branch name generation: random city, checks remote + local for uniqueness, appends `-2`, `-3` if needed
- SDK session ID persisted to `.sdk-session-id` file for resume across restarts
- Clone URL embeds GitHub PAT for auth
- `pnpm build` passes
- API error paths verified with curl (400, 404, 409)

---

## Feature 4: Session List UI (Hamburger Sidebar)

**Status:** DONE
**Plan file:** `.docs/plans/2026.03.30-feature-4-sidebar.md`

### What was built

- SessionContext provider in `src/contexts/session-context.tsx` tracking sessions, active session, unread, sidebar state
- Providers wrapper in `src/app/providers.tsx`, integrated into `layout.tsx`
- Sidebar component in `src/components/sidebar.tsx` with:
  - Slide-in animation from left with backdrop overlay
  - "PhoneCC" header with close button
  - "+ New Session" button with project picker dropdown
  - Disabled states: no projects ("Link a project in Settings first"), max sessions ("Max 5 sessions")
  - Session list with status dots (green=active, gray=disconnected), branch name, project name
  - Close session button with unpushed commit confirmation flow
  - Unread notification dots
  - Settings link at bottom with gear icon
- Updated `page.tsx` to client component using SessionContext
- Top bar shows active session branch name or "PhoneCC" when no session active
- Input/mic button disabled when no active session
- `pnpm build` passes
- UI verified in Chrome MCP: sidebar opens/closes, layout correct, Settings navigation works

---

## Feature 5: Chat Interface

**Status:** TODO
**Plan file:** --

### What to build

- The main content area (`<main>`) shows the chat for the currently active session.
- **Message types and rendering:**
  - **User messages:** right-aligned bubble, `bg-accent` background, white text, rounded corners (`rounded-2xl rounded-br-sm`), max-width 80%.
  - **Assistant text messages:** left-aligned bubble, `bg-surface` background, foreground text, rounded corners (`rounded-2xl rounded-bl-sm`), max-width 80%. Support markdown rendering: bold, italic, inline code, code blocks (with syntax highlighting via a simple monospace style -- no heavy library needed), bullet lists, numbered lists. Use a simple markdown renderer or build one with regex replacements.
  - **Tool use blocks:** rendered inline in the message flow as a compact row within the assistant message area. Each tool use shows:
    - A wrench/gear icon + tool name (e.g. "Read", "Edit", "Bash") + a brief status ("completed" in green or "failed" in red)
    - The entire row is clickable.
    - **On click:** opens a **full-screen modal** with:
      - Header: tool name + close button (X)
      - "Input" section: tool's input parameters displayed as formatted JSON in a code block
      - "Output" section: tool's result displayed as a code block (scrollable if long)
      - The modal has `bg-background` and is scrollable
    - Do NOT inline the tool's input/output in the chat itself. Only the collapsed row.
  - **Thinking/loading indicator:** when the agent is processing (status = `thinking`), show three pulsing dots in an assistant-style bubble at the bottom.
- **Streaming:** assistant messages arrive via SSE (`GET /api/sessions/[id]/stream`). Build up the message content as `text_delta` events arrive. For tool use: `tool_use_start` adds a new tool block, `tool_use_result` updates it with the output.
- **SSE endpoint (`GET /api/sessions/[id]/stream`):**
  - Returns `text/event-stream`
  - Event types: `text_delta` (data: `{ text }`), `tool_use_start` (data: `{ toolName, toolInput }`), `tool_use_result` (data: `{ toolName, output }`), `message_end` (data: `{}`), `status_change` (data: `{ status }`)
  - The endpoint keeps the connection open. New messages are pushed as the agent processes.
- **Send endpoint (`POST /api/sessions/[id]/message`):**
  - Body: `{ text: "user's message" }`
  - Passes the message to the Claude Code SDK agent
  - Returns 200 immediately (response streams via SSE)
  - Returns 404 if session not found, 400 if no text
- **Message history endpoint (`GET /api/sessions/[id]/history`):**
  - Read the Claude Code SDK's persisted conversation state from the session folder.
  - Return `{ messages: Message[] }` in the same format the frontend uses.
  - If the agent is disconnected, still attempt to read from the SDK's state files on disk.
  - On frontend: when switching to a session, fetch history and populate the chat. Then connect to SSE for new messages.
- **Auto-scroll:** the chat sticks to the bottom by default. If the user manually scrolls up (by more than 100px from bottom), stop auto-scrolling. Show a floating "scroll to bottom" pill button (`fixed bottom-20 left-1/2 -translate-x-1/2`). Tapping it scrolls to bottom and re-enables auto-scroll.
- **Empty state:** when a session has no messages, show centered: mic icon + "Start a conversation" in muted text.
- **Message data structure:**
  ```typescript
  interface Message {
    id: string;
    role: "user" | "assistant";
    content: string; // text content (built up during streaming)
    toolUses: ToolUse[]; // tool calls within this message
    timestamp: number;
  }
  interface ToolUse {
    id: string;
    toolName: string;
    input: Record<string, unknown>;
    output: string;
    status: "running" | "completed" | "failed";
  }
  ```
- **Verification:**
  - `pnpm build` passes
  - Open the app in Chrome MCP with an active session. Send a message via curl to the message endpoint. Verify the chat shows the user bubble and then streams the assistant response.
  - Verify tool use blocks render as collapsed rows. Click one and verify the modal opens with input/output.
  - Verify auto-scroll behavior.

---

## Feature 6: Voice Input (Deepgram Flux)

**Status:** TODO
**Plan file:** --

### What to build

- **Backend WebSocket proxy for Deepgram:**
  - Create a WebSocket endpoint at `/api/deepgram/ws` (or use a custom server WebSocket handler).
  - When a client connects: open a WebSocket to Deepgram (`wss://api.deepgram.com/v1/listen?model=nova-2&language=en&endpointing=1500&interim_results=true&punctuate=true`) using the `DEEPGRAM_API_KEY` from env. Check Deepgram docs for the Flux model endpoint -- it may be `model=flux` or a different URL.
  - Relay: client audio chunks -> Deepgram. Deepgram transcription events -> client.
  - When client disconnects: close the Deepgram WebSocket.
  - This way the Deepgram API key never leaves the backend.
- **Install `@deepgram/sdk`** as a dependency (or use raw WebSocket to Deepgram -- whichever is simpler for the proxy approach).
- **Floating mic button (already in the layout, now make it functional):**
  - Positioned to the right of the text input in the bottom bar.
  - **Idle state:** mic icon, indigo background.
  - **Recording state:** mic icon, red background, pulsing ring animation (CSS `animate-ping` on a pseudo-element or wrapper).
  - **Push-to-talk behavior:**
    - `onPointerDown` (not onClick -- works for both touch and mouse): start recording.
    - `onPointerUp` / `onPointerLeave`: stop recording and send.
    - When recording starts:
      1. Request microphone permission via `navigator.mediaDevices.getUserMedia({ audio: true })`
      2. Open a WebSocket to our backend at `/api/deepgram/ws`
      3. Stream audio chunks from the MediaStream to the backend WebSocket
      4. Receive transcription events from the backend. Display interim results as a live preview above the input bar (light text, italic).
      5. On final result (`is_final: true` or `speech_final: true` from endpointing): capture the transcript.
    - When recording stops (pointer up):
      1. Close the WebSocket to our backend
      2. Stop the MediaStream
      3. Take the accumulated final transcript and send it as a message to the active session (`POST /api/sessions/[id]/message`)
      4. Clear the live preview
    - Deepgram endpointing (1.5s silence) can also trigger a send while still holding. In that case: send the accumulated transcript, clear the preview, but keep recording for the next utterance. This allows natural pauses.
- **Text input (already in the layout, now make it functional):**
  - The text field to the left of the mic button.
  - On Enter key or tapping a send arrow button: send the text as a message, clear the field.
  - Disabled when no active session.
- **Cancel behavior:**
  - If the user taps the mic button while the agent is currently streaming a response (status = `thinking`):
    1. First, call `POST /api/sessions/[id]/cancel` to abort the agent's current turn
    2. Then start recording as normal
  - This lets the user interrupt the agent mid-response.
- **Cancel endpoint (`POST /api/sessions/[id]/cancel`):**
  - Aborts the agent's current processing (SDK abort mechanism)
  - Returns 200
- **Verification:**
  - `pnpm build` passes
  - Open the app in Chrome MCP. Verify mic button is visible and renders correctly. Verify the text input sends messages on Enter.
  - `curl POST /api/sessions/[id]/cancel` returns 200

---

## Feature 7: Git Action Buttons & PR Detection

**Status:** TODO
**Plan file:** --

### What to build

- **Git action buttons in the top bar (right side):**
  - Two small icon buttons visible only when a session is active:
    - **"Push" button** (upload/arrow-up icon): on tap, sends this exact message to the agent: `"Push all committed changes to the remote repository on the current branch. Use git push."`
    - **"PR" button** (git-merge icon): on tap, sends this exact message to the agent: `"Create a pull request from the current branch to main. Use gh pr create with a descriptive title and body based on the changes made."`
  - These are just regular messages -- they appear as user bubbles in the chat and the agent responds normally.
- **PR detection and display:**
  - After any assistant message finishes, scan the message content for a GitHub PR URL pattern: `https://github.com/[^/]+/[^/]+/pull/\d+`
  - If found, call `GET /api/sessions/[id]/pr` to fetch PR details (the backend knows the repo URL from the session metadata)
  - Display a PR card below the message: shows PR title, #number, status badge (green "Open", purple "Merged", red "Closed"), and a "View on GitHub" link that opens in a new tab
- **API route `GET /api/sessions/[id]/pr`:**
  - Reads the session's `session.json` to get the `repoUrl` and `branchName`
  - Parses the repo URL to extract owner and repo name
  - Calls GitHub REST API: `GET /repos/{owner}/{repo}/pulls?head={owner}:{branchName}&state=all` with the PAT as Bearer token
  - Returns the most recent PR for that branch: `{ number, title, state, url, createdAt, headBranch, baseBranch }`
  - Returns `{ pr: null }` if no PR exists for the branch
  - Returns 404 if session not found, 502 if GitHub API fails
- **PR card component (`PrCard`):**
  - Used in chat (when a PR URL is detected in agent output) and in the session header
  - Shows: PR title (bold), `#{number}` (muted), status badge:
    - "Open" = green badge (`bg-success/20 text-success`)
    - "Merged" = purple badge (`bg-purple-500/20 text-purple-400`)
    - "Closed" = red badge (`bg-danger/20 text-danger`)
  - "View on GitHub" link (opens in new tab)
  - Compact design, fits within a chat bubble or header area
- **Session header PR badge:**
  - When a session is active, check on session switch + every 60s if the branch has a PR via `GET /api/sessions/[id]/pr`
  - If yes, show a small badge next to the branch name in the top bar: `PR #42` in a green pill. Tapping it opens the PR in a new tab.
- **Notification for background sessions:**
  - When an SSE event arrives for a session that is NOT the currently active session, add that session's ID to the `unreadSessions` set in the SessionContext. This triggers the red notification dot in the sidebar.
- **Session status updates:**
  - When a message is sent: set session status to `thinking`
  - When `message_end` received: set status to `idle`
  - When an error occurs: set status to `error`
  - Push status changes via SSE `status_change` events
- **Verification:**
  - `pnpm build` passes
  - Open the app in Chrome MCP with an active session. Verify Push and PR buttons appear in the top bar.
  - Tap the Push button, verify the prompt appears in chat as a user bubble.
  - `curl GET /api/sessions/[id]/pr` returns PR data or `{ pr: null }`

---

## Feature 8: Session Persistence & Reconnection

**Status:** TODO
**Plan file:** --

### What to build

- **On server start (Next.js server initialization):**
  - Scan `~/.phonecc/sessions/` for directories that contain `session.json`
  - Add each to the known sessions list with status `disconnected`
  - Do NOT auto-spawn agents. They will be spawned on demand when the user opens the session.
- **On frontend load:**
  - Call `GET /api/sessions` to populate the session list in SessionContext
  - Read `localStorage` key `phonecc:lastActiveSessionId`. If it matches an existing session, switch to that session.
  - Save `phonecc:lastActiveSessionId` to `localStorage` whenever the active session changes.
- **On session switch to a disconnected session:**
  - Automatically call `POST /api/sessions/[id]/reconnect` to re-spawn the agent
  - **The agent MUST resume with full conversation history** from the previous session. Use the Claude Code SDK's `resume` or `sessionId` feature to restore the conversation. The user must be able to close their browser, come back tomorrow, and continue from where they left off.
  - Then connect to the SSE stream for that session
  - Show a brief "Reconnecting..." message in the chat while this happens
- **Robustness:** if a session folder is manually deleted from disk, `GET /api/sessions` should just not include it. No errors. If `session.json` is missing or corrupt inside a folder, skip that folder.
- **Verification:**
  - `pnpm build` passes
  - Create a session via curl. Restart the dev server. `curl GET /api/sessions` still returns the session (with status `disconnected`). `curl POST /api/sessions/[id]/reconnect` returns status `active`.
  - Open in Chrome MCP, verify that on page reload the last active session is auto-selected.

---

## Feature 9: Session Status Indicators

**Status:** TODO
**Plan file:** --

### What to build

- Each session has a runtime status: `idle`, `thinking`, `error`, `disconnected`.
- **Sidebar status dots (already specced in Feature 4, now implement the live updates):**
  - Green dot (`bg-success`) = `idle` -- agent running, waiting for input
  - Orange pulsing dot (`bg-warning animate-pulse`) = `thinking` -- agent processing a message
  - Red dot (`bg-danger`) = `error` -- agent crashed or last message errored
  - Gray dot (`bg-muted`) = `disconnected` -- folder exists, agent not running
- **Chat view thinking indicator:**
  - When active session status is `thinking`, show three pulsing dots in an assistant-bubble-styled container at the bottom of the message list
  - Remove the dots when status changes to `idle` or `error`
- **Top bar branch name color:**
  - `idle`: white (default foreground)
  - `thinking`: orange/warning
  - `error`: red/danger
  - `disconnected`: gray/muted
- **Status tracking backend:**
  - The in-memory session map tracks status per session: `Map<string, { agent, status }>`
  - Status transitions:
    - Session created -> `idle`
    - Message received -> `thinking`
    - Agent finishes response -> `idle`
    - Agent process exits unexpectedly -> `error`
    - Server restart (agent not in memory) -> `disconnected`
  - Push status changes to frontend via SSE `status_change` events: `data: { status: "thinking" }`
- **Frontend status handling:**
  - SessionContext stores `statusBySession: Map<string, SessionStatus>`
  - SSE events update this map
  - All UI components (sidebar dots, chat indicator, top bar) react to status changes
- **Verification:**
  - `pnpm build` passes
  - Open in Chrome MCP. Send a message to a session. Verify the status dot changes to orange while processing, then back to green when done.
  - Verify the thinking dots appear in the chat.

---

## Feature 10: Error Handling

**Status:** TODO
**Plan file:** --

### What to build

- **Network loss detection:**
  - Listen to `window.addEventListener("online" / "offline")`
  - When offline: show a yellow banner at the top of the app (below the header): "You are offline. Reconnecting when network is available..." (`bg-warning/20 text-warning`)
  - When back online: hide the banner, reconnect all SSE streams
- **SSE disconnect recovery:**
  - If an SSE EventSource fires `onerror` or closes unexpectedly, retry with exponential backoff: 1s, 2s, 4s, 8s, max 30s
  - During reconnection, show "Reconnecting..." text in the chat (muted, italic)
  - On successful reconnect, fetch message history to catch up on missed messages
- **Failed message send:**
  - If `POST /api/sessions/[id]/message` returns non-200 or network error:
    - Show the user message bubble with a red label below it: "Failed to send"
    - Show a "Retry" button next to the label
    - Tapping retry re-sends the same message
  - Keep the failed message in the message list (don't remove it)
- **Agent crash detection:**
  - If the Claude Code SDK process exits unexpectedly (non-zero exit, signal kill, etc.):
    - Set session status to `error`
    - Push `status_change` event via SSE
    - In the chat, show an error card: "Agent disconnected unexpectedly" with a "Reconnect" button
    - Tapping reconnect calls `POST /api/sessions/[id]/reconnect`
- **Clone failure:**
  - If `git clone` fails during session creation (bad URL, auth failure, repo not found):
    - Return 500 with `{ error: "Failed to clone repository: {git error message}" }`
    - Do NOT create the session folder (or clean it up if partially created)
    - Frontend shows a toast notification with the error message
- **Session limit exceeded:**
  - `POST /api/sessions` returns 409 if 5 sessions exist
  - Frontend shows a toast: "Maximum 5 sessions reached. Close a session to start a new one."
- **Deepgram connection failure:**
  - If backend WebSocket to Deepgram fails to connect or drops:
    - Send an error event back to the client WebSocket
    - Client shows a toast: "Voice input unavailable. Check your connection."
    - Disable the mic button (gray it out), but keep the text input functional
    - On next mic tap after failure, retry the connection
- **Toast notification system:**
  - Simple toast component that appears at the top of the screen
  - Auto-dismisses after 5 seconds
  - Supports `error` (red), `warning` (orange), `success` (green) variants
  - Multiple toasts stack vertically
- **Verification:**
  - `pnpm build` passes
  - Kill a running agent process manually, verify the chat shows the error card and status dot turns red
  - `curl POST /api/sessions` when 5 exist, verify 409 response
  - Open in Chrome MCP, verify toast appears for error scenarios

---

## Feature 11: Polish & Deploy

**Status:** TODO
**Plan file:** --

### What to build

- **Loading states:**
  - Session list in sidebar: show 3 skeleton rows (pulsing gray rectangles) while `GET /api/sessions` is loading
  - Chat messages on session switch: show a centered spinner while history is loading
  - Settings page project list: skeleton rows while loading
- **Animations:**
  - Sidebar: slide in from left with `transition-transform duration-200 ease-out`
  - Messages: subtle fade-in + slide-up when new message appears (`animate-in fade-in slide-in-from-bottom-2 duration-200`)
  - Mic button: scale up slightly on press (`active:scale-95`), pulsing ring during recording
  - Tool use modal: fade in + scale up from center
  - Toast notifications: slide in from top
- **Responsive behavior:**
  - Mobile (< 768px): sidebar is overlay with backdrop (current behavior)
  - Tablet/Desktop (>= 768px): sidebar is persistent on the left (always visible, no overlay). Main content shifts right. Adjust with Tailwind `md:` breakpoint.
- **Keyboard handling:**
  - On mobile, when the virtual keyboard opens (text input focused), the input bar should remain visible above the keyboard. Use `visualViewport` API to detect keyboard and adjust layout.
  - `Enter` sends message, `Shift+Enter` inserts newline (make text input a textarea that auto-grows up to 4 lines)
- **Haptic feedback:**
  - Call `navigator.vibrate(50)` on mic button press (if `navigator.vibrate` exists)
  - Call `navigator.vibrate(30)` on message send
- **Build and lint cleanup:**
  - `pnpm build` must pass with zero errors and zero warnings
  - `pnpm lint` must pass
  - Remove any unused imports, variables, or dead code
- **Verification:**
  - `pnpm build` passes with zero errors and zero warnings
  - `pnpm lint` passes
  - Open in Chrome MCP at mobile viewport (375x812). Verify layout, sidebar, chat, mic button all work.
  - Open at desktop viewport (1440x900). Verify sidebar is persistent.
