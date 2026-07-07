# ScoreCheck

An NBA 2K26 box score tracker. Upload a screenshot, confirm the auto-extracted stats, and track your friend group's performance over time.

## Features

- **Screenshot upload**: Drop a box score screenshot and stats are extracted automatically
- **OCR review UI**: Confirm or correct extracted stats before saving
- **Dashboard**: Game highs, recent games, and per-player stat trends
- **Player analytics**: Per-player averages across all tracked games
- **Team standings**: Win/loss records with shooting percentages
- **Lineup efficiency**: Groups of 5 players ranked by average point differential
- **Apple Sign-In**: JWT-backed auth with dev mock bypass
- **Admin dashboard**: Manage users, games, and roles
- **Eval harness**: Reproducible field-level OCR accuracy measurement (`npm run eval`)

## Upload Pipeline

```
Upload (JPEG / PNG)
        │
        ▼
  Auth gate ──────── JWT verified; rate-limited per user
        │
        ▼
  MIME check ─────── magic-byte validation via multer
        │
        ▼
  Perceptual hash ── 16×16 dhash; rejects re-uploads (Hamming ≤ 10)
        │
        ▼
  Junk filter ─────── Ollama minicpm-v:latest; fails open if offline
        │             → 422 if image is clearly not a box score
        ▼
  VLM extraction ──── Ollama qwen2.5vl:3b-fp16 (local, $0 per image)
        │             team-half crops (5 players each) → per-row retry
        │             for misses → full-image fallback
        ▼
  BoxScoreParser ──────── normalizes player rows, infers team names
        │
        ▼
  Review UI ───────────── user confirms or edits extracted stats
        │
        ▼
  Atomic save ─────────── Prisma transaction: game + players + teams
```

## Tech Stack

| Layer | Stack |
|---|---|
| Backend | Node.js 20 · Express 4 · TypeScript 5 |
| ORM / DB | Prisma 5.6 · Supabase (PostgreSQL) |
| Frontend | React 19 · TanStack Router 1.x · TanStack Start · TanStack Query 5 |
| Styling | Tailwind CSS 4 · Radix UI · shadcn/ui |
| Charts | Recharts 2 |
| Auth | Apple Sign-In · JWT |
| Stat extraction | Ollama · qwen2.5vl:3b-fp16 (local VLM) |
| Junk filter | Ollama · minicpm-v:latest |
| Image processing | sharp (crops/scaling) |
| Fine-tuning | Python · Unsloth QLoRA (see [FINETUNING_GUIDE.md](FINETUNING_GUIDE.md)) |

## Quick Start

### 1. Install dependencies

```bash
# Node.js (backend + frontend)
npm install
cd client && npm install

# Ollama (local VLM for extraction + junk filter)
# Install from https://ollama.com then:
ollama pull qwen2.5vl:3b-fp16
ollama pull minicpm-v:latest

# Python — only needed for the fine-tuning pipeline (labeling, QLoRA training)
pip install -r scripts/requirements_finetune.txt
```

### 2. Configure environment

Copy `env.example` to `.env` and fill in values — see [Environment Variables](#environment-variables) below.

### 3. Set up database

```bash
npm run db:migrate       # apply schema migrations
npm run db:generate      # generate Prisma client
npm run db:setup-admin   # create master admin account
```

### 4. Start dev servers

```bash
npm run dev
```

This starts the Express API (port 3001) and Vite frontend (port 8080) concurrently.

## Environment Variables

Copy `env.example` to `.env`. Variables marked **Required** must be set before the server will start.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Supabase Postgres connection string (Prisma) |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase anon/public key |
| `SUPABASE_SECRET_KEY` | Yes | Supabase service-role key (bypasses RLS) |
| `JWT_SECRET` | Yes | Signs all bearer tokens (`crypto.randomBytes(64).toString('hex')`) |
| `JWT_EXPIRES_IN` | Yes | Token TTL, e.g. `7d` |
| `APPLE_CLIENT_ID` | Prod only | Apple app bundle ID |
| `APPLE_TEAM_ID` | Prod only | Apple developer team ID |
| `APPLE_PRIVATE_KEY` | Prod only | Apple private key (PEM) |
| `APPLE_KEY_ID` | Prod only | Apple key identifier |
| `PORT` | No | Server port (default `3001`) |
| `NODE_ENV` | No | `development` or `production` |
| `MAX_FILE_SIZE` | No | Upload limit in bytes (default `10485760` = 10 MB) |
| `RATE_LIMIT_WINDOW_MS` | No | Rate window in ms (default `900000` = 15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | No | Max requests per window (default `100`) |
| `OLLAMA_BASE_URL` | No | Ollama URL (default `http://localhost:11434`). Stat extraction requires a reachable Ollama; the junk filter fails open if unreachable |

> In development, passing `mock_identity_token` as the Apple identity token skips Apple verification. This lets you sign in without Apple credentials configured.

## API Endpoints

All endpoints except `/api/health` and auth routes require `Authorization: Bearer <token>`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/apple` | Apple Sign-In — returns JWT |
| `POST` | `/api/auth/verify` | Verify JWT token |
| `GET` | `/api/health` | Health check |
| `POST` | `/api/screenshots/upload` | Upload a screenshot; returns OCR-extracted stats for review |
| `POST` | `/api/screenshots/upload-multiple` | Upload up to 10 screenshots |
| `POST` | `/api/screenshots/save` | Confirm reviewed stats; atomically saves game, players, and teams |
| `GET` | `/api/screenshots/games` | List all games for the authenticated user |
| `GET` | `/api/screenshots/games/:gameId` | Full box score for one game (all player rows) |
| `GET` | `/api/analytics/dashboard` | Recent games, top performers, and game highs |
| `GET` | `/api/analytics/players` | Per-player aggregated stats |
| `GET` | `/api/analytics/teams` | Per-team aggregated stats (W/L, FG%, 3P%) |
| `GET` | `/api/analytics/lineups` | Lineup efficiency (groups of 5, min 2 games) |
| `GET` | `/api/admin/users` | All users (admin only) |
| `GET` | `/api/admin/games` | All games (admin only) |
| `GET` | `/api/admin/dashboard` | Admin dashboard stats |
| `DELETE` | `/api/admin/games/:gameId` | Delete any game (admin only) |
| `DELETE` | `/api/admin/users/:userId` | Delete any user (admin only) |
| `PATCH` | `/api/admin/users/:userId/role` | Update user role (admin only) |

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
npm run db:migrate       # apply Prisma migrations
npm run db:generate      # generate Prisma client
npm run db:setup-admin   # create master admin account
```

## Extraction Accuracy

Field-level accuracy is measured by the eval harness in `eval/`. Add labeled screenshots to `eval/screenshots/` using `npm run label`, then run `npm run eval`.

Current measured results (qwen2.5vl:3b-fp16, 5 labeled screenshots — see [eval/benchmark_qwen25vl_3b_fp16.md](eval/benchmark_qwen25vl_3b_fp16.md)):

| Metric | Result |
|---|---|
| Player detection | 49/50 rows |
| Name accuracy | 40/49 (one image failed name matching entirely) |
| Field-level stat accuracy | 71% avg (per-image range: 26–94%) |
| Latency per image | 90–130 s (local GPU) |
| Cost per image | $0 (fully local) |

These numbers are from a small 5-image dataset and vary heavily per image — treat them as a baseline, not a settled benchmark. A fine-tuned model targeting >95% is in progress; see [FINETUNING_GUIDE.md](FINETUNING_GUIDE.md).

## Project Structure

```
src/                  Backend — Express routes, services, middleware
client/               Frontend — React 19 / TanStack Router / TanStack Start
eval/                 Extraction accuracy benchmark harness and labeled dataset
scripts/              Fine-tuning data pipeline (label, export, train)
prisma/               Database schema and migrations
```

## Docker

```bash
docker compose up --build
```

Requires `.env` to be populated. The container includes Node.js, Python, and OpenSSL for Prisma compatibility.
