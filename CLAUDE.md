# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Writing Buddy ("חבר לכתיבה") is a Hebrew-language web app that guides Israeli 3rd–6th graders through writing a story with an AI coach. UI, prompts, and error messages are all in Hebrew (RTL). The assistant persona is deliberately encouraging and never writes the story for the child — this constraint is enforced via `server/systemPrompt.js` and should be preserved in any changes to chat behavior.

## Commands

Run from repo root unless noted:

- `npm run dev` — runs server (port 3001) and Vite client (port 5173) concurrently. Vite proxies `/api/*` → `http://localhost:3001`.
- `npm run dev:server` / `npm run dev:client` — run each half separately.
- `npm run build` — installs client deps, builds client into `client/dist/`, then installs server deps. The server serves `client/dist` as static files in production, so a client rebuild is required before deploying.
- `npm start` — production server only (expects `client/dist/` already built).

No test suite, linter, or type checker is configured.

### Required environment variables (loaded from `.env` at repo root)

- `DATABASE_URL` — Postgres connection string. Non-`localhost` hosts use SSL with `rejectUnauthorized: false` (see `server/db.js`).
- `JWT_SECRET` — used to sign/verify auth tokens.
- `GROQ_API_KEY` — required; chat uses Groq's OpenAI-compatible endpoint with `llama-3.3-70b-versatile`.
- `HF_API_KEY` — optional; enables HuggingFace SDXL as a second illustration fallback.

### Deployment

`Dockerfile` + `fly.toml` deploy to Fly.io app `writing-buddy-il`. The Dockerfile copies a **pre-built** `client/dist/` into the image — CI/CD does not run `vite build`, so commit the built `dist` or run `npm run build` before `fly deploy`. Note that `fly.toml` still contains a stale `DB_PATH` env var from the pre-Postgres SQLite era; the app ignores it but it can be removed.

## Architecture

### Two-phase session model (core concept)

Every writing session moves through two distinct phases, and most UI/chat logic branches on which phase you're in:

1. **Framework phase (תכנון)** — the assistant walks the child through 5 planning questions (hero name, appearance, setting, problem, resolution) defined in `server/systemPrompt.js`. Messages count toward conversation history but **not** toward the story.
2. **Writing phase (כתיבה)** — begins when the child clicks the green "מוכן/ה לכתוב" button, which sends a hardcoded `KICKOFF_MESSAGE` (`client/src/components/WritingSession.jsx`). The client detects the boundary by finding this exact string in the message history on reload.

Phase detection lives entirely on the client (`writingStartIndex` state + `loadSession` logic). The server doesn't know about phases — it just persists messages. Don't change `KICKOFF_MESSAGE` or `TOOL_MESSAGES` strings without updating session-resume logic: these exact strings are the only way to reconstruct phase boundaries from DB history.

### Tool messages (pseudo-commands sent as user messages)

Writing-phase "tool" buttons (💡 idea, ✍️ rephrase, 🔧 fix, ❓ opinion, 🎨 illustrate) send fixed canned Hebrew strings as user messages. The client maintains a `TOOL_MESSAGES` set to exclude these from sentence counting and story reconstruction. When adding or changing a tool button, update:

- the `tools` array and `toolLimits` in `WritingSession.jsx`
- the `TOOL_MESSAGES` set (must match the `message` field exactly)
- the "help steer the child to a button" instructions in `systemPrompt.js` if behavior in-chat should change

### Story text reconstruction

The "my story" popup text comes from filtering user messages: `role === 'user'` AND not in `TOOL_MESSAGES` AND position ≥ `writingStartIndex`. The child can also manually edit and persist the story via `PATCH /api/sessions/:id` with `story_text`; after that, `sessions.story_text` is the source of truth and new chat lines are merged in heuristically (`openFinishPopup`).

### Chat history trimming

`server/routes/chat.js` `trimHistory()` keeps the first 4 messages (framework Q&A — needed for character consistency) plus the last 20, and strips large `data:` image URLs from older messages. This exists specifically to stay under Groq free-tier's 12k TPM limit on long sessions. If you increase context, re-check Groq tier limits.

### Illustration pipeline (3-tier fallback)

`POST /api/chat/illustrate` in `server/routes/chat.js`:

1. **Prompt extraction** — a Groq call with a strict English system prompt extracts two fixed lines: LINE 1 = character (stable across all illustrations in the session), LINE 2 = current scene. The whole point of the two-line split is character consistency across multiple illustrations — don't merge them.
2. **Image generation**, in order, first success wins: Pollinations.ai (needs browser-like headers or it returns HTML), HuggingFace SDXL (tries 3 models if `HF_API_KEY` is set), then a Groq-generated SVG fallback.
3. Result is base64-embedded into the assistant message as `![איור הסיפור](data:image/...)`. These large data URLs are what `trimHistory` strips from history.

### Backend stack

Express with ES modules (`"type": "module"`). JWT in `Authorization: Bearer <token>` header; `middleware/auth.js` both verifies the token and re-checks user existence in the DB on every request. Schema is created idempotently in `initDb()` via `CREATE TABLE IF NOT EXISTS` plus a defensive `ADD COLUMN IF NOT EXISTS story_text` — add new schema changes the same way rather than introducing a migration tool.

### Frontend stack

React 18 + Vite + React Router 7 + Tailwind. Auth token lives in `localStorage`; `App.jsx` holds it in state and passes it down. The `buddy-*` Tailwind color palette (`client/tailwind.config.js`) and `dir="rtl"` on popup containers are the visual conventions — preserve them. Axios calls include a 90-second timeout specifically because Pollinations can take ~50s to return an image.
