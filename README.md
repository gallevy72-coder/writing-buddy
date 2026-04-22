# Writing Buddy (חבר לכתיבה)

A Hebrew-language web app that guides Israeli 3rd–6th graders through writing a short story with an AI coach. UI, prompts, and error messages are all in Hebrew (RTL). The assistant is deliberately encouraging and never writes the story for the child.

## Stack

- **Server**: Express (ES modules), PostgreSQL, JWT auth
- **Client**: React 18 + Vite + React Router 7 + Tailwind
- **AI**: Groq (`llama-3.3-70b-versatile`) for chat; HuggingFace `black-forest-labs/FLUX.1-schnell` for illustrations, with an SVG fallback

## Local setup

1. Clone and install:
   ```bash
   git clone https://github.com/<you>/writing-buddy.git
   cd writing-buddy
   npm install
   ```
2. Copy the env template and fill in values:
   ```bash
   cp .env.example .env
   ```
   See [`.env.example`](.env.example) for the required variables and where to get them.
3. Make sure Postgres is running and reachable at the `DATABASE_URL` you set. Tables are created automatically on first run via `initDb()` in `server/db.js`.
4. Start the dev environment:
   ```bash
   npm run dev
   ```
   Runs the Express server on port 3001 and Vite on port 5173. Vite proxies `/api/*` to the server.

## Production build

```bash
npm run build    # builds client into client/dist/
npm start        # runs the server, which serves client/dist statically
```

The server serves `client/dist` in production, so you must rebuild the client before deploying.

## Project structure

```
server/            Express API, DB, auth, chat/illustration routes
client/            React app
client/dist/       Pre-built production bundle (committed on purpose)
CLAUDE.md         Deeper architectural notes (for Claude Code sessions)
```

## Notes

- No test suite, linter, or type checker is configured.
- All UI copy is Hebrew and RTL — keep it that way.
- See `CLAUDE.md` for architectural details (two-phase session model, tool-message pseudo-commands, illustration pipeline, history trimming rationale).
