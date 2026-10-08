# Safar Saathi

Proactive train alerts for Indian Railways passengers and the people waiting for them.

> Early development. Phase 1 has the monorepo scaffold and a landing page that checks the API.

## Requirements

- Node.js 20.19 or newer (developed on Node 26; CI will use Node 20)
- npm 10 or newer

No external accounts or services are needed.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173. The landing page calls `GET /api/health` and shows **API is up**.

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

## Configuration

Copy `.env.example` to `.env` to override the defaults. `.env` is git-ignored; never commit secrets.
