# Safar Saathi

Proactive train alerts for Indian Railways passengers and the people waiting for them.

> Early development. So far: the monorepo scaffold, a landing page that checks the API (Phase 1), the SQLite database, auth API and data-access layer (Phase 2), sign-up, sign-in and the journeys dashboard (Phase 3), and live train data with a simulator (Phase 4).

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

## Configuration

Copy `.env.example` to `.env` to override the defaults. `.env` is git-ignored; never commit secrets.
