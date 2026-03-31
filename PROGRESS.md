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

**Status:** DONE
**Plan file:** `.docs/plans/2026.03.30-feature-5-chat-interface.md`

### What was built

- Message types in `src/types/message.ts` (Message, ToolUse interfaces)
- Simple markdown renderer in `src/lib/markdown.ts` (bold, italic, code blocks, inline code, lists, line breaks)
- Session manager rewritten in `src/lib/session-manager.ts`:
  - EventEmitter per session for SSE streaming
  - In-memory message history per session
  - `sendMessage()` creates per-message `query()` calls with SDK resume
  - Parses SDK stream events (content_block_start/delta, tool results)
  - Emits SSE events: text_delta, tool_use_start, tool_use_result, message_end, status_change, user_message
  - `getEventEmitter()`, `getMessageHistory()`, `cancelProcessing()`, `isProcessing()`
- API routes:
  - `POST /api/sessions/[id]/message` -- fire-and-forget message send, returns 200 immediately
  - `GET /api/sessions/[id]/history` -- returns in-memory message history
  - `GET /api/sessions/[id]/stream` -- SSE endpoint with ReadableStream, subscribes to session EventEmitter, 30s heartbeat
- ChatView component in `src/components/chat-view.tsx`:
  - `useChatStream` hook manages SSE connection and message state per session
  - UserBubble (right-aligned, accent bg) and AssistantBubble (left-aligned, surface bg, markdown rendered)
  - ToolUseRow (collapsed: wrench icon + name + status badge, clickable)
  - ToolUseModal (full-screen: input JSON + output code block)
  - ThinkingIndicator (three pulsing dots)
  - Auto-scroll with scroll-to-bottom pill button
  - Text input with Enter-to-send
- Updated `page.tsx` to render `<ChatView />` instead of placeholder
- `pnpm build` passes

---

## Feature 6: Voice Input (Deepgram)

**Status:** DONE
**Plan file:** `.docs/plans/2026.03.30-feature-6-voice-input.md`

### What was built

- Standalone WebSocket proxy server in `src/server/deepgram-ws.ts`:
  - Runs on port 3001 (configurable via `DEEPGRAM_WS_PORT`)
  - Accepts WebSocket connections at `/deepgram`
  - Proxies audio to Deepgram `wss://api.deepgram.com/v1/listen` (nova-2, endpointing=1500, interim_results)
  - Relays transcription events back to client as `{ type, text, is_final, speech_final }`
  - Keeps `DEEPGRAM_API_KEY` server-side
- Cancel endpoint `POST /api/sessions/[id]/cancel` -- aborts agent's current processing
- Updated ChatView with push-to-talk mic button:
  - `useVoiceInput` hook manages WebSocket, MediaRecorder, and transcript accumulation
  - `onPointerDown` starts recording (cancels agent if thinking first)
  - `onPointerUp` / `onPointerLeave` stops recording and sends accumulated transcript
  - Interim transcript displayed as live preview above input bar
  - Deepgram endpointing (1.5s silence) auto-sends while still holding
  - Mic button: idle=indigo, recording=red with pulsing ring animation
  - Send button only visible when text is entered; mic always visible
- Added `ws`, `dotenv` dependencies; `@types/ws`, `concurrently` devDependencies
- Added package.json scripts: `dev:ws` (starts WS server), `dev:all` (runs both)
- `pnpm build` passes
- WebSocket server starts correctly with `tsx`

---

## Feature 7: Git Action Buttons & PR Detection

**Status:** DONE
**Plan file:** `.docs/plans/2026.03.30-feature-7-git-actions-pr.md`

### What was built

- PullRequest type in `src/types/pr.ts`
- PR API endpoint `GET /api/sessions/[id]/pr`:
  - Reads session metadata, parses GitHub URL to extract owner/repo
  - Queries GitHub REST API for PRs on the session's branch
  - Returns `{ pr: PullRequest }` or `{ pr: null }`
  - Handles merged state detection via `merged_at` field
- PrCard component in `src/components/pr-card.tsx`:
  - Compact card with title, #number, status badge (Open/Merged/Closed), GitHub link
  - Color-coded badges: green=Open, purple=Merged, red=Closed
- Updated `page.tsx`:
  - Push button (arrow-up icon) sends predefined git push message to agent
  - PR button (git-merge icon) sends predefined PR creation message to agent
  - Both only visible when a session is active
  - PR badge in header: polls `GET /api/sessions/[id]/pr` every 60s, shows `PR #N` green pill linking to GitHub
  - `usePrBadge` hook manages polling lifecycle
- Updated `chat-view.tsx`:
  - `usePrDetection` hook fetches PR info when a GitHub PR URL is detected in message content
  - AssistantBubble renders PrCard inline when PR URL pattern matches
- `pnpm build` passes

---

## Feature 8: Session Persistence & Reconnection

**Status:** DONE
**Plan file:** `.docs/plans/2026.03.30-feature-8-session-persistence.md`

### What was built

- Updated `src/contexts/session-context.tsx`:
  - `switchSession()` auto-reconnects disconnected sessions via `POST /api/sessions/[id]/reconnect`
  - `reconnectAndSwitch()` helper handles reconnect + status update + session switch
  - Persists `activeSessionId` to `localStorage` key `phonecc:lastActiveSessionId`
  - On mount, reads localStorage and restores last active session (auto-reconnects if disconnected)
- Backend already handled persistence correctly:
  - `listSessions()` scans `~/.phonecc/sessions/` directories, skips missing/corrupt `session.json`
  - `reconnectSession()` reads stored SDK session ID for conversation resume
  - Sessions survive server restarts as `disconnected`, reconnect on demand
- `pnpm build` passes

---

## Feature 9: Session Status Indicators

**Status:** DONE
**Plan file:** `.docs/plans/2026.03.30-feature-9-status-indicators.md`

### What was built

- Added `RuntimeStatus` type and `statusMap` + `setSessionStatus` to SessionContext
- ChatView's `useChatStream` hook propagates `status_change` SSE events to context via `onStatusChange` callback
- Sidebar status dots now reflect runtime status:
  - Green (`bg-success`) = idle
  - Orange pulsing (`bg-warning animate-pulse`) = thinking
  - Red (`bg-danger`) = error
  - Gray (`bg-muted`) = disconnected
- Top bar branch name color changes with status:
  - `text-foreground` = idle, `text-warning` = thinking, `text-danger` = error, `text-muted` = disconnected
- Chat thinking indicator (three pulsing dots) already worked from Feature 5
- Backend `status_change` SSE events already emitted from Feature 5
- `pnpm build` passes

---

## Feature 10: Error Handling

**Status:** DONE
**Plan file:** `.docs/plans/2026.03.30-feature-10-error-handling.md`

### What was built

- Toast notification system in `src/contexts/toast-context.tsx`:
  - `addToast(message, variant)` with auto-dismiss after 5s
  - Variants: error (red), warning (orange), success (green)
  - Stack vertically at top of screen, click to dismiss
  - `ToastProvider` added to `src/app/providers.tsx`
- Network loss detection in `page.tsx`:
  - Listens to window online/offline events
  - Shows yellow banner below header when offline
- SSE reconnection with exponential backoff in ChatView:
  - On EventSource error, retries with 1s, 2s, 4s, 8s... max 30s delay
  - Re-fetches message history on reconnect to catch up
  - Shows "Reconnecting..." text in chat during retry
- Failed message send + retry:
  - Tracks failed message IDs in `useChatStream`
  - UserBubble shows "Failed to send" + "Retry" button
  - Retry re-sends the same message text
- Agent error card:
  - When status is `error`, shows card: "Agent disconnected unexpectedly" + "Reconnect" button
  - Reconnect button calls `POST /api/sessions/[id]/reconnect`
- Sidebar toast integration:
  - Shows toast on session creation failure (500) and session limit exceeded (409)
- `pnpm build` passes

---

## Feature 11: Polish & Deploy

**Status:** DONE
**Plan file:** `.docs/plans/2026.03.30-feature-11-polish.md`

### What was built

- **Loading states:**
  - Sidebar: 3 skeleton rows (pulsing gray rectangles) while sessions are loading
  - Chat: centered spinner while message history is loading on session switch
  - Settings: skeleton rows while projects are loading
- **Animations (CSS keyframes in globals.css):**
  - `animate-message-in`: fade-in + slide-up on new message bubbles (200ms ease-out)
  - `animate-toast-in`: slide-in from top on toast notifications (200ms ease-out)
  - `animate-modal-in`: fade-in + scale-up on tool use modal (150ms ease-out)
  - `animate-skeleton`: pulsing skeleton loading animation (1.5s infinite)
  - Mic button: `active:scale-95` on press, existing pulsing ring during recording
  - Sidebar: already had `transition-transform duration-200 ease-out`
- **Responsive desktop layout:**
  - Mobile (< 768px): sidebar is overlay with backdrop (unchanged)
  - Desktop (>= 768px): sidebar is always visible with border-right, main content shifts right via flex-row layout
  - Hamburger button hidden on desktop (`md:hidden`)
  - Backdrop hidden on desktop (`md:hidden`)
- **Keyboard handling:**
  - Text input converted to auto-growing textarea (max 4 lines / 96px)
  - `Enter` sends message, `Shift+Enter` inserts newline
  - `visualViewport` API adjusts input bar padding when mobile keyboard opens
- **Haptic feedback:**
  - `navigator.vibrate(50)` on mic button press
  - `navigator.vibrate(30)` on message send
- **Build and lint cleanup:**
  - Fixed React 19 lint errors: replaced setState-in-effect with render-time state resets
  - Fixed `stopRecording` forward reference by reordering hook declarations
  - Removed unused `err` variable in session-manager catch block
  - `pnpm build` passes with zero errors
  - `pnpm lint` passes with zero errors and zero warnings
