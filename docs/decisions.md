# Architecture decisions

Newest last. Each entry: date, decision, reason.

## 2026-10-08: Initial stack (fixed by the project brief)

- **TypeScript, npm workspaces** with `server/` (Fastify, zod, better-sqlite3, node-cron, `@anthropic-ai/sdk`) and `web/` (React, Vite, Tailwind). One language and one repo keep it simple.
- **SQLite** file in `data/`. It needs zero setup and no external service.
- **argon2 + HTTP-only cookie sessions** in SQLite. No third-party auth.
- **Authorization in one data-access layer.** Every query is scoped by `user_id`, with isolation tests. This replaces database row-level security.
- **`TrainDataProvider` interface** with `MockProvider` and an `HttpProvider` stub. No official public train-status API is confirmed, so the real vendor is chosen after testing.
- **`NotificationChannel` interface** with an in-app feed and email (dry-run log by default). WhatsApp, SMS and Telegram can be added later without touching the engine.
- **Website assistant** uses the Claude API with tool use over the same services. It falls back to an offline scripted assistant when there is no API key.
- **node-cron** scheduler inside the server process.

## 2026-10-08: Phase 1 scaffold choices

- **Node 20 compatibility kept**, although Node 20 reached end-of-life in April 2026. `engines` is `>=20.19`. To stay compatible, Vitest is pinned to 4.x (5.x needs Node 22.12+) and jsdom to 26.x (30.x needs Node 22.22+). Moving to Node 22 or 24 LTS would remove both pins; that's a stack change for the owner to approve.
- **TypeScript pinned to ~6.0**, because typescript-eslint doesn't support TypeScript 7 yet.
- **tsx runs the server** in dev (`tsx watch`). There's no build step yet; a production build is decided with hosting.
- **The root `.env` is loaded with `process.loadEnvFile`** if present, so there's no dotenv dependency.
- **API settings use `API_PORT` / `API_HOST`, not `PORT` / `HOST`.** Preview tools and hosts set `PORT` for the web server, and the API must not pick it up.
- **Vite proxies `/api`** to the API, so the browser sees one origin. That keeps cookie sessions same-site in Phase 2.
- **Moved `RailAlerts-ClaudeCode-Prompts.md` to `reference/`.** It's an older plan for a Next.js + Supabase stack that this project doesn't use.
