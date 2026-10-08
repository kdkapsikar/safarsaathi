# Safar Saathi

Proactive train alerts for Indian Railways passengers and the people waiting for them.

> Early development. So far: the monorepo scaffold, a landing page that checks the API (Phase 1), the SQLite database, auth API and data-access layer (Phase 2), sign-up, sign-in and the journeys dashboard (Phase 3), live train data with a simulator (Phase 4), the alert engine with an in-app notification bell (Phase 5), and Saathi, the website assistant that answers from live data (Phase 6).

## Requirements

- Node.js 20.19 or newer (developed on Node 26; CI will use Node 20)
- npm 10 or newer

No external accounts or services are needed.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173, create an account, and add a journey from the dashboard. The landing page footer shows whether the API is running.

| Command             | What it does                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run dev`       | Starts the API (port 3001) and the web app (port 5173) together. The web app proxies `/api` to the API. |
| `npm run lint`      | ESLint across both packages                                                                             |
| `npm run typecheck` | TypeScript checks in each package                                                                       |
| `npm test`          | Vitest in each package                                                                                  |
| `npm run format`    | Prettier                                                                                                |

## Layout

```
server/   Fastify API (TypeScript, zod)
web/      React + Vite + Tailwind
docs/     Architecture decisions and project docs
```

## API (so far)

| Method | Path                 | Notes                                                      |
| ------ | -------------------- | ---------------------------------------------------------- |
| GET    | `/api/health`        | Liveness check                                             |
| POST   | `/api/auth/register` | `{ name, email, password }` → 201, sets the session cookie |
| POST   | `/api/auth/login`    | `{ email, password }` → 200, sets the session cookie       |
| POST   | `/api/auth/logout`   | Ends the session → 204                                     |
| GET    | `/api/auth/me`       | The signed-in user, or 401                                 |

The database is created and migrated automatically at `data/safar-saathi.db` on first start. Delete the file to start fresh.

## Switching Node versions

`better-sqlite3` is a native module built for one Node version. `npm run dev` and `npm test` check it first and rebuild it automatically if you've switched Node (nvm, Homebrew, etc.).

## Saathi, the assistant

Saathi (the round button at the bottom right of every page) answers questions about trains using **tools** that read the same live data as the rest of the app: `get_live_status`, `get_schedule`, `get_platform_info`, `trains_between` and `site_help` for everyone, plus `list_my_journeys`, `get_journey_status`, `create_journey` and `delete_journey` when signed in. It always says when the data is from ("as of …") and says so when data is unavailable, rather than guessing. Adding or deleting a journey is only ever a **proposal**: nothing changes until you press Confirm on the card.

- **No API key (default):** an offline "basic mode" assistant matches common questions and calls the same tools. Good for previews.
- **Real assistant:** put `ANTHROPIC_API_KEY=...` in `.env` (never commit it). `ASSISTANT_MODEL` in `.env.example` sets the model. Limits, effort and the daily token cap are in `.env.example` too.

## Configuration

Copy `.env.example` to `.env` to override the defaults. `.env` is git-ignored; never commit secrets.
