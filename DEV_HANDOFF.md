# ScoreCheck — Dev Handoff

_Last updated: 2026-07-19. Written for a fresh Claude Code session picking up this project._

---

## 1. TL;DR

ScoreCheck is a **multi-user NBA 2K26 box-score tracker**: sign up → upload a post-game
screenshot → OCR extracts the stats → confirm → dashboard/analytics. Express + TypeScript API,
TanStack Start (React 19) SPA client, Supabase Postgres (via both Prisma and a raw `pg` layer),
deployed as a Docker image on Render, same-origin (Express serves the built SPA + API).

**It was just converted from a personal single-user app to production multi-user.** That work
is done and committed. The app is production-ready for a single-instance, friends-group
deployment **except for one blocker**: the OCR model is not hosted yet, so uploads return `503`
until it is. Everything else (auth, data isolation, storage, DB, ops) is solid and was verified
against the live database.

**Current branch:** `main` (merged from `prod-prep`). Working tree has **one** uncommitted
change: `.github/workflows/ci.yml` (adds a `prisma validate` step — safe to commit).

---

## 2. MANDATORY workflow rule (graphify)

This repo has a knowledge graph at `graphify-out/`. **Before grepping raw source, run
`graphify query "<question>"` first** to get a scoped subgraph. Use `graphify path "<A>" "<B>"`
for relationships and `graphify explain "<concept>"` for focused concepts. Read
`graphify-out/GRAPH_REPORT.md` only for broad architecture review. **After modifying code, run
`graphify update .`** (AST-only, no API cost). This is enforced by a PreToolUse hook — expect a
reminder if you grep before querying.

---

## 3. Current production state (verified against live DB, 2026-07-19)

- **1 user**: `akifrahman102@gmail.com` (id `b489af50-…`) — the sole owner/admin. Note: this
  account is currently role `USER` unless promoted; see `npm run db:setup-admin` or
  `scripts/add-admin-role.js`.
- **38 games / 380 players** — imported from the hand-labeled ground-truth dataset (known-correct,
  not OCR output). The old 13 OCR games were cleared.
- **9 roster mappings, 8 friends with totals** (Abdul, Akif, Anis, Ankit, Dylan, Ikroop, Nillan,
  Vinoth). `TV` is mapped but never appears in games.
- **Team names encode lineups**: e.g. `Akif (PG) + AI (SG) + Nillan (SF) + Dylan (PF) + Anis (C)`
  — friend display name / `AI` / `Random`, in position order. This drives the lineup-efficiency
  analytics.

---

## 4. What's done (the multi-user conversion)

Committed across `prod-prep` → `main`:

- **Auth**: email/password replacing Apple sign-in. bcrypt (cost 12), invite-gated signup
  (`INVITE_CODE`), JWT sessions, constant-time login (uniform 401s), change-password.
  `src/services/authService.ts`, `src/routes/auth.ts`. Middleware `authenticateToken`
  (`src/middleware/auth.ts`) + `requireAdmin` (`src/middleware/admin.ts`) unchanged.
- **Per-user data isolation**: every table has `userId`; all queries filter by it; game-edit
  routes verify ownership (foreign game → 404). A cross-user bug in the game-edit stats rebuild
  was fixed.
- **Mapping-driven totals**: the old hardcoded `ALLOWED_PLAYER_NAMES` is gone. Totals/analytics
  are computed only for a user's mapped display names (`player_mappings`). Helper:
  `getAllowedNamesForUser` / `getAllowedNamesArray` in `src/services/mappingService.ts`.
- **Storage**: screenshots go to Supabase Storage; the DB stores the **object path**, and a
  signed URL is minted at read via `GET /api/screenshots/games/:gameId/screenshot`. No more
  base64 or expiring URLs in the DB. (`src/services/supabase.ts` `uploadImage`/`getSignedUrl`.)
- **DB**: `pg.Pool` (not a single client) with dedicated per-transaction clients; migrations
  baselined and in sync; `prisma migrate deploy` runs on boot (`npm start`).
- **Config**: zod fail-fast env validation at boot (`src/config/env.ts`, imported first in
  `src/server/index.ts`). Imported **only** by the entrypoint so tests/CI (no env) don't trip it.
- **Ops**: `trust proxy`, pino/pino-http structured logging with redaction (incl. passwords),
  graceful shutdown (drain → pool.end → prisma.disconnect), `/health`, per-user upload rate
  limit + daily extraction quota (429), and a clean **503** when the model host is unreachable.
- **Cleanup**: removed dead deps (`canvas`, `@techstark/opencv-js`, `jimp`, `image-js`) and their
  Dockerfile build stack; deleted the dead GCV `service-account-key.json` (+ `.dockerignore`d).
- **Data import**: `scripts/import-labeled-data.ts` (applied to prod). See §7.

Tests: **132 pass** (14 suites). CI runs lint + typecheck + test + build (+ `prisma validate`,
uncommitted). Verified this session: server lint/typecheck/tests, client typecheck/build.

---

## 5. The one remaining blocker (deferred by owner)

**Host the fine-tuned OCR model.** Extraction calls an Ollama-compatible endpoint at
`OLLAMA_BASE_URL` (default `http://localhost:11434`), model `scorecheck-ocr-r5:latest`
(fine-tuned Qwen2.5-VL-3B; ~84.6% accuracy, ~22s/image — see `EVAL_RESULTS.md`). Until it's
hosted somewhere reachable in prod, **every upload returns 503** (uploads are the core feature).

When hosting it:
- Set `OLLAMA_BASE_URL` to the host; set `OLLAMA_API_KEY` if it needs a bearer token (already
  wired into all extraction/junk-filter fetches via `ollamaHeaders()`).
- Junk filter uses `minicpm-v:latest` (same host).
- Per-call timeout is `EXTRACTION_TIMEOUT_MS` (default 120s); the pipeline pre-flights the host
  (`assertExtractionHostReachable` in `src/services/ollamaExtractor.ts`) and returns 503 if down.

---

## 6. Deliberately NOT built (tradeoffs, not defects)

Do **not** "fix" these without a real scaling need — they'd add complexity/risk for zero benefit
at friends-group scale:

- **Job queue / async extraction** — OCR runs synchronously in the request (~22s). Fine for a
  few users.
- **Single-instance assumption** — `pendingHashes` (upload→save hash bridge) and the daily quota
  counter are **in-memory**. **Keep Render at 1 instance / no replicas** or dedup + quotas break.
  A Redis-backed version is the future path.
- **JWT revocation** — 7-day expiry, no blocklist. Standard SPA tradeoff.
- **Two DB access layers** — Prisma (admin routes + scripts) and raw `pg` (data routes) coexist.
  Unifying is a big risky refactor with no user benefit.
- **Password reset / email verification** — intentionally out of scope. Roadmap in `README.md`.

---

## 7. Scripts & how to run

Dev: `npm run dev` (API on :3001, client on :8080, concurrently). Log in with the `INVITE_CODE`
from `.env` to create accounts.

Verify: `npm test` · `npm run lint` · `npm run build:api` · `(cd client && npm run build)`.

**One-time data scripts** (both run inside a single transaction; `dry-run` rolls back):

> ⚠️ **npm arg-parsing gotcha:** this machine's npm (10.x) swallows `--email`/`--dry-run` as its
> own config after `--`. Use **positional args** with `npm run`, or the flag form via `npx`:
> ```bash
> npm run import:labeled -- <email> [dry-run]                    # positional (npm-safe)
> npx ts-node -r tsconfig-paths/register scripts/import-labeled-data.ts --email <email> --dry-run
> ```

- **`scripts/import-labeled-data.ts`** (`npm run import:labeled`) — **already applied to prod.**
  Clears all game data, imports the 38 labeled games from `eval/training_data.json` for the owner
  (mapped names, positions from slot, scores from point sums, **lineup team names**), recomputes
  totals/stats, deletes other users. `players.team` is stored **equal to** `games.homeTeam`/
  `awayTeam` so the lineup-efficiency query (`src/services/lineupEfficiency.ts`, joins on
  `p.team = g.homeTeam`) works. Game dates are **placeholders** in `IMG_####` (chronological)
  order — the screenshot mtimes were a useless bulk-copy timestamp.

Eval harness: `npm run eval -- --pipeline=ollama` (needs the model host). See `EVAL_RESULTS.md`
and `FINETUNING_GUIDE.md` (note: FINETUNING_GUIDE's "Current status" table is stale).

---

## 8. Environment

`.env` is gitignored (never committed). `env.example` documents everything. Key vars:

- `DATABASE_URL` — Supabase **transaction pooler** (port 6543, `?pgbouncer=true`) at runtime.
- `DIRECT_DATABASE_URL` — **direct** connection (5432) for `prisma migrate` and the one-time
  scripts. (Currently both point at the session pooler; fine.)
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (or legacy `SUPABASE_ANON_KEY`),
  `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`) — service key used for Storage.
- `JWT_SECRET` (≥32 chars), `JWT_EXPIRES_IN` (7d), `INVITE_CODE` (unset = signups disabled).
- `OLLAMA_BASE_URL`, `OLLAMA_EXTRACTION_MODEL`, `OLLAMA_API_KEY?`, `EXTRACTION_DAILY_LIMIT` (50),
  `EXTRACTION_TIMEOUT_MS` (120000), rate-limit vars, `CORS_ORIGIN?`, `LOG_LEVEL?`, `PG_POOL_MAX`.

Env validation (`src/config/env.ts`) fails the boot with a readable list if required vars are
missing/invalid.

---

## 9. Deploy (Render) — checklist for the model-hosting session

1. Render Web Service from repo (Docker). Health check: `/health`. **1 instance.**
2. Set env vars (§8) — pooler for `DATABASE_URL`, direct for `DIRECT_DATABASE_URL`, fresh
   `JWT_SECRET`, `INVITE_CODE`, `NODE_ENV=production`, and the `OLLAMA_*` host once the model is up.
3. Create the private `screenshots` bucket in Supabase Storage if missing.
4. Boot runs `prisma migrate deploy` automatically (`npm start`).

**Unverified from a Windows dev box:** the Dockerfile drops the C/C++ toolchain (only `sharp`
is native, and it ships prebuilt libvips binaries for linux x64). If a Render build ever fails on
`sharp`, re-add `python3 make g++` to the Dockerfile `apt-get`.

---

## 10. Gotchas

- **Line endings**: this Windows checkout produces CRLF; client files should be **LF** (prettier
  flags CRLF). Committed client files are LF and clean. If you edit a client file and local
  eslint shows a wall of `Delete ␍`, run `npx eslint --fix <file>` (from `client/`) to normalize —
  it's local-only noise; CI (Linux/LF) is unaffected.
- **Two data layers**: when changing the `User`/data model, update **both** `prisma/schema.prisma`
  and the raw SQL in `src/services/supabase.ts`.
- **`ALLOWED_PLAYER_NAMES` is gone** — anything player-list-driven must use the per-user mappings
  helper, not a hardcoded list.
- **Prisma migrations**: Supabase has no shadow DB; author migrations with `prisma migrate diff`,
  never `migrate dev`. History was baselined (`prisma/migrations/0_init` + `add_password_hash`).
  Pre-baseline migrations were removed; recover them from git history if ever needed.

---

## 11. Key files

```
src/server/index.ts              entrypoint: env validation, middleware, routes, shutdown
src/config/env.ts                zod env validation (imported first)
src/services/authService.ts      signup/login/change-password, JWT
src/services/supabase.ts         pg.Pool + Storage + all raw-SQL data access
src/services/mappingService.ts   gamertag→name mappings + allowed-names helpers
src/services/ollamaExtractor.ts  OCR pipeline (team-half crops, retries, 503 pre-flight)
src/services/lineupEfficiency.ts lineup analysis SQL (joins players.team = games.homeTeam)
src/routes/{auth,screenshots,analytics,mappings,admin}.ts
scripts/import-labeled-data.ts   labeled-data importer (applied to prod)
prisma/schema.prisma             reconciled with live DB
client/src/routes/               file-based routes (login, upload, games, roster, analytics, admin, settings)
client/src/contexts/auth-context.tsx, client/src/lib/{api,auth}.ts
EVAL_RESULTS.md, FINETUNING_GUIDE.md, README.md
```

---

## 12. Immediate next steps

1. Commit the one pending change: `git add .github/workflows/ci.yml && git commit -m "ci: validate Prisma schema"`.
2. **Blocker 1**: host `scorecheck-ocr-r5` + `minicpm-v` on a reachable endpoint, set `OLLAMA_*`,
   redeploy, and confirm an upload succeeds end-to-end (currently 503).
3. Optional polish: the lineup query keys on the full 5-name set, so different AI/random
   teammates split otherwise-identical friend lineups — could be refined to be friend-focused.
```
