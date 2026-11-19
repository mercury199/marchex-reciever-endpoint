# Marchex Call Tracking Receiver

Receives Marchex call-tracking webhooks, stores every payload verbatim in MongoDB, derives
normalized/queryable events from them, optionally forwards the raw payloads to other URLs,
and serves a dashboard for browsing, filtering and exporting the data. Everything - the
webhook endpoint, the JSON API, and the built dashboard - runs as a single Node process.

See [docs/DESIGN.md](docs/DESIGN.md) for the full data model, linking rule, market
resolution, and timezone handling.

## Stack

- Node 20 + TypeScript (strict), ESM throughout.
- **Fastify**, not Express: native async route handlers, and plugin encapsulation made it
  straightforward to give the webhook route its own raw-body content-type parser without
  that leaking into the JSON API routes (see `src/app.ts`).
- Official `mongodb` driver (no Mongoose - `call_events.data` is deliberately schemaless).
- Zod validates API inputs only, never the webhook body.
- React + Vite + TanStack Table/Query for the dashboard, built to `dist/public` and served
  by the same Fastify process.
- `exceljs` for streamed XLSX export (the one dependency added beyond the original stack,
  since XLSX export needs a real library to produce the file).

## Local development

### 1. Start MongoDB

```bash
docker compose up -d mongo
```

This starts a local MongoDB on `localhost:27017` with a persistent volume. (No Docker on
hand? Run any local `mongod` and point `MONGO_URL` at it instead.)

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in real values - see [Environment variables](#environment-variables)
below. `MONGO_URL` can stay as the default (`mongodb://localhost:27017/marchex`) for local
dev against the compose Mongo.

### 3. Install dependencies

```bash
npm install
npm --prefix web install
```

### 4. Run it

Two options:

- **Backend only** (API + webhook, dashboard not built/served):
  ```bash
  npm run dev
  ```
- **Backend + dashboard with hot reload**: run the backend as above in one terminal, and in
  another:
  ```bash
  npm run dev:web
  ```
  This starts the Vite dev server (default `http://localhost:5173`), which proxies `/api`
  and `/health` to the backend on `PORT` (default 3000). Open the Vite URL, not the backend
  port, while developing the UI.

For a production-shaped run (backend serving the built dashboard from one port):

```bash
npm run build   # builds the backend (tsc) and the dashboard (vite build -> dist/public)
npm start
```

### 5. Send it a webhook

With the server running and `WEBHOOK_TOKEN` set in `.env`:

```bash
WEBHOOK_TOKEN=<same value as .env> npm run replay
```

This POSTs every fixture under `fixtures/marchex/` to `POST /webhooks/marchex/:token` on
`http://localhost:3000` (override with `REPLAY_BASE_URL`). Then open the dashboard and log
in with `DASHBOARD_USER` / `DASHBOARD_PASSWORD` to see the calls land.

## Tests

```bash
npm test
```

Runs the full Vitest suite (ingest pipeline, forwarding queue, API, and a real-HTTP webhook
route suite) against an ephemeral `mongodb-memory-server` instance - no running Mongo or
Docker needed for `npm test` itself.

## Environment variables

All of these are required at boot - the server fails fast with a clear error naming any
that are missing (see `src/config.ts`). See `.env.example` for placeholder values.

| Variable | Purpose |
| --- | --- |
| `MONGO_URL` | MongoDB connection string. On Railway this is the MongoDB service's reference variable. |
| `PORT` | HTTP port. Railway sets this automatically. |
| `WEBHOOK_TOKEN` | Shared secret in the webhook path (`POST /webhooks/marchex/:token`). Generate with `openssl rand -hex 32`. |
| `DASHBOARD_USER` | Dashboard login username (single account). |
| `DASHBOARD_PASSWORD` | Dashboard login password. |
| `SESSION_SECRET` | Signs the dashboard's session cookie. Generate with `openssl rand -hex 32`. |
| `FORWARD_URLS` | Optional, comma-separated. Seeds `forward_targets` with one enabled, unfiltered target per URL on first boot (idempotent on redeploy - edit/remove seeded targets from the dashboard afterward). |

**Never commit real values.** `.env.example` holds placeholders only; `.env` is gitignored.

## Deploying to Railway

This repo is a single Railway service (the app). MongoDB is a second Railway service that
you add yourself - **Railway's Mongo offering can't be provisioned from code**, so this is
the one manual click in the whole setup.

1. **Create the project from this repo.** Railway detects Node via Nixpacks automatically;
   no `railway.json` edits are needed beyond what's already committed (it sets the
   healthcheck path - see below).
2. **Add a MongoDB service**: in the Railway project, *New* → *Database* → *Add MongoDB*.
3. **Wire up `MONGO_URL`** on the app service: add an environment variable
   ```
   MONGO_URL=${{MongoDB.MONGO_URL}}
   ```
   using Railway's reference-variable syntax, so it tracks the Mongo service's own
   connection string automatically. (The other Mongo-prefixed variables Railway exposes -
   `MONGOHOST`, `MONGOPORT`, `MONGOUSER`, `MONGO_INITDB_ROOT_USERNAME`,
   `MONGO_INITDB_ROOT_PASSWORD` - aren't needed by this app; `MONGO_URL` alone is sufficient
   for the `mongodb` driver.)
4. **Set the remaining required variables** on the app service (see the table above):
   `WEBHOOK_TOKEN`, `DASHBOARD_USER`, `DASHBOARD_PASSWORD`, `SESSION_SECRET`, and optionally
   `FORWARD_URLS`. Generate secrets with `openssl rand -hex 32` - don't reuse anything from
   local development. `PORT` and `NODE_ENV` are handled by Railway; you don't need to set
   them yourself.
5. **Deploy.** Nixpacks runs `npm install` then the `build` script (which also builds the
   dashboard - see `package.json`), then `npm start`. On boot the app idempotently creates
   every Mongo collection and index it needs (`src/db/bootstrap.ts`) - no manual database
   setup, migrations, or seed step required against a brand-new Mongo.
6. **Health check.** `railway.json` sets `healthcheckPath` to `/health`, which returns 200
   only when the app can successfully ping MongoDB (503 otherwise) - Railway uses this to
   gate rollouts and restarts.
7. **Get your webhook URL.** Once deployed, Railway gives the service a public domain. Your
   Marchex webhook URL is:
   ```
   https://<your-railway-domain>/webhooks/marchex/<WEBHOOK_TOKEN>
   ```
   Paste that into Marchex's webhook configuration.
8. **Open the dashboard** at `https://<your-railway-domain>/` and log in with
   `DASHBOARD_USER` / `DASHBOARD_PASSWORD`.

## Project structure

```
src/                   Backend (Fastify app, ingest pipeline, forwarding queue, API)
  lib/                 Normalization: timezone, market resolution, field catalog, linking
  db/                  Mongo client + idempotent collection/index bootstrap
  routes/api/          /api/* route handlers (calls, export, forward-targets, raw-deliveries)
web/                    Dashboard (React + Vite + TanStack Table/Query)
docs/DESIGN.md          Data model, linking rule, market resolution, timezone handling
fixtures/marchex/       Sample + synthetic Marchex payloads, used as Vitest fixtures
test/                   Vitest suites (ingest, forwarding, API, webhook HTTP route)
scripts/replay-fixtures.ts   POSTs every fixture to a running instance
docker-compose.yml      Local MongoDB for development
railway.json            Railway build/deploy config (Nixpacks, healthcheck)
```
