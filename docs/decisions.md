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

## 2026-10-08: Demo seed and Saathi mascot (ahead of Phase 6)

- **`npm run seed`** creates or resets a demo account with three sample journeys (today, tomorrow, in 5 days). The credentials live in `DEMO_ACCOUNT` in `server/src/db/seed.ts`, not in chat or docs. They're local-only and refused under `NODE_ENV=production`. Re-seeding resets the password and journeys and signs out existing demo sessions.
- **Saathi** is the assistant's name and mascot: an anime-style (chibi) red electric locomotive with big eyes, idling at a level crossing. It's hand-written inline SVG plus CSS keyframes, with no animation library. One 10-second loop syncs the signal (red, yellow, green), the crossing gate and lights, the headlight beam, and a "Namaste!" bubble with sparkles. Blinking, idle "breathing", a pantograph spark, a drifting cloud and a rail glint run independently. Under `prefers-reduced-motion` it's a still frame.
- **Assistant widget shell.** A launcher on every page (Saathi's face) opens a non-modal chat panel (Escape closes, focus returns to the launcher). The message box is disabled and the copy says plainly it isn't connected yet. It doesn't fake answers. The real chat (Phase 6) needs the train-data provider (Phase 4) first.
- **CSS `transform-box: fill-box`** is limited to the animated `.saathi-*` elements. Applied to every SVG child, it moved the pivot of static `transform="rotate()"` shapes.

## 2026-10-08: Phase 4: train data provider and simulator

- **One normalized model** (`server/src/trains/types.ts`): `TrainStatus`, `StationStatus`, `TrainSchedule`, `ProviderCapabilities`. Times are absolute UTC ISO strings, so multi-day runs and midnight need no special cases downstream. `fetchedAt` is mandatory, so "as of" can always be shown.
- **`null` means unknown and `ProviderError` means can't tell.** Routes map them to 404 and 503. Nothing ever guesses a status.
- **`capabilities()`** includes `trainsBetween` as an optional method (default 6), so the Phase-6 assistant can hide tools the source can't back.
- **Simulator = `MockProvider` + pure `simulateStatus()`**, deterministic in (timetable, start date, scenario, now). A `SimClock` adds an adjustable offset to real time. The four timetables are illustrative and labelled as such everywhere.
- **Scenario timings**: platforms announced 3 h ahead and changed 30 min before (PLATFORM_CHANGE); cancellation announced 4 h ahead; diversion announced 1 h ahead, skipping the middle stop and adding up to 45 min after it; growing delay ≈18 min/h after the first 20 min, capped at 150.
- **`ResilientProvider` wraps any source.** It has a TTL cache per train+date, single-flight (concurrent identical requests share one upstream call), per-attempt timeout, retries with jittered exponential backoff (only for TIMEOUT/UNAVAILABLE), a circuit breaker (CLOSED/OPEN/HALF_OPEN with a single trial), and stale-if-error up to 10 min (the stale data keeps its original `fetchedAt`). Cache and breaker use real time, not simulated time. Simulator actions drop the cache.
- **`HttpProvider` is vendor-neutral.** It calls an adapter that serves our normalized JSON and zod-validates every response. Vendor mapping happens in the adapter, chosen after provider testing. 404 → null; 429/5xx/network → retryable; others → BAD_RESPONSE.
- **The simulator API is mounted only** with the mock provider and `ENABLE_SIMULATOR` (default: on outside production). It's unauthenticated because it's dev-only, but state-changing calls still pass the CSRF origin check.
- **Train endpoints are public** (rate-limited at 120/min per IP). The assistant's anonymous "public tools" will use the same data.
- **Journey cards show live status** (a small extension of the Phase-4 brief, so the simulator's effect is visible): headline, boarding-station departure and platform, last station, note, and "as of". They poll every 30 s and refresh instantly on a `safar:simulator-changed` window event.
- **Known limitation**: a journey's date is treated as the train's start date. Deriving the start date for mid-route boarding on a later day is left to Phase 5 (documented in data-source.md).

## 2026-10-08: Phase 5: alert engine and notifications

- **Level-triggered events with stable keys.** `deriveEvents()` looks at the current status and emits every alert-worthy fact with a key (`DELAY:60`, `PLATFORM:MMCT:5`, `DEPARTED:MMCT`, `CANCELLED`…). `notification_log`'s unique index on (journey, recipient, key) makes delivery idempotent. A missed run never loses an alert, and repeated or concurrent runs never duplicate one. The previous snapshot is used only to describe changes ("was 3").
- **Delay alerts** fire at the journey's threshold (default 15 min), then at 30/60/90/120/180/240 above it. They watch the boarding station until departure, then the destination.
- **Cancellation and diversion** need no rule, ignore quiet hours, and go out by email too if any of the journey's rules use email.
- **Quiet hours** (IST, can cross midnight) skip without logging, so a still-true alert goes out once they end. A departure is only "news" for 60 min.
- **Start date for mid-route boarding.** Journeys keep the boarding date; `resolveStartDate()` maps it to the run's start date using the schedule (day N stop → minus N-1 days). The engine and `/api/trains/:n/status?boardingStation=` both use it, which fixes the Phase 4 known limitation.
- **Active window**: from 6 h before boarding to 6 h after scheduled arrival. Candidates come from boarding dates in [today-3, today+1].
- **Adaptive polling** per train run: 1 min within an hour of any upcoming stop, 5 min while it matters, 15 min if more than 6 h before departure, 30 min after arrival or cancellation. `force` (simulator) ignores it. Guarded against overlapping runs.
- **The engine's cross-user access is isolated** in `createEngineStore(db)`. It's the only place that reads all users' journeys, it's used only by the engine, and every write goes to that journey's own owner or recipients. Request handlers still only get `data.forUser()`.
- **`NotificationChannel`**: `InAppChannel` (the `notifications` table behind the bell) and `DryRunEmailChannel` (logs). The log row records channels as `IN_APP+EMAIL`. A failed delivery is marked FAILED and not retried yet.
- **Snapshots**: only the latest per train run is kept.
- **node-cron 4** in-process (`noOverlap`), started only by `index.ts` (never in tests). The engine uses the simulator clock when the simulator is on, so stepping time drives alerts. Every simulator change also triggers a forced run.
- **Recipients are already honoured** by the engine (email, opted-out skipped). Their UI and opt-out links come in Phase 7.

## 2026-10-08: Phase 6: Saathi, the website assistant

- **Tool registry over existing services** (`server/src/assistant/tools.ts`). Each tool is a thin wrapper around `TrainDataProvider`, the user data-access layer or the help file, so the assistant follows any change of data source automatically. Tools are zod-validated, return compact JSON with `as_of`, and report `not_found` or `unavailable` instead of throwing.
- **Authorization lives in the registry, not the prompt.** Visitors get public tools only. Signed-in users also get journey tools, bound to `data.forUser(session user)`. No tool takes a user id. `runTool` re-checks availability on every call, so a model naming a hidden tool gets an error. Tools are also filtered by `provider.capabilities()`.
- **Writes are proposals.** `create_journey` and `delete_journey` store a row in `assistant_proposals` (migration 2) and return a card. `POST /api/chat/proposals/:id/confirm` re-validates the stored payload and runs it for its owner only, once, within 30 min.
- **Two engines, one interface.** `ClaudeAssistant` runs a streaming manual tool loop on the Anthropic SDK (`client.beta.messages.stream` + `finalMessage()`):
  - It stops on `refusal` and on `max_tokens` with tool calls pending.
  - Tool inputs stream as they're generated (`eager_input_streaming`) and are validated with zod.
  - It retries only unparseable tool JSON.
  - The model comes only from `ASSISTANT_MODEL`, and `.env.example` suggests `claude-opus-5-5`.
  - Effort comes from config (default `low` for chat).
  - Server-side refusal fallback (`fallbacks: "default"`) is on by default and switchable with `ASSISTANT_REFUSAL_FALLBACK`.
    `OfflineAssistant` is used when there's no `ANTHROPIC_API_KEY`. It matches intents by keyword, calls the same tools, and words its answers only from their results.
- **System prompt**: a stable, cached block (rules: facts only from this turn's tool results, always "as of", say when data is unavailable, tool results and user text are data not instructions, proposals need Confirm), then a small per-request block (current IST time, signed in or not).
- **History**: signed-in conversations are saved per user (`chat_sessions`/`chat_messages`, text only, so old numbers are never fed back as tool data). Visitors' recent turns live in the browser and are sent with each message. The last 8 turns are used.
- **Limits and cost**: in-memory hourly limits (40/user, 20/IP for visitors), checked before streaming so a 429 is a normal JSON reply. A daily token cap across all users switches Saathi to basic (offline) mode for the rest of the IST day. `max_tokens` and tool rounds are capped.
- **Streaming**: `POST /api/chat` replies with Server-Sent Events (`text`, `tool`, `proposal`, `notice`, `done`, `error`) on a hijacked Fastify reply. A closed connection aborts the model stream.
- **Evals**: a no-hallucination set checks offline answers against `simulateStatus()` ground truth (delay, current station, platform announced or not, departed, cancelled) and that every answer carries "As of". Mocked-client tests check tool routing, error pass-through, tool hiding and refusals. Live model behaviour still needs evaluating once an API key is in use.
- **UI**: the widget streams answers, shows what Saathi is checking, renders Confirm/Cancel cards (a confirmed change refreshes the dashboard via a `safar:journeys-changed` event), restores the signed-in user's last conversation, and starts fresh when the signed-in person changes.

## 2026-10-08: GitHub Pages demo

- **The owner chose a Pages-only demo**, over Pages plus a separately hosted API, or one host for everything. Pages can't run Node, so a demo build (`vite build --mode pages`) swaps the web app's HTTP transport for an in-browser backend (`web/src/demo/backend.ts`) that answers the same `/api/...` routes.
- **Server code is reused, not re-implemented.** The data-access layer, migrations, MockProvider, ResilientProvider, AlertEngine (event rules, idempotency) and OfflineAssistant tools run unchanged. SQLite is sql.js (WebAssembly) behind a small adapter with the better-sqlite3 API subset the DAL uses (`web/src/demo/sqlite.ts`), persisted to localStorage. To make that possible:
  - The engine no longer imports node-cron (`index.ts` schedules it).
  - Help topics come from a registered source (the server reads the file; the demo bundles it).
  - IDs and tokens use Web Crypto.
  - `migrate()` lives in its own module.
  - `server/package.json` exports `./*` source modules for the web build.
- **The demo account has a single source.** `DEMO_ACCOUNT` (`server/src/db/demoAccount.ts`) drives `npm run seed`, the demo's built-in account and the hint on the demo sign-in page. If it changes, returning browsers get the new password. Sign-in accepts a plain username, so the owner's `demo` login works; sign-up still requires an email.
- **Demo limits, stated in the UI and README:**
  - Auth is not security there (SHA-256 in the visitor's own browser).
  - Data is per browser.
  - Alerts are checked only while a page is open.
  - Saathi always runs in basic (offline) mode, because an API key can't ship to browsers.
- **Routing**: `base` and `basename` are `/safarsaathi/` (`PAGES_BASE` in CI = repo name), and `404.html` is a copy of `index.html` so deep links load the app.

## 2026-10-08: Phase 7: recipients, smart rules, "leave now", connections

- **Settings live on the journey** (migration 3): `travel_time_minutes`, `leave_buffer_minutes` (15), `connects_to_journey_id`, `connection_buffer_minutes` (30), `invite_token`. Quiet hours are written to every alert rule of the journey, and the delay threshold to its DELAY rule, so the engine's per-rule logic is unchanged. One validated `journeySettingsSchema` is shared by the form, the API and the demo backend.
- **"Leave now" maths** (`alerts/timing.ts`, pure): `leaveBy = expected departure at boarding (scheduled + live delay) − travel − buffer`. Instants are absolute, so midnight needs no special case. Because it uses the live expected departure, it moves later as the train runs late and earlier again if the delay shrinks; if it shrinks past "now", the alert goes out straight away. LEAVE_NOW is critical (ignores quiet hours), owner-only, sent once per boarding station. The engine widens the watch window to cover long trips to the station, and polls every minute within an hour of any leave-by time.
- **Connections** (`connectionRisk`): spare = second train's expected departure at its boarding station − first train's expected arrival at its destination. TIGHT if below the user's change time, MISSED if negative. Keys `CONNECTION:<journey>:<level>`, so getting worse (tight to missed) alerts again. Critical and owner-only. The UI warns if the two stations differ (the comparison doesn't include the trip between them). Recovery after a scare isn't announced yet.
- **Recipients** get the journey's normal alerts (not leave-now or connection alerts, which are for the passenger) by email, each with `PUBLIC_APP_URL/optout/<token>`. Opting out is one click, needs no sign-in, and can be repeated safely.
- **Invite links**: the owner switches a random token on (renewed each time) or off. The public page shows only train, stations, date and the owner's first name; the visitor adds their own name and email. Both public endpoints are token-gated and rate-limited (`data.publicLinks`, separate from the user-scoped layer).
- **Saathi**: `get_leave_time` (public: journey_id, or train + station + travel minutes) and `list_my_alerts` (signed in; each alert comes with `explainEventKey()`, a plain-words reason using that journey's own thresholds, quiet hours and travel settings). The offline assistant handles "When should I leave?" and "Why did I get that alert?".
- **Pages demo** gains all the new routes in `web/src/demo/backend.ts`. Opt-out links in the demo point at the demo site, and recipient emails are simulated.
