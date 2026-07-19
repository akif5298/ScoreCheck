# ScoreCheck

A multi-user NBA 2K26 box score tracker. Sign up, upload a post-game screenshot, confirm the auto-extracted stats, and track your friend group's performance over time. Every account is fully isolated — your games, roster mappings, and analytics are yours alone.

## Features

- **Email/password accounts**: Invite-gated signup, bcrypt-hashed passwords, JWT sessions, in-app password change
- **Per-user data isolation**: Every game, player, team, and stat row is scoped to the account that created it
- **Screenshot upload**: Drop a box score screenshot and stats are extracted automatically
- **OCR review UI**: Confirm or correct extracted stats before saving
- **Roster mappings**: Map in-game gamertags to friend names once; extraction rewrites them automatically and their running totals accrue
- **Dashboard**: Game highs, recent games, and per-player stat trends
- **Player analytics**: Per-player averages across all your tracked games
- **Team standings**: Win/loss records with shooting percentages
- **Lineup efficiency**: Groups of 5 players ranked by average point differential
- **Admin dashboard**: Manage users, games, and roles across the whole instance
- **Eval harness**: Reproducible field-level OCR accuracy measurement (`npm run eval`)

## Upload Pipeline

```
Upload (JPEG / PNG)
        │
        ▼
  Auth gate ──────── JWT verified; per-user rate limit + daily extraction quota
        │
        ▼
  MIME check ─────── magic-byte validation via multer (in-memory)
        │
        ▼
  Perceptual hash ── 16×16 dhash; rejects re-uploads (Hamming ≤ 10)
        │
        ▼
  Junk filter ─────── Ollama minicpm-v:latest; fails open if offline
        │             → 422 if image is clearly not a box score
        ▼
  VLM extraction ──── fine-tuned Qwen2.5-VL (self-hosted, OLLAMA_BASE_URL)
        │             team-half crops (5 players each) → per-row retry
        │             for misses → full-image fallback
        │             → 503 if the extraction host is unreachable
        ▼
  Gamertag mapping ── per-user gamertag → display-name rewrite
        │
        ▼
  Object storage ──── screenshot uploaded to Supabase Storage; object PATH
        │             persisted (signed URLs are minted fresh at read time)
        ▼
  Review UI ───────── user confirms or edits extracted stats
        │
        ▼
  Atomic save ─────── pooled Postgres transaction: game + players + teams,
                      then player_totals / player_stats recomputed for the
                      user's mapped display names
```

## Tech Stack

| Layer | Stack |
|---|---|
| Backend | Node.js 22 · Express 4 · TypeScript 5 |
| ORM / DB | Prisma 5.6 · Supabase (PostgreSQL) · `pg` connection pool |
| Object storage | Supabase Storage (`screenshots` bucket, private) |
| Frontend | React 19 · TanStack Router 1.x · TanStack Start · TanStack Query 5 |
| Styling | Tailwind CSS 4 · Radix UI · shadcn/ui |
| Charts | Recharts 2 |
| Auth | Email/password · bcrypt · JWT (invite-gated signup) |
| Stat extraction | Ollama-compatible endpoint · fine-tuned Qwen2.5-VL (self-hosted) |
| Junk filter | Ollama · minicpm-v:latest |
| Image processing | sharp (crops/scaling) |
| Logging | pino / pino-http (structured JSON) |
| Fine-tuning | Python · Unsloth QLoRA (see [FINETUNING_GUIDE.md](FINETUNING_GUIDE.md)) |
| Hosting | Render (Docker) · Supabase (DB + storage) |

## Multi-User Architecture

ScoreCheck is a single deployment shared by many isolated accounts.

### Authentication

- **Signup** is gated by an invite code (`INVITE_CODE`). If the variable is unset, signups are disabled instance-wide (503).
- Passwords are hashed with **bcrypt** (cost 12) and stored in `users.passwordHash`. Plaintext passwords are never stored or logged, and password hashes never leave the server.
- Login issues a stateless **JWT** (`{ userId, email, role }`, signed with `JWT_SECRET`, TTL `JWT_EXPIRES_IN`). The browser stores it in `localStorage` and sends it as `Authorization: Bearer <token>` on every request.
- Login failures return an identical `401 Invalid email or password` for unknown emails, wrong passwords, and password-less legacy rows, with a constant-time bcrypt comparison so response timing does not leak whether an account exists.
- There is **no** Apple Sign-In, email verification, or password reset in this version (see [Roadmap](#roadmap)).

### Per-user data scoping

Every domain table (`games`, `players`, `teams`, `player_stats`, `player_totals`, `player_mappings`) carries a `userId`/`userid` column. All read and write queries filter on the authenticated user, and game-mutating routes (`start-edit`, update, screenshot fetch) verify ownership — requesting another user's game returns `404`, never their data.

### Roster mappings drive analytics

Running totals and analytics are computed **only** for a user's mapped display names — the `displayName` values in their `player_mappings`. Map a gamertag (e.g. `GRIM_AR15`) to a friend (`Akif`) on the Roster page, and:

1. Future extractions rewrite that gamertag to `Akif` automatically.
2. Existing player rows for that gamertag are retroactively renamed.
3. `Akif`'s `player_totals` accrue on every save; `player_stats` averages rebuild from those totals.

A user with no mappings simply sees empty totals until they add some — the Roster page is the onboarding step.

### Screenshot storage

Uploaded screenshots live in the Supabase Storage `screenshots` bucket (private, service-role writes). The database stores the **object path**, not a URL. Viewable URLs are signed on demand via `GET /api/screenshots/games/:gameId/screenshot`, so links never go stale and no image bytes are persisted in Postgres.

## Quick Start

### 1. Install dependencies

```bash
# Node.js (backend + frontend)
npm install
cd client && npm install

# Ollama (local VLM for extraction + junk filter)
# Install from https://ollama.com then pull the junk-filter model:
ollama pull minicpm-v:latest
# The extraction model is the fine-tuned Qwen2.5-VL — provision it into your
# Ollama host and point OLLAMA_BASE_URL / OLLAMA_EXTRACTION_MODEL at it.

# Python — only needed for the fine-tuning pipeline (labeling, QLoRA training)
pip install -r scripts/requirements_finetune.txt
```

### 2. Configure environment

Copy `env.example` to `.env` and fill in values — see [Environment Variables](#environment-variables). The server validates the environment at boot and refuses to start (with a list of the offending keys) if anything required is missing or malformed.

### 3. Set up database

```bash
npm run db:migrate       # apply schema migrations (prisma migrate deploy)
npm run db:generate      # generate Prisma client
```

### 4. Start dev servers

```bash
npm run dev
```

This starts the Express API (port 3001) and Vite frontend (port 8080) concurrently. Open the app, click **Create account**, and register with your `INVITE_CODE`.

## Environment Variables

Copy `env.example` to `.env`. Variables marked **Required** must be set or the server exits at boot.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Supabase Postgres URL used at runtime. Point at the **transaction pooler** (port 6543, `?pgbouncer=true`) in production |
| `DIRECT_DATABASE_URL` | Yes | Direct/session connection (port 5432) used by `prisma migrate`. May equal `DATABASE_URL` when that already targets the session pooler |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase anon/public key (legacy `SUPABASE_ANON_KEY` also accepted) |
| `SUPABASE_SECRET_KEY` | Yes | Supabase service-role key — bypasses RLS, used for storage writes (legacy `SUPABASE_SERVICE_ROLE_KEY` also accepted) |
| `JWT_SECRET` | Yes | Signs all bearer tokens; min 32 chars (`node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`) |
| `JWT_EXPIRES_IN` | No | Token TTL (default `7d`) |
| `INVITE_CODE` | No | Required to create an account. **Unset disables all signups** |
| `OLLAMA_BASE_URL` | No | Extraction/junk-filter host (default `http://localhost:11434`). Uploads return `503` if unreachable |
| `OLLAMA_EXTRACTION_MODEL` | No | Extraction model tag (default `scorecheck-ocr-r5:latest`) |
| `OLLAMA_API_KEY` | No | Sent as `Authorization: Bearer` to the extraction host when set (for a secured/hosted endpoint) |
| `EXTRACTION_DAILY_LIMIT` | No | Per-user screenshots processed per day (default `50`) |
| `PORT` | No | Server port (default `3001`) |
| `NODE_ENV` | No | `development` or `production` |
| `CORS_ORIGIN` | No | Comma-separated allowed origins in production (same-origin needs none) |
| `LOG_LEVEL` | No | pino log level (default `info`) |
| `MAX_FILE_SIZE` | No | Upload limit in bytes (default `10485760` = 10 MB) |
| `RATE_LIMIT_WINDOW_MS` | No | Global rate window in ms (default `900000` = 15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | No | Global max requests per window (default `100`) |
| `PG_POOL_MAX` | No | Max Postgres pool connections (default `10`) |

## API Endpoints

All endpoints except `/health` and the signup/login routes require `Authorization: Bearer <token>`.

### Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/signup` | Create an account `{ email, password, name?, inviteCode }` → `{ user, token }` |
| `POST` | `/api/auth/login` | Log in `{ email, password }` → `{ user, token }` |
| `POST` | `/api/auth/change-password` | Change password `{ currentPassword, newPassword }` (authenticated) |
| `POST` | `/api/auth/verify` | Verify a token and hydrate the user `{ token }` → `{ user }` |

### Screenshots & games

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/screenshots/upload` | Upload one screenshot; returns OCR-extracted stats for review |
| `POST` | `/api/screenshots/upload-multiple` | Upload up to 10 screenshots |
| `POST` | `/api/screenshots/save` | Confirm reviewed stats; atomically saves game, players, and teams |
| `GET` | `/api/screenshots/games` | List your games |
| `GET` | `/api/screenshots/games/:gameId` | Full box score for one of your games |
| `GET` | `/api/screenshots/games/:gameId/screenshot` | Fresh signed URL for the game's stored screenshot |
| `POST` | `/api/screenshots/games/:gameId/start-edit` | Begin an edit (subtracts current stats from totals) |
| `PUT` | `/api/screenshots/games/:gameId` | Replace a game's players and rebuild totals |
| `POST` | `/api/screenshots/generate-team-names` | Suggest team names from assigned display names |

### Roster mappings

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/mappings` | List your gamertag → display-name mappings |
| `POST` | `/api/mappings` | Create a mapping (retroactively renames existing rows) |
| `PUT` | `/api/mappings/:id` | Update a mapping |
| `DELETE` | `/api/mappings/:id` | Delete a mapping |

### Analytics

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/analytics/dashboard` | Recent games, top performers, and game highs |
| `GET` | `/api/analytics/players` | Per-player aggregated stats |
| `GET` | `/api/analytics/teams` | Per-team aggregated stats (W/L, FG%, 3P%) |
| `GET` | `/api/analytics/lineups` | Lineup efficiency (groups of 5, min 2 games) |

### Admin (role `ADMIN`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/users` | All users |
| `GET` | `/api/admin/games` | All games |
| `GET` | `/api/admin/dashboard` | Instance-wide stats |
| `DELETE` | `/api/admin/games/:gameId` | Delete any game |
| `DELETE` | `/api/admin/users/:userId` | Delete any user |
| `PATCH` | `/api/admin/users/:userId/role` | Promote/demote a user (`USER` / `ADMIN`) |

### Misc

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check (unauthenticated, not rate-limited) |

## Development Scripts

```bash
npm run dev           # start API + client concurrently (watch mode)
npm run build         # compile TypeScript + Vite production build
npm run test          # Jest test suite
npm run lint          # ESLint

# Extraction eval
npm run eval          # field-accuracy eval against labeled screenshots
npm run eval:bench    # full-pipeline benchmark (per-image accuracy + latency)
npm run eval:junk     # junk filter accuracy eval

# Fine-tuning data pipeline
npm run label         # GUI labeling tool — add screenshots to ground truth
npm run label:cli     # CLI labeling tool (one screenshot at a time)
npm run export:dataset  # export labels as JSONL for QLoRA training
npm run finetune      # run QLoRA fine-tuning via Unsloth

# Database
npm run db:migrate       # apply Prisma migrations (migrate deploy)
npm run db:generate      # generate Prisma client
npm run db:setup-admin   # promote an account to ADMIN
npm run seed:mappings    # seed example roster mappings for the dev user
npm run assign-owner -- --email <you@example.com> [--dry-run]
                         # reassign all existing data to one account (see below)
```

## Production & Deployment

The app is deployed as a single Docker container on **Render**, backed by **Supabase** (Postgres + Storage). It is served same-origin: Express hosts the built SPA and the API together.

### Operational hardening

- **Connection pooling** — a `pg.Pool` (not a single client) serves all queries; transactions check out a dedicated client and release it in `finally`. Runtime connects through the Supabase transaction pooler; migrations use the direct connection.
- **Trust proxy** — `app.set('trust proxy', 1)` so per-IP rate limiting and `req.ip` see the real client behind Render's proxy.
- **Rate limits & quotas** — a global per-IP limiter, a stricter per-user upload limiter, and a per-user daily extraction quota (`EXTRACTION_DAILY_LIMIT`, `429` on breach) bound inference cost.
- **Fail-fast config** — the environment is validated with zod at boot; missing/invalid keys abort startup with a readable list.
- **Structured logging** — pino/pino-http emit JSON logs with secrets redacted.
- **Graceful shutdown** — on `SIGTERM`/`SIGINT` the server stops accepting connections, drains in-flight requests, closes the pool and Prisma, then exits (with a 10s force-exit safety timer).
- **Migrations on release** — the container runs `prisma migrate deploy` before starting.
- **Extraction resilience** — the extractor honors a per-call timeout and returns a clean `503` when the model host is unreachable; the junk filter fails open.

### Render setup

1. Create a Render Web Service from this repo (Docker). Health check path: `/health`.
2. Set environment variables (see [above](#environment-variables)) — `DATABASE_URL` (pooler `6543`, `?pgbouncer=true`), `DIRECT_DATABASE_URL` (`5432`), Supabase URL/keys, a fresh `JWT_SECRET`, `INVITE_CODE`, `NODE_ENV=production`, and the `OLLAMA_*` host once your fine-tuned model is deployed.
3. Deploy. The container applies migrations on boot and serves the SPA + API on `$PORT`.
4. Create the private `screenshots` bucket in Supabase Storage if it does not exist.
5. Until the extraction model is hosted, uploads surface a clean "extraction service unavailable" state; everything else (auth, manual review edits, analytics) works.

### Local production build

```bash
docker compose up --build
```

Requires `.env` to be populated. The image includes Node.js, Python, and OpenSSL for Prisma and the native `canvas`/`sharp` build.

## Assigning existing data to an owner

When migrating a personal instance to multi-user, all pre-existing games/players/teams/mappings can be reassigned to a single account:

1. Deploy the multi-user build and create your account through the normal signup flow.
2. Run the reassignment script against the database:

   ```bash
   npm run assign-owner -- --email you@example.com --dry-run   # preview counts
   npm run assign-owner -- --email you@example.com             # apply
   ```

   It reassigns every row to your `userId`, recomputes `player_totals` and `player_stats` from scratch for your mapped display names, cleans up stale screenshot references, and removes orphaned user rows. `--dry-run` wraps everything in a rolled-back transaction and prints per-table counts.

## Extraction Accuracy

Field-level accuracy is measured by the eval harness in `eval/`. Add labeled screenshots to `eval/screenshots/` using `npm run label`, then run `npm run eval`.

The production extractor is a fine-tuned Qwen2.5-VL model (team-half crops with per-row retry and a full-image fallback). See [FINETUNING_GUIDE.md](FINETUNING_GUIDE.md) for the training pipeline and current holdout results, and the benchmark notes under `eval/` for reproducible per-image measurements.

## Project Structure

```
src/                  Backend — Express routes, services, middleware
  config/env.ts       Boot-time environment validation (zod)
  routes/             auth · screenshots · analytics · mappings · admin
  services/           authService · supabase (pg pool + storage) · OCR pipeline
  middleware/         authenticateToken · requireAdmin
client/               Frontend — React 19 / TanStack Router / TanStack Start
eval/                 Extraction accuracy benchmark harness and labeled dataset
scripts/              Fine-tuning data pipeline + assign-data-owner migration
prisma/               Database schema and migrations
```

## Roadmap

Not included in the current version, in rough priority order:

- **Password reset & email verification** — via a transactional email provider (e.g. Resend/Brevo); token tables and the forgot/reset flow.
- **Hosted extraction model** — provision the fine-tuned Qwen2.5-VL behind a stable, authenticated endpoint (`OLLAMA_BASE_URL` + `OLLAMA_API_KEY`).
- **Asynchronous extraction** — move OCR off the request path into a job queue so uploads don't block, enabling horizontal scaling (the current in-memory dedup/quota state assumes a single instance).
- **Self-service roster onboarding** — richer first-run guidance for creating mappings.
```
