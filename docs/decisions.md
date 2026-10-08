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

## 2026-10-08: Phase 2: database, auth and authorization

- **better-sqlite3 pinned to 12.11.x.** 13.x needs Node 22+. Its install script is approved via npm's `allowScripts`, because npm 11 blocks install scripts by default.
- **`@node-rs/argon2` for argon2id hashing**, with library defaults (OWASP baseline). It ships prebuilt binaries, so it needs no install script or compiler.
- **Native-module guard.** `scripts/ensure-native.mjs` runs before `dev` and `test` and rebuilds better-sqlite3 if the current Node can't load it. This machine has Node 26 (Homebrew) and Node 24 (nvm), and the preview pane uses Node 24.
- **Migrations are TypeScript strings**, in an append-only array tracked in `schema_migrations`. There are no SQL files to copy at build time.
- **Sessions.** A random 256-bit token goes in an HTTP-only `SameSite=Lax` cookie. Only its SHA-256 is stored, so a leaked DB can't be replayed. Logout deletes the row server-side. `Secure` is enabled with `COOKIE_SECURE=true`.
- **CSRF (moved up from Phase 8).** Three layers: SameSite=Lax; JSON-only bodies (form posts get 415); and an `onRequest` check rejecting non-GET requests with `Sec-Fetch-Site: cross-site` or an Origin outside `APP_ORIGINS`.
- **Login doesn't reveal which emails exist.** Wrong password and unknown email give the same 401, with a dummy argon2 check to equalise timing. Registration does say "email already registered" (409), a deliberate UX trade-off, mitigated by rate limiting.
- **Data-access layer shape.** `data.forUser(userId)` returns an object whose every query is bound to that user, directly or via the owning journey/chat session. Routes and (later) assistant tools can only get user data through it, with the id taken from the session. Someone else's row looks the same as a missing row (`null`/`false`, so 404, not 403). `data.accounts` holds the only unscoped lookups: login and session resolution.
- **notification_log dedupe** is a unique expression index on `(journey_id, COALESCE(recipient_id, ''), event_key)`. SQLite treats NULLs as distinct, and `recipient_id` is NULL for the journey owner.
- **Alert-rule types** are DEPARTURE, ARRIVAL, DELAY and PLATFORM_CHANGE. Cancellation and diversion alerts always go out, so they have no rule row.
- **`.gitignore` rules anchored to the root** (`/data/`, `/reference/`). Unanchored `data/` was also hiding `server/src/data/`.

## 2026-10-08: Phase 3: dashboard UI

- **Shared validation.** `server/src/schemas` is exported as `@safar-saathi/server/schemas`, and `web/` depends on it as a workspace package. Client and server parse with the same zod schemas, so the rules can't drift. That folder must stay free of Node-only APIs because it ships to the browser.
- **Journey date rules** (`journeyDateProblem`): from yesterday (a train that left last night may still be running) up to 120 days ahead, using the IST calendar date. Checked in the form and again on the server.
- **"Journeys" is the user-facing word**, with alert types as badges on each journey (default 7).
- **react-router 7**, not 8, because 8 needs Node 22+.
- **Stations list** is a bundled sample of 127 major stations for autocomplete (`web/src/data/stations.json`). Any 1-5 letter code can still be typed by hand. The full list should come from the train-data provider later.
- **Autocomplete** follows the WAI-ARIA 1.2 combobox pattern. The delete confirmation is a custom `alertdialog` with focus trap and Escape, because jsdom can't test native `<dialog>.showModal()`.
- **Sign-out redirect** is driven by a `signedOut` flag in auth state, not `navigate()`. Clearing the user unmounts the dashboard first, and router navigations run as transitions, so a `navigate('/')` loses to the guard's redirect to `/signin`.
- **Tailwind v4 shared classes** (`btn-*`, `field-*`) are declared with `@utility`. Classes in `@layer components` can't be `@apply`-ed into each other in v4.
- **Journey dates are formatted by hand** ("Fri, 9 Oct 2026"), because `Intl` output differs between ICU versions (browser vs Node).
