# ScoreCheck — Engineering Handoff

_Written 2026-07-27 for an engineer or agent with **zero** prior context on this repo._

Every factual claim below was verified by running a command or reading the cited file during the
investigation that produced this document. Where something could not be verified, it is marked
`UNKNOWN` with what you would need to check. Inference is labelled as inference.

There is an older `DEV_HANDOFF.md` in this repo. **It is stale** (dated 2026-07-19, before the
squad model and the test harness landed — it claims "132 tests / 14 suites"; the real number is
408 / 23). Prefer this document; read that one only for historical deploy notes.

---

## 1. TL;DR

- **What it is:** a multi-user NBA 2K26 box-score tracker. Upload a post-game screenshot → a
  fine-tuned vision model extracts the stat lines → you confirm them → they land in a shared
  dashboard and analytics.
- **Stack:** Express 4 + TypeScript on Node 22, TanStack Start (React 19) SPA, Postgres on
  Supabase accessed through **two** layers (Prisma *and* raw `pg`), Docker image on Render.
- **Ownership model:** everything is owned by a **Squad**, never a user. "Personal" is just a
  squad of one. Every data query filters on `squadId` (`prisma/schema.prisma:1-10`).
- **🚨 The single most important thing:** `npm test` now runs an integration project that
  **requires a local Postgres on port 55434**, and **CI does not provide one**
  (`.github/workflows/ci.yml` has no service container). Verified: with no database reachable
  the run exits **1**. Any PR to `main` will fail CI until this is fixed. See §16 item 1.
- **To run tests locally you must first start a database.** The exact command is printed by the
  harness itself (`test/integration/global-setup.ts:26`):
  `docker run -d --rm --name sc-int -e POSTGRES_PASSWORD=int -p 55434:5432 postgres:17`
  Note `--rm` — the container is deleted when it stops, so it must be recreated after any Docker
  restart.
- **Current branch:** `codebase-cleanup`, 2 commits ahead of `main`, pushed to origin, working
  tree clean. The work in flight is a test-coverage buildout, mid-way.
- **Test state (verified):** 23 suites / 408 tests passing. Overall server coverage **58.6%**
  statements. Two services are at ~100%; several whole files are at **0%**.
- **The client has no test infrastructure at all** — 0%, no runner installed.
- **A refactor is queued and not started:** `src/services/supabase.ts` (1,236 lines) is to be split
  by entity. Characterization tests were written and committed *first, deliberately*, so that
  `git diff` can prove the safety net was not edited to fit the new code.
- **Authorization is largely unverified by `npm test`** — the route suites mock the services that
  hold the permission rules. See §16 item 2; this is the most consequential correctness gap.

---

## 2. What this project does

ScoreCheck solves a specific, small, real problem. A group of friends plays NBA 2K online. After
each game the console shows a box score. Historically each player who wanted their stats tracked
had to photograph that screen and record the numbers by hand, and each person's records diverged
from everyone else's.

The app replaces that. One member uploads the screenshot; a fine-tuned vision-language model reads
the stat lines out of the image; the uploader corrects anything the model got wrong on a review
screen; the confirmed game is saved once, into a **Squad**, and every member of that squad sees it
in their dashboard, player pages, and lineup analytics.

The users are the owner and their friends group — this is a personal-scale application, not a
commercial product. That framing matters, because several architectural decisions that would be
wrong at scale are deliberately correct here (see §17 and `DEV_HANDOFF.md:105-119`): extraction
runs synchronously inside the HTTP request for ~22 seconds, and two pieces of state are held in
process memory, which pins the deployment to a single instance.

It is a standalone system. It calls out to Supabase (Postgres + object storage) and to an
Ollama-compatible model host, and nothing calls into it.

**Domain vocabulary is overloaded and will confuse you** — read the Glossary (§20) before the
code. In particular "Team" and "Squad" are different things, and `players.team` holds a
generated string that encodes an entire lineup rather than a team name.

---

## 3. Tech stack

Versions are from the manifests and from `node --version` / `npm --version` run locally.

### Runtime and tooling

| Thing | Version | Source |
|---|---|---|
| Node.js | v22.17.0 local; CI pins `'22'` | `.github/workflows/ci.yml:7` |
| npm | 11.11.0 local | observed |
| TypeScript (server) | ^5.2.2 | `package.json` |
| TypeScript (client) | ^5.8.3 | `client/package.json` |
| Package manager | npm, **two separate lockfiles** — root and `client/` | `package-lock.json`, `client/package-lock.json` |

### Server

| Library | Version | Role |
|---|---|---|
| express | ^4.18.2 | HTTP framework |
| @prisma/client / prisma | ^5.6.0 | ORM — admin routes + scripts + migrations only |
| pg | ^8.16.3 | raw SQL — **all** data routes |
| @supabase/supabase-js | ^2.54.0 | object storage only (not the DB) |
| jsonwebtoken | ^9.0.2 | session tokens |
| bcryptjs | ^2.4.3 | password hashing |
| zod | ^3.22.4 | env validation, request validation |
| sharp | ^0.34.3 | image resize for perceptual hashing + team-half crops |
| pino / pino-http | ^10.3.1 / ^11.0.0 | structured logging |
| helmet, cors, compression, express-rate-limit, multer | — | middleware |
| jest + ts-jest | ^29.7.0 / ^29.1.1 | tests |
| supertest | ^7.2.2 | HTTP route tests |

### Client

| Library | Version | Role |
|---|---|---|
| react / react-dom | ^19.2.0 | UI |
| @tanstack/react-router | ^1.168.25 | file-based routing |
| @tanstack/react-start | ^1.167.50 | SPA framework |
| @tanstack/react-query | ^5.83.0 | server state |
| vite | ^8.0.16 | build |
| tailwindcss | ^4.2.1 | styling |
| Radix UI primitives | various | shadcn/ui component base |
| recharts | ^2.15.4 | charts |
| sonner | ^2.0.7 | toasts |
| @lovable.dev/vite-tanstack-config | 2.5.3 | **the client build toolchain** — see §17 |

### Infrastructure

- **Database:** Postgres, hosted on Supabase.
- **Object storage:** Supabase Storage, private bucket named `screenshots`.
- **Model host:** Modal (serverless GPU, scale-to-zero) running Ollama —
  `deploy/modal/scorecheck_ocr.py`.
- **App host:** Render, Docker image, single instance. There is **no** `render.yaml` in the repo —
  the service is created and configured through Render's dashboard, but the intended settings are
  documented step-by-step in `README.md:311-320` (see §14). What is not in version control is the
  *live* dashboard state.

---

## 4. Repository map

```
.
├── src/                      Express API (TypeScript). Path alias @/* → src/*
│   ├── server/index.ts       ENTRY POINT — env validation, middleware, routes, shutdown
│   ├── config/env.ts         zod env schema; process.exit(1) on invalid config
│   ├── constants/index.ts    tunables; NOTE some read process.env directly, bypassing config/env
│   ├── errors/index.ts       error classes (36% covered)
│   ├── middleware/           authenticateToken, requireAdmin, resolveSquad
│   ├── routes/               6 Express routers, one per API namespace
│   ├── services/             business logic + all data access
│   ├── utils/                pure helpers (hashing, name handling, logger) — best-tested area
│   └── types/                shared TS types; types/supabase.ts is generated, excluded from coverage
├── test/integration/         Postgres-backed test harness (added 2026-07-21). Outside src/ on purpose
├── client/                   TanStack Start SPA. Separate package.json + lockfile + tsconfig
│   └── src/
│       ├── routes/           file-based routes → routeTree.gen.ts (GENERATED, do not hand-edit)
│       ├── components/       app-shell, squad-switcher, and ui/ (shadcn primitives)
│       ├── contexts/         auth, squad scope, upload session
│       └── lib/              api.ts is the single fetch chokepoint
├── prisma/
│   ├── schema.prisma         source of truth for the data model
│   └── migrations/           3 migrations; history was baselined — see §17
├── scripts/                  one-off operational + ML dataset scripts (not part of the app)
├── eval/                     model accuracy harness + labeled ground-truth dataset
├── deploy/modal/             the GPU model host (Python)
├── .github/workflows/ci.yml  the only CI pipeline
├── Dockerfile                production image
├── docker-compose.yml        local app+db convenience — NOT the test database (see §10)
└── graphify-out/             generated knowledge graph (see §12)
```

Top-level docs: `README.md`, `DEV_HANDOFF.md` (stale), `CHANGELOG.md`, `EVAL_RESULTS.md`,
`FINETUNING_GUIDE.md`, `SESSION_UPDATE.md` (cited by `EVAL_RESULTS.md:4`, so do not delete it).

---

## 5. Architecture

The API is a conventional layered Express app: **routes → services → database**. Routes handle
HTTP and authorization; services hold logic and SQL; there is no repository layer beneath them.

Three structural decisions are non-obvious and worth understanding before you change anything.

**Two database access layers coexist, on purpose.** `src/services/supabase.ts` opens a raw
`pg.Pool` and every data route goes through hand-written SQL. Prisma is used only by the admin
routes and the scripts, plus migrations and schema definition. `prisma/schema.prisma:9-10` states
the rule explicitly: field names in the schema must stay in sync with the raw SQL by hand. This is
recorded as a deliberate tradeoff in `DEV_HANDOFF.md:115-117` — unifying them was judged a large
risky refactor with no user-visible benefit. **Consequence: a schema change requires editing both
places.**

**Supabase is used for storage, not for the database connection.** Despite the file name,
`supabase.ts` talks to Postgres directly over `pg`. The `@supabase/supabase-js` client in that file
is used only for the `screenshots` bucket. Screenshots are stored as an **object path** in the DB,
never a URL, with a signed URL minted on read — so stored values cannot expire
(`src/services/__tests__/supabase.storage.test.ts:39`).

**Aggregates are denormalized and rebuilt wholesale.** Per-game `players` rows roll up into
`player_totals`, which roll up into `player_stats`. An earlier design maintained these
incrementally, which produced a class of drift bugs. That was replaced by
`recomputeSquadAggregates`, which deletes and rebuilds a squad's aggregates in one transaction
after every mutation. At this data volume a full rebuild is trivially cheap, and it removed the
need to keep two code paths consistent.

```mermaid
flowchart TD
    subgraph Client["client/ — TanStack Start SPA"]
        UI[Routes and components]
        API["lib/api.ts<br/>single fetch chokepoint<br/>attaches Bearer + X-Squad-Id"]
        UI --> API
    end

    subgraph Server["src/ — Express API"]
        direction TB
        MW["middleware<br/>authenticateToken → resolveSquad"]
        R["routes/<br/>auth, screenshots, analytics,<br/>mappings, squads, admin"]
        S["services/<br/>supabase, squadService, ollamaExtractor,<br/>enhancedOCR, mapping, gameMove, lineupEfficiency"]
        MW --> R --> S
    end

    subgraph Data["External"]
        PG[("Postgres<br/>Supabase")]
        ST[("Supabase Storage<br/>screenshots bucket")]
        OL["Modal GPU host<br/>Ollama: scorecheck-ocr-r5<br/>+ minicpm-v"]
    end

    API -->|HTTPS same-origin| MW
    S -->|raw pg.Pool| PG
    S -->|Prisma: admin + scripts| PG
    S -->|object put/get| ST
    S -->|HTTP inference| OL

    style Client fill:#e8f0fe,stroke:#4285f4,color:#111
    style Server fill:#e6f4ea,stroke:#34a853,color:#111
    style Data fill:#fef7e0,stroke:#fbbc04,color:#111
```

**Request scoping is the security backbone.** Every data route runs `authenticateToken` then
`resolveSquad`. The latter (`src/middleware/squad.ts:28`) resolves which squad the request operates
on and attaches `req.squadId`. It looks membership up **in the database on every request** rather
than trusting the JWT, because tokens are 7-day with no revocation list — a removed member would
otherwise keep access until expiry (`src/middleware/squad.ts:20-22`). The `X-Squad-Id` header lets
the client switch squads without reissuing a token, but is always validated against membership.

Routes read the scope through `requireSquadId(req)` (`src/middleware/squad.ts:59`) rather than
`req.squadId!`, so a missing middleware throws loudly instead of writing `undefined` into a scope
column.

---

## 6. Key flows

### 6.1 Signup and login

1. `POST /api/auth/signup` — `src/routes/auth.ts:70`.
2. `authService.signup` validates the invite. **Either** the global `INVITE_CODE` **or** a valid
   squad invite token is accepted; a squad token also overrides the "signups disabled" state,
   because being invited to a squad is itself authorization to hold an account. The token is *not*
   consumed here — joining is a separate step that reuses `acceptInvite`.
3. Password is hashed with bcrypt (cost 12).
4. A **personal squad is created in the same transaction** as the user
   (`squadService.createPersonalSquad`, `src/services/squadService.ts:44`) and `activeSquadId` is
   set to it. There is no such thing as a user without a squad.
5. A JWT is returned and the client stores it in `localStorage` under `token`.
6. On every later request `buildHeaders` (`client/src/lib/api.ts:9`) attaches
   `Authorization: Bearer <token>` and, when set, `X-Squad-Id`.
7. A 401 on any non-auth route clears the session and redirects to `/login`
   (`client/src/lib/api.ts:31-40`).

### 6.2 Upload → extract → review → save (the core flow)

This is the flow the product exists for, and it is the most intricate.

1. **Warm-up.** On entering the upload page the client fires `POST /api/screenshots/warmup`
   (`src/routes/screenshots.ts:191`). It responds `202` immediately and wakes the Modal host in the
   background, so the ~70-85s scale-to-zero cold start overlaps with the user picking files. It
   takes no squad scope and consumes no quota, because it runs no inference on a screenshot.
2. **Upload.** `POST /api/screenshots/upload` (single) or `/upload-multiple` (up to 10)
   — `src/routes/screenshots.ts:307` / `:196`. Middleware chain:
   `authenticateToken → resolveSquad → uploadRateLimit → extractionQuota → multer`.
   Multer uses memory storage with a 10 MB cap.
3. **Liveness pre-flight.** `assertExtractionHostReachable`
   (`src/services/ollamaExtractor.ts:39`) pings the host's `/api/tags`. If unreachable the request
   returns **503** rather than hanging. On Modal, `EXTRACTION_PREFLIGHT_TIMEOUT_MS` must be raised
   to ~120000 so the cold start is *waited through* instead of failing the pre-flight.
4. **Junk filter.** `minicpm-v` classifies whether the image is even a box score. It **fails open**
   — a filter error does not block the upload.
5. **Extraction.** `EnhancedOCRService.extractStructuredDataFromImage`
   (`src/routes/screenshots.ts:254`, `:362`) drives `ollamaExtractor`, which for the fine-tuned
   model runs **team-split inference** — two half-image crops rather than one full image — then
   realigns rows via `alignBySlots` (`src/services/ollamaExtractor.ts:563`).
6. **Perceptual hash + dedup.** The image is hashed (`src/utils/imageHash.ts`) and compared against
   the squad's existing hashes within `DUPLICATE_HAMMING_THRESHOLD`. The hash is parked in an
   **in-memory** `Map` called `pendingHashes` (`src/routes/screenshots.ts:40`) keyed by image URL,
   to bridge upload and save.
7. **Review.** The client hops to `/upload/review` carrying state in `UploadSessionProvider`
   (`client/src/contexts/upload-session.tsx`). The user corrects names, positions, and grades.
8. **Save.** `POST /api/screenshots/save` (`src/routes/screenshots.ts:461`) calls
   `supabaseService.saveGameWithStats`. Inside one transaction it takes
   `pg_advisory_xact_lock` on the squad, **re-checks** for duplicates against committed rows, then
   writes `games` → `players` → `teams` and calls `recomputeSquadAggregates`. On a duplicate it
   throws `DuplicateGameError` and the route returns **200 with the winning game** — the user's game
   is in the squad, which is what they wanted.
9. `pendingHashes.delete()` runs **only after the save commits**
   (`src/routes/screenshots.ts:719`). Deleting earlier meant a failed save left the retry
   permanently un-dedupable.

The advisory lock is load-bearing, not defensive. `scripts/race-check.ts` races five concurrent
saves of one screenshot against a real Postgres: with the fix, 1 game; with no check at all, 5;
with the re-check but **no lock, 3**.

### 6.3 Moving games between squads

1. `POST /api/squads/:squadId/games/move` (`src/routes/squads.ts:257`). The target is the path
   squad; each game's **source** is read from the game row itself, so a caller cannot name a source
   they are not in.
2. `gameMoveService` (`src/services/gameMoveService.ts`) runs one transaction: re-scope
   games/players/teams → reconcile player names through the target squad's roster → rewrite the
   composite lineup strings → recompute aggregates for the target **and every source**.
3. Name reconciliation (`src/utils/nameReconciliation.ts`) treats the **gamertag** as identity:
   reverse the source roster to gamertags, then forward through the target's. Renames are scoped to
   the moved games only, so a game left behind keeps the source spelling.
4. Lineup strings are rewritten token-wise (`src/utils/lineupName.ts`), never by string replace, so
   renaming "Nil" → "Nill" cannot corrupt "Nillan". It is all-or-nothing per game: an unparseable
   lineup skips the rename rather than half-breaking the `p.team = g."homeTeam"` join.
5. If two source names would collapse onto one target person the whole move is refused with
   **409**, rather than silently summing two stat lines.

---

## 7. Data model

Source of truth: `prisma/schema.prisma`. Migrations: `prisma/migrations/` — three of them
(`0_init`, `20260718000000_add_password_hash`, `20260719120000_squad_ownership`).

**The central rule:** data is owned by a `Squad`, never by a `User`. Every user gets a personal
squad on signup, so "personal" is a squad of one and every scoped query filters on the single key
`squadId`. `Game.uploadedByUserId` exists for attribution and for the delete/move permission — it
is **not** the access-control key (`prisma/schema.prisma:5-7`, `:157`).

| Entity | Table | Purpose | Key constraints |
|---|---|---|---|
| `User` | `users` | account | `email` unique; `activeSquadId` FK (SetNull) |
| `Squad` | `squads` | ownership scope | `isPersonal` flags the auto-created one |
| `SquadMember` | `squad_members` | membership + role | unique `[squadId, userId]`; role `OWNER`\|`MEMBER` |
| `SquadInvite` | `squad_invites` | invite links | `token` unique; `maxUses` 0 = unlimited |
| `Game` | `games` | one box score | index `[squadId, imageHash]` serves dedup |
| `Player` | `players` | per-game stat line | unique `[gameId, name, team]` |
| `Team` | `teams` | per-game team totals | unique `[gameId, name]` |
| `PlayerMapping` | `player_mappings` | gamertag → display name | unique `[squadId, gamertag]` **and** `[squadId, linkedUserId]` |
| `PlayerStats` | `player_stats` | per-squad averages | **two overlapping uniques — see below** |
| `PlayerTotals` | `player_totals` | per-squad running totals | unique `[player_id, squadid]` |
| `GameEditLock` | `game_edit_locks` | edit lease | **table exists; no code uses it** |
| `SquadAuditLog` | `squad_audit_log` | change log | **table exists; no code uses it** |

Aggregate chain: `players` → `player_totals` → `player_stats`, rebuilt by
`recomputeSquadAggregates`.

**Two schema landmines:**

1. `player_stats` carries **two overlapping unique indexes** (`prisma/schema.prisma:296-297`):
   `@@unique([squadId, playerName, team])` and `@@unique([playerName, squadId])`. The second is
   strictly stronger and subsumes the first, so a player name can never repeat within a squad. The
   three-column index is dead weight that implies a per-team model the other index forbids.
2. `player_totals` uses **lowercase column names** (`squadid`, `createdat`) while every other table
   uses camelCase quoted identifiers. Called out at `prisma/schema.prisma:303-304` as pre-existing
   convention kept for intra-table consistency. Getting this wrong produces confusing SQL errors.

`PlayerMapping.linkedUserId` is the only link from an app user to their player rows, and is what a
future cross-squad career view would depend on.

---

## 8. APIs & interfaces

All routes are mounted in `src/server/index.ts:139-144`. Every data route runs
`authenticateToken` then `resolveSquad` unless noted.

### Auth — `src/routes/auth.ts`

| Method | Path | Line | Auth | Purpose |
|---|---|---|---|---|
| POST | `/api/auth/signup` | 70 | public | Create account; needs `INVITE_CODE` **or** a squad invite token |
| POST | `/api/auth/login` | 86 | public | Returns JWT; uniform 401s (constant-time) |
| POST | `/api/auth/change-password` | 102 | token | — |
| POST | `/api/auth/verify` | 116 | public | Validate a token |

### Screenshots / games — `src/routes/screenshots.ts`

| Method | Path | Line | Purpose |
|---|---|---|---|
| POST | `/api/screenshots/warmup` | 191 | Wake the model host; 202; no squad scope, no quota |
| POST | `/api/screenshots/upload-multiple` | 196 | Up to 10 files; extract for review |
| POST | `/api/screenshots/upload` | 307 | Single file; extract for review |
| POST | `/api/screenshots/save` | 461 | Persist a reviewed game (advisory lock + dedup) |
| GET | `/api/screenshots/games` | 799 | List the squad's games |
| GET | `/api/screenshots/games/:gameId` | 830 | One game with players and teams |
| GET | `/api/screenshots/games/:gameId/screenshot` | 873 | Mint a signed URL for the stored object |
| POST | `/api/screenshots/generate-team-names` | 899 | Build composite lineup strings |
| PUT | `/api/screenshots/games/:gameId` | 950 | Edit a game; rebuilds aggregates |
| DELETE | `/api/screenshots/games/:gameId` | 1019 | Uploader **or** squad OWNER only |

### Squads — `src/routes/squads.ts`

| Method | Path | Line | Purpose |
|---|---|---|---|
| GET | `/api/squads/` | 62 | List the user's squads with `isActive` + `gameCount` |
| POST | `/api/squads/` | 71 | Create; seeds roster from creator's personal mappings |
| POST | `/api/squads/:squadId/activate` | 85 | Switch active squad |
| GET | `/api/squads/:squadId/members` | 96 | Member list |
| GET | `/api/squads/:squadId/invites` | 107 | OWNER only |
| POST | `/api/squads/:squadId/invites` | 116 | Create invite (192-bit token, 7-day default, max 30) |
| DELETE | `/api/squads/:squadId/invites/:id` | 128 | Revoke; immediate |
| GET | `/api/squads/invites/:token` | 162 | **The only unauthenticated endpoint.** Pre-signup preview, rate-limited 30/min. Returns 404 for unknown/revoked/expired/exhausted alike so responses cannot distinguish them |
| POST | `/api/squads/join/:token` | 183 | Accept an invite |
| GET | `/api/squads/:squadId/roster` | 200 | Roster entries |
| POST | `/api/squads/:squadId/roster/claim` | 216 | Claim a roster entry as yourself |
| POST | `/api/squads/:squadId/games/move` | 257 | Move games between squads; capped at 500 |

### Analytics — `src/routes/analytics.ts`

| Method | Path | Line |
|---|---|---|
| GET | `/api/analytics/players` | 13 |
| GET | `/api/analytics/teams` | 55 |
| GET | `/api/analytics/dashboard` | 101 |
| GET | `/api/analytics/lineups` | 183 |

### Mappings — `src/routes/mappings.ts`

| Method | Path | Line |
|---|---|---|
| GET / POST | `/api/mappings/` | 30 / 40 |
| PUT / DELETE | `/api/mappings/:id` | 66 / 99 |

### Admin — `src/routes/admin.ts` (`authenticateToken` + `requireAdmin` on the whole router, `:12-13`)

| Method | Path | Line |
|---|---|---|
| GET | `/api/admin/users` | 16 |
| GET | `/api/admin/games` | 50 |
| DELETE | `/api/admin/games/:gameId` | 83 |
| DELETE | `/api/admin/users/:userId` | 133 |
| PATCH | `/api/admin/users/:userId/role` | 174 |
| GET | `/api/admin/dashboard` | 232 |

The `ADMIN` role is scoped to **user management** and grants no cross-squad data access. A squad
owner sees only their own squads.

### Other interfaces

- `GET /health` — `src/server/index.ts:129`. Render's health check.
- No GraphQL, no queues, no cron jobs, no webhooks.

---

## 9. Configuration

Validated by zod at boot in `src/config/env.ts`, which is imported **first** in
`src/server/index.ts:2` so a misconfiguration fails fast with a readable list and `process.exit(1)`
(`src/config/env.ts:66-73`). Template: `env.example`. `.env` is gitignored.

**No real secrets appear in this document.** Use `env.example` as the template.

| Variable | Required | Purpose | Consumed at | Example |
|---|---|---|---|---|
| `DATABASE_URL` | **yes** | Runtime Postgres. Supabase transaction pooler | `config/env.ts:15`, `services/supabase.ts` | `postgresql://user:pass@host:6543/postgres?pgbouncer=true` |
| `DIRECT_DATABASE_URL` | no | Direct connection for `prisma migrate` | `config/env.ts:16`, `schema.prisma:19` | `postgresql://user:pass@host:5432/postgres` |
| `SUPABASE_URL` | **yes** | Project URL (must be a URL) | `config/env.ts:20` | `https://<ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | **one of** | Anon key. Legacy alias `SUPABASE_ANON_KEY` | `config/env.ts:21-22,48-54` | redacted |
| `SUPABASE_SECRET_KEY` | **one of** | Service key for Storage. Legacy alias `SUPABASE_SERVICE_ROLE_KEY` | `config/env.ts:23-24,55-61` | redacted |
| `JWT_SECRET` | **yes** | Session signing. **Min 32 chars, enforced** | `config/env.ts:27` | generate with `node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"` |
| `JWT_EXPIRES_IN` | no | Default `7d` | `config/env.ts:28` | `7d` |
| `INVITE_CODE` | no | Signup gate. **Unset disables signups** | `config/env.ts:30` | `some-code` |
| `NODE_ENV` | no | `development`\|`production`\|`test`; default `development` | `config/env.ts:11` | `production` |
| `PORT` | no | Default `3001` | `config/env.ts:12` | `3001` |
| `OLLAMA_BASE_URL` | no | Model host; default `http://localhost:11434` | `config/env.ts:34`, `constants/index.ts:15` | `https://<app>.modal.run` |
| `OLLAMA_EXTRACTION_MODEL` | no | Default `scorecheck-ocr-r5:latest` | `constants/index.ts:20` | same |
| `OLLAMA_API_KEY` | no | Bearer token for a secured host | `constants/index.ts:18` | redacted |
| `CORS_ORIGIN` | no | Comma-separated; prod only. Same-origin needs none | `config/env.ts:39`, `server/index.ts:84` | `https://app.onrender.com` |
| `LOG_LEVEL` | no | pino level | `config/env.ts:40` | `info` |
| `RATE_LIMIT_WINDOW_MS` | no | Default 900000 | `config/env.ts:41` | `900000` |
| `RATE_LIMIT_MAX_REQUESTS` | no | Default 100 | `config/env.ts:42` | `100` |
| `EXTRACTION_DAILY_LIMIT` | no | Per-user/day; default 50 | `config/env.ts:43` | `50` |
| `MAX_FILE_SIZE` | no | Bytes; default 10485760 | `config/env.ts:44`, `constants/index.ts:40` | `10485760` |
| `PG_POOL_MAX` | no | Pool size; default 10 | `config/env.ts:45` | `10` |
| `TEST_DATABASE_URL` | no | Overrides the integration DB | `test/integration/db-name.ts:16` | `postgresql://postgres:int@localhost:55434/scorecheck_test` |

### ⚠️ Config-surface inconsistency (verified)

Three variables are read **directly from `process.env`** in `src/constants/index.ts` and are
**not** in the zod schema, so they are never validated and a typo fails silently:

- `EXTRACTION_TIMEOUT_MS` — `constants/index.ts:24`, default 120000
- `EXTRACTION_PREFLIGHT_TIMEOUT_MS` — `constants/index.ts:30`, default **3000**
- `UPLOAD_PATH` — **dead configuration.** Verified: the string `UPLOAD_PATH` appears exactly once
  in the entire tracked tree, at `env.example:51`. Nothing reads it. Setting it has no effect.

The `uploads/` directory it refers to is a *separate* question, and that directory is not dead — it
is created at `Dockerfile:28`, bind-mounted at `docker-compose.yml:16`, and served statically at
`src/server/index.ts:111` — but its path is **hardcoded** to `path.join(__dirname, '../../uploads')`
rather than read from config. Nothing writes to it either: multer uses `memoryStorage`
(`src/routes/screenshots.ts:161-162`) and screenshots go to Supabase Storage. Inference: the
directory and the env var are both leftovers from a pre-Supabase local-disk era. Removing
`UPLOAD_PATH` from `env.example` is safe; the static mount is harmless and can be left alone.

`EXTRACTION_PREFLIGHT_TIMEOUT_MS` matters operationally: the 3000 ms default suits a warm local
Ollama, but a Modal scale-to-zero host needs ~120000 or the first upload after idle fails into a
spurious 503 (`constants/index.ts:26-29`).

---

## 10. Local setup

Prerequisites: **Node 22**, **Docker** (for the test database only), and **git**. A Supabase
project and a reachable model host are needed for the *app* to be fully functional, but neither is
needed to run the test suite.

```bash
# 1. Clone and install — note there are TWO npm projects
git clone <repo-url> ScoreCheck
cd ScoreCheck
npm ci
cd client && npm ci && cd ..

# 2. Configure
cp env.example .env
#    Then edit .env and fill in, at minimum:
#      DATABASE_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY
#      JWT_SECRET   (must be >= 32 characters, or boot fails)
#      INVITE_CODE  (leave unset to disable signups entirely)
#    Generate a JWT secret:
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"

# 3. Generate the Prisma client (required before typecheck/build)
npx prisma generate

# 4. Start the integration test database.
#    REQUIRED before `npm test` — the integration project cannot run without it.
#    Note --rm: this container is DELETED when stopped and must be recreated.
docker run -d --rm --name sc-int -e POSTGRES_PASSWORD=int -p 55434:5432 postgres:17

# 5. Verify the checkout is healthy
npm test                      # expect: 23 suites, 408 tests, all passing
npx tsc -p tsconfig.json --noEmit
npm run lint                  # expect: 0 errors, 5 warnings

# 6. Run the app (API :3001, client :8080)
npm run dev
```

Notes and manual steps:

- **The test database is not `docker-compose.yml`.** That compose file describes an app + db pair
  on port 5432 for running the whole application locally. The test harness wants a *separate*
  throwaway database on **55434**. They are unrelated; do not substitute one for the other.
- The `scorecheck_test` database itself does **not** need creating.
  `test/integration/global-setup.ts` connects to the `postgres` maintenance database, creates the
  template if missing, runs `prisma migrate deploy` into it, and each Jest worker clones its own
  `_w<N>` copy.
- Log in using the `INVITE_CODE` from your `.env` to create the first account. Promote it to admin
  with `npm run db:setup-admin`.
- **Uploads will return 503** unless `OLLAMA_BASE_URL` points at a reachable Ollama host with the
  `scorecheck-ocr-r5` and `minicpm-v` models. Everything else works without it.
- Windows: see the CRLF note in §17.

---

## 11. Commands cheat sheet

| Task | Command | Notes |
|---|---|---|
| Dev (both) | `npm run dev` | API :3001 + client :8080 via concurrently |
| Dev API only | `npm run dev:api` | nodemon + ts-node |
| Dev client only | `npm run dev:client` | vite |
| Build all | `npm run build` | api then client |
| Build API | `npm run build:api` | `tsc` + `tsc-alias` (resolves `@/*`) |
| Start (prod) | `npm start` | runs `prisma migrate deploy` first |
| **Test (all)** | `npm test` | **needs Postgres on 55434** |
| Test unit only | `npx jest --selectProjects unit` | **no database needed** — 21 suites / 264 tests |
| Test integration only | `npx jest --selectProjects integration` | 2 suites / 144 tests |
| Coverage | `npx jest --coverage` | |
| Lint | `npm run lint` | `eslint src/**/*.ts` — **does not cover `test/`** |
| Lint fix | `npm run lint:fix` | |
| Typecheck server | `npx tsc -p tsconfig.json --noEmit` | |
| Typecheck client | `cd client && npx tsc --noEmit -p tsconfig.json` | |
| Format (client) | `cd client && npm run format` | prettier; server has no format script |
| Migrate | `npm run db:migrate` | `prisma migrate deploy` |
| Prisma client | `npm run db:generate` | |
| Prisma studio | `npm run db:studio` | |
| Promote admin | `npm run db:setup-admin` | |
| Seed mappings | `npm run seed:mappings` | |
| Model eval | `npm run eval` | needs the model host |
| Junk-filter eval | `npm run eval:junk` | |
| Graph refresh | `graphify update .` | run after code changes — see §12 |

There is **no deploy command** — deployment is a git push plus Render's build (§14).

---

## 12. Conventions

**Path aliases.** Server code imports via `@/*` → `src/*`, configured in `tsconfig.json` and
mirrored in `jest.config.ts:8`. The build resolves them with `tsc-alias`. Example:
`src/server/index.ts:14`.

**Layering.** Routes own HTTP and authorization; services own logic and SQL; utils are pure and
dependency-free. `src/utils/` is the best-tested area precisely because it is pure.

**Error handling.** Custom classes live in `src/errors/index.ts`. Services throw typed errors
(`SquadError` carries an HTTP status, `src/services/squadService.ts:29`); routes translate them.
The read helpers in `supabase.ts` **log and rethrow** rather than returning `null`/`[]` — that was
a deliberate 2026-07-19 change (commit `7fda859f`), because disguising failures as absence made
callers write wrong data. A genuine miss still returns absence; only failures propagate.

**Logging.** pino throughout, imported as `@/utils/logger`. Structured object-first calls:
`logger.error({ err }, 'message')`. HTTP request logging via `pino-http`
(`src/server/index.ts:93`). Redaction is configured for passwords.

**Cross-squad access returns 404, never 403** — so a response cannot confirm that a resource
exists in a squad you are not in. Same reasoning applies to invite lookups
(`src/routes/squads.ts:162`).

**Client state.** Auth and squad scope live in React contexts
(`client/src/contexts/`), but the *token and active squad are read from `localStorage` directly* by
`buildHeaders`, because it is a plain function rather than a hook and must work for requests fired
outside a component (`client/src/lib/api.ts:3-7`).

**Client styling.** Semantic Tailwind tokens only (`bg-background`, `text-muted-foreground`) —
never hardcoded colors, which is what keeps light/dark coherent. `font-display` for headings,
`font-mono` for nav codes, the `stamp` utility for small uppercase labels. Components come from
`client/src/components/ui/` (shadcn); **add no new UI dependencies**.

**Client routing** is file-based; `client/src/routeTree.gen.ts` is **generated** — never hand-edit
it. Route files legitimately have zero static importers, so import-graph tools will wrongly report
them as dead.

**Commit style.** Conventional Commits, observed consistently across the last 25 commits:
`feat:`, `fix:`, `test:`, `refactor:`, `ci:`, `chore:`. Subject in imperative mood. Bodies explain
*why* on non-trivial changes (see `8e5e0dc1`).

**Commit discipline (owner's explicit rule):** **one commit per logical action** — a delete, a
refactor, and a merge never share a commit. **The repository owner runs `git commit` themselves**;
prepare and stage changes and propose a message, but do not commit or push unless asked.

**Code review — there is no formal process, and this is a solo project.** Verified from git
history: 80 of 81 commits are by one person, Akif R, under two identities (a local git config and
the GitHub `noreply` address used for web-UI commits); the only other author is a one-off `Fly.io`
bot commit from an abandoned hosting experiment. Exactly **three** pull requests exist in the
entire history (`#1`, `#2`, `#3` — merges from `multi-file-upload`, `Editing-Box-Scores`, and
`rendertest`), all self-merged, all early. Recent integration is done with a plain
`git merge <branch>` (e.g. `f244d262 Merge branch 'prod-prep'`) or by committing straight onto a
feature branch. There is no `CONTRIBUTING.md`, no PR template, no `CODEOWNERS`, and no branch
protection visible in the repo. Inference: PRs have been used occasionally as a merge mechanism,
never as a review gate. **Practical implication:** nobody else will catch your mistakes — CI and
the test suite are the only gates, which is exactly why §16 item 1 matters.

---

## 13. Testing

**Framework:** Jest 29 with ts-jest, configured in `jest.config.ts` as **two projects**.

| Project | Root | Needs DB? | Verified count |
|---|---|---|---|
| `unit` | `src/` | no | 21 suites / **264 tests** |
| `integration` | `test/integration/` | **yes** | 2 suites / **144 tests** |
| **combined** | | | **23 suites / 408 tests, all passing** |

Unit tests live beside the code in `src/**/__tests__/*.test.ts`. Integration tests live in
`test/integration/` — deliberately **outside** `src/`, because `tsconfig.json` sets `rootDir` to
`./src` and a test under `src/` importing a helper from `test/` would break `npm run build:api`
(`jest.config.ts:23-24`).

### How the integration harness works

- **Per-worker databases.** Every integration test `TRUNCATE`s the whole schema in `beforeEach`, so
  a shared database would have parallel workers wiping each other's fixtures. Each worker instead
  clones its own database from a migrated template via `CREATE DATABASE ... TEMPLATE`, which
  Postgres implements as a file copy and is nearly free (`test/integration/db-name.ts:4-9`).
  Serializing just the integration project was not an option: `maxWorkers` is a *global* Jest
  option and is invalid inside a project config.
- **Truncate, not transaction-rollback.** The code under test manages its own transactions and
  takes advisory locks inside them; wrapping it in an outer transaction would change the very
  behavior the suites exist to verify (`test/integration/setup-db.ts:5-8`).
- **The table list is explicit** (`test/integration/setup-db.ts:22-34`) so a newly added table
  fails review here rather than silently leaking rows between tests. `_prisma_migrations` is
  excluded on purpose.
- **🔒 `setup-env.ts` is safety-critical.** `.env` holds the *production* `DATABASE_URL` and
  `supabase.ts` builds its `pg.Pool` at module scope. So the harness sets `DATABASE_URL` in
  `setupFiles` (which runs *before* test modules import — `setupFilesAfterEnv` would be too late)
  and then **refuses to run** unless the host is local *and* the database name matches `/test/i`.
  There is no escape hatch by design: a misconfigured environment would otherwise TRUNCATE
  production with no error and no undo.
- **Fixtures use raw SQL, not the services** (`test/integration/factories.ts:1-8`), so a broken
  service fails only the tests aimed at it instead of cascading through every suite that needed a
  user.

### Writing tests here

Follow the existing shape: integration tests import factories from
`test/integration/factories.ts` and assert against real rows. Unit tests mock only at **package
boundaries** — see `src/services/__tests__/supabase.storage.test.ts:9-11`, which mocks
`@supabase/supabase-js` itself rather than an internal seam, so the real method bodies still
execute.

### Current coverage (verified via `npx jest --coverage`)

Overall: **58.6%** statements / 54.83% branches / 57.36% functions / 59.54% lines.

| File | Stmts % | Status |
|---|---:|---|
| `src/services/squadService.ts` | **100** | done |
| `src/services/supabase.ts` | **99.65** | done (characterization) |
| `src/utils/*` | 98.6 | strong |
| `src/services/lineupEfficiency.ts` | 100 | |
| `src/services/boxScoreParser.ts` | 100 | |
| `src/routes/squads.ts` | 92 | |
| `src/routes/auth.ts` | 92.45 | |
| `src/services/authService.ts` | 90 | |
| `src/routes/admin.ts` | 85.91 | |
| `src/routes/analytics.ts` | 71.95 | |
| `src/routes/screenshots.ts` | 48.37 | 1,086 lines |
| `src/errors/index.ts` | 36 | |
| `src/services/ollamaExtractor.ts` | 18.02 | |
| `src/services/enhancedOCRService.ts` | 4.49 | |
| `src/middleware/squad.ts` | **0** | security boundary |
| `src/routes/mappings.ts` | **0** | |
| `src/services/mappingService.ts` | **0** | |
| `src/services/gameMoveService.ts` | **0** | |
| `src/server/index.ts` | **0** | |
| `src/config/env.ts` | **0** | |
| `src/services/database.ts` | **0** | 14 lines |

`collectCoverageFrom` is set (`jest.config.ts:35-41`) so entirely-untested files count against the
denominator instead of being invisible. Without it the figure would be flatteringly higher.

**The client has 0% coverage and no test runner installed at all** — no vitest, no
@testing-library. Standing that up is unstarted work.

### Gaps

Two verified structural gaps, detailed in §16: authorization rules are mocked out of the route
suites, and two real-Postgres check scripts are not wired into `npm test`.

There are **no skipped or disabled tests** anywhere (verified by grep over all tracked
`*.test.ts`).

---

## 14. Deployment

**Target:** Render, as a Docker web service, single instance, same-origin (Express serves both the
built SPA and the API).

**Pipeline.** CI (`.github/workflows/ci.yml`) triggers on push to `main` and PRs to `main`, with
two independent jobs:

- `server`: install → `prisma generate` → `prisma validate` → lint → typecheck → test → `build:api`.
  The Prisma steps get dummy `DATABASE_URL` placeholders because Prisma resolves `env()` when
  loading the schema; they never connect.
- `client`: install → lint → typecheck → build.

CI does **not** build the Docker image and does **not** deploy. Deployment is Render building the
`Dockerfile`. The setup procedure is documented at `README.md:311-320`:

1. Create a Render Web Service from the repo (Docker). Health check path `/health`.
2. Set the environment variables — `DATABASE_URL` (pooler `6543`, `?pgbouncer=true`),
   `DIRECT_DATABASE_URL` (`5432`), the Supabase URL and keys, a fresh `JWT_SECRET`, `INVITE_CODE`,
   `NODE_ENV=production`, and the `OLLAMA_*` vars pointing at the Modal host.
3. Deploy — the container applies migrations on boot and serves the SPA and API on `$PORT`.
4. Create the private `screenshots` bucket in Supabase Storage if it does not exist.

`UNKNOWN — whether auto-deploy-on-push is enabled, and the configured instance count. Neither is in
version control; both are dashboard state. The docs say the service **must** run at exactly one
instance (DEV_HANDOFF.md:108), but whether that is actually how it is configured is unverified —
worth confirming in the dashboard, because getting it wrong breaks dedup silently rather than
loudly.`

**The image** (`Dockerfile`): Node 22 base, installs OpenSSL for Prisma, installs both dependency
sets, generates the Prisma client, builds API and client, then prunes dev dependencies and deletes
`client/node_modules`. `sharp` is the only native dependency and ships prebuilt libvips for linux
x64, so no C/C++ toolchain is installed. `DEV_HANDOFF.md:150-152` notes that if a Render build ever
fails on `sharp`, re-add `python3 make g++` to the `apt-get` line.

**On boot** `npm start` runs `prisma migrate deploy` before starting the server, so migrations
apply automatically on deploy.

**Runtime requirements:**
- **Exactly one instance.** `pendingHashes` and the extraction quota counter are in-memory
  (`src/routes/screenshots.ts:40`, `:94`). Adding replicas silently breaks dedup and quotas.
- Health check path `/health`.
- A private `screenshots` bucket must exist in Supabase Storage.

**Graceful shutdown** is implemented (`src/server/index.ts:220-246`): stop accepting connections,
drain in-flight requests, close the pg pool and Prisma, with a 10s force-exit backstop.

**Rollback.** Forward-only migrations; no down-migrations are authored. The rollback strategy is a
Supabase snapshot taken before risky migrations — the free tier has no managed backups, so a
verified-restorable `pg_dump` is the only mechanism. One was taken at
`~/Desktop/scorecheck-backup-20260720-032825.sql` and test-restored. **Restoring loses anything
written after it.**

**Monitoring.** Structured pino logs to stdout, collected by Render. There is **no** APM, no
error-tracking service, and no alerting configured anywhere in the repo — if the app breaks at
3am, nothing pages anyone; you find out by reading Render's logs.

The two client-side error files are **not** telemetry, and I traced both:

- `client/src/lib/error-capture.ts` is entirely **local and in-process**. It stashes the last
  `error` / `unhandledrejection` in a module variable with a 5-second TTL so `client/src/server.ts:33`
  can recover the real stack when h3 has already swallowed the throw into a generic 500. It then
  `console.error`s it. No network call exists in the file.
- `client/src/lib/lovable-error-reporting.ts` calls
  `window.__lovableEvents?.captureException?.(...)` from the TanStack root error boundary
  (`client/src/routes/__root.tsx:44`). **`__lovableEvents` is never defined anywhere in this
  repo** — verified across all tracked files; the only two occurrences are the ambient TypeScript
  declaration and the optional-chained read in that same file. So it is a **no-op** unless the
  Lovable platform injects that global at runtime, which this codebase neither does nor controls.

**Verified: no telemetry leaves the browser from this codebase.** The only external hosts
referenced anywhere in `client/src` are `fonts.googleapis.com` and `fonts.gstatic.com`
(`client/src/routes/__root.tsx:100-104`).

---

## 15. Current state of work

**Branch `codebase-cleanup`** — 2 commits ahead of `main`, 0 behind, in sync with
`origin/codebase-cleanup`. **Working tree is clean; nothing staged or modified.**

| Commit | Date | Contents |
|---|---|---|
| `8bd71b7e` | 2026-07-21 | Deletes: 37 files, 3,680 deletions — dead scripts, pre-baseline migrations, 25 unused shadcn components |
| `8e5e0dc1` | 2026-07-21 | Tests: 9 files, 2,524 insertions — the Postgres integration harness plus characterization suites |

### Done

- The **squad ownership model** is complete and deployed: scope middleware, re-scoped data layer,
  squad-wide dedup with an advisory lock, permissions, invites, join, roster claim, and
  move-between-squads. The client ships a squad switcher, `/squad`, and `/join/$token`.
- The **model host is live on Modal** and the core pipeline is verified end-to-end through the
  running app: a real screenshot goes upload → extract → review → save and lands in analytics.
- **This cleanup branch:** the delete pass, and coverage for the two largest untested services —
  `squadService.ts` 14.6% → **100%** on all four metrics, and `supabase.ts` 36.8% → **99.65%**.

### In progress / next

The active project is **taking the codebase to full test coverage**, then refactoring against that
safety net. The immediate queued item is the **`supabase.ts` refactor**: split 1,236 lines by
entity (users / games / players / aggregates / storage), touching **zero** test files, then re-run
the same 408 tests. The tests were written and committed *first, on purpose*, so `git diff` can
prove the safety net was not adjusted to fit the new code.

**This refactor is unstarted and blocked on a human decision** — the split shape has not been
confirmed. See §18.

### Half-finished, and why

- **Client testing** — 0%, no runner. Not started because the server work was sequenced first.
- **Phases 7–10 of the squad plan** are unbuilt: leave-squad with copy-back, cross-squad career
  view, edit lock, audit log. The last two have **tables in the database that no code touches**
  (`game_edit_locks`, `squad_audit_log`) — the schema is deliberately ahead of the code.
- **Multi-account end-to-end** has never been exercised: two accounts in one squad, A uploads, B
  sees it, B re-uploads the same screenshot and it dedups. Everything single-account is proven.

---

## 16. Known issues & tech debt

Ordered by consequence.

### 1. 🔴 CI will fail on any PR to `main` — no Postgres service container

`npm test` runs both Jest projects; the integration project's `globalSetup` needs Postgres on
55434; `.github/workflows/ci.yml` provides none. **Verified by reproduction:** with no database
reachable, `npx jest --selectProjects integration --ci` exits **1** with
`cannot reach Postgres at localhost:55434`. The unit project alone exits 0.

*Impact:* the branch cannot merge green. *Fix:* add a `services: postgres:17` block to the server
job with `POSTGRES_PASSWORD=int` mapped to 55434 — the harness needs nothing else, since it builds
its schema from the committed migrations (`test/integration/global-setup.ts:6-10`). A stopgap is
`npm test -- --selectProjects unit`, but that abandons 144 tests.

### 2. 🔴 Authorization rules barely execute under `npm test`

The route suites mock the services holding the permission logic:

```
src/routes/__tests__/squads.test.ts             mocks squadService, gameMoveService
src/routes/__tests__/screenshots.delete.test.ts mocks squadService, mappingService
src/routes/__tests__/analytics.test.ts          mocks mappingService
src/routes/__tests__/screenshots.{games,save,upload}.test.ts  mock mappingService
```

So "uploader or OWNER can delete", "a plain member cannot move a game out", and "cross-squad access
is 404" only genuinely run inside `scripts/squad-integration-check.ts` (71 checks) and
`scripts/race-check.ts` — **neither of which is wired into `npm test`** (verified: `npm test` is
bare `jest`; the project roots are `src` and `test/integration`; no npm script references either
file). CI has never run them.

Compounding this, `src/middleware/squad.ts` — the single chokepoint that turns an `X-Squad-Id`
header into a data scope — is at **0% coverage**.

### 3. 🟠 `src/services/supabase.ts` is 1,236 lines and needs splitting

Refactor queued, characterization tests already in place. Blocked on the split-shape decision.

### 4. 🟠 Client is entirely untested — 0%, no infrastructure

17 routes, 3 contexts, and the `api.ts` chokepoint have no tests and no runner.

### 5. 🟡 Bugs deliberately frozen by the characterization tests

These are **pinned as current behavior on purpose** so the refactor diff stays behavior-preserving.
Do **not** fix them during the refactor; they belong in a separate commit afterwards.

- `getGameById` / `getGamesBySquadId` return `[null]`, not `[]`, for a game with no players or
  teams — `json_agg` over a LEFT JOIN.
- `json_agg(DISTINCT ...)` across two LEFT JOINs forms a cartesian product that DISTINCT then
  collapses.
- `createPlayer`'s `|| null` fallbacks for `position`, `playerId`, and `gameIdFromFile` can only
  ever raise NOT NULL violations — they read as optional, but no caller may omit them.
- `updatePlayerTotals` keys on `player_name` while the unique index is `(player_id, squadid)`, so
  two players sharing a name overwrite each other. The live path never hits it because
  `recomputeSquadAggregates` wipes and rebuilds, but the method is unsafe standalone.

### 6. 🟡 Timezone skew on invite expiry

`squad_invites.expiresAt` is `timestamp without time zone`. A 7-day invite measures 7.1667 days
from JavaScript — seven days plus the UTC offset. SQL-side checks (`"expiresAt" > NOW()`) are
correct; any JS-side display is skewed. The tests sidestep it by measuring expiry in SQL rather
than asserting the buggy value.

### 7. 🟡 Three env vars bypass validation

`EXTRACTION_TIMEOUT_MS`, `EXTRACTION_PREFLIGHT_TIMEOUT_MS` (`src/constants/index.ts:24`, `:30`), and
`UPLOAD_PATH` are not in the zod schema. A typo fails silently into a default. See §9.

### 8. 🟡 Two overlapping unique indexes on `player_stats`

`prisma/schema.prisma:296-297`. Harmless but misleading — the three-column index implies a per-team
model that the two-column index forbids. **Note:** an older audit claimed `updatePlayerStats`
"ignores team" and is therefore buggy. **That claim is wrong** — because the two-column index
subsumes the three-column one, keying on `(playerName, squadId)` is exactly correct.

### 9. 🟢 Minor

- One swallowed error: `src/routes/screenshots.ts:253` — `catch {}` around a mappings fetch. The
  lint config permits this (`.eslintrc.json`: `"no-empty": ["error", {"allowEmptyCatch": true}]`).
- `npm run lint` globs only `src/**/*.ts`, so `test/` and `eval/` are never linted by the script or
  CI. `test/` is clean when linted manually.
- 5 lint warnings, all unused variables, in `enhancedOCRService.ts:110` and `mappingService.ts:2`.
- Jest prints *"a worker process has failed to exit gracefully"*. Pre-existing, caused by pino's
  transport worker; `forceExit: true` is set (`jest.config.ts:44`). Worth fixing before any feature
  adds heartbeat timers.
- npm dependencies orphaned by the component deletion and not yet removed:
  `embla-carousel-react`, `react-day-picker`, `input-otp`, `react-resizable-panels`.
- `package.json` `description` says **"NBA 2K25"**; everything else says 2K26.
- **Stale docs.** Three found while verifying claims for this handoff:
  (a) `README.md:340` says the Docker image "includes Node.js, Python, and OpenSSL for Prisma and
  the native `canvas`/`sharp` build" — the Dockerfile installs **only** `openssl`, and `canvas` and
  the Python tooling were removed (`DEV_HANDOFF.md:82`). Verified: no `python` or `canvas` string
  exists in the Dockerfile.
  (b) `DEV_HANDOFF.md` as a whole predates the squad model and the test harness — it claims
  "132 tests / 14 suites" against an actual 408 / 23.
  (c) `FINETUNING_GUIDE.md`'s "Current status" table is flagged stale by `DEV_HANDOFF.md:144`.

---

## 17. Gotchas

**The test database is not in `docker-compose.yml`, and it self-deletes.** The command the harness
prints uses `--rm`, so the container disappears when Docker restarts and must be recreated. If
`npm test` suddenly fails with `cannot reach Postgres`, this is why. The authoritative command
lives at `test/integration/global-setup.ts:26`.

**Never point the integration tests at a real database.** They TRUNCATE every application table
between tests. `test/integration/setup-env.ts` blocks this unconditionally, and that guard has no
override. Do not add one.

**Two data layers must be edited together.** A model change means both `prisma/schema.prisma` *and*
the raw SQL in `src/services/supabase.ts`. Prisma will not catch a mismatch, because it does not
see the raw queries.

**Migrations: never `prisma migrate dev`.** Supabase has no shadow database. Author migrations with
`prisma migrate diff`. History was baselined at `0_init`; pre-baseline migrations were deleted and
are recoverable only from git history.

**`players.team` is not a team name.** It holds a generated composite lineup string such as
`Akif (PG) + AI (SG) + Nillan (SF) + Dylan (PF) + Anis (C)`, and it is stored **equal to**
`games.homeTeam` / `games.awayTeam`. `src/services/lineupEfficiency.ts` joins on
`p.team = g."homeTeam"`. Any code that rewrites player names must regenerate these strings and
update the `games` and `players` rows **together**, or the join silently stops matching and
analytics quietly return nothing. Use the token-based helper in `src/utils/lineupName.ts`; never
string-replace, or renaming "Nil" → "Nill" corrupts "Nillan".

**Single-instance only.** `pendingHashes` and the quota counter are in-memory. Scaling to two
Render instances breaks deduplication and quota enforcement with no error.

**`player_totals` uses lowercase column names** while every other table uses quoted camelCase.

**Ordering requirement in the save path.** `pendingHashes.delete()` must stay *after* the commit
(`src/routes/screenshots.ts:719`). Moving it earlier reintroduces a fixed bug where a failed save
left the game permanently un-dedupable.

**`EXTRACTION_PREFLIGHT_TIMEOUT_MS` defaults to 3000**, which is wrong for Modal. Set it to ~120000
in any environment pointing at a scale-to-zero host, or the first upload after idle 503s.

**Route files have no static importers.** TanStack Start registers them through the generated
`routeTree.gen.ts`. Import-graph tools will report every file in `client/src/routes/` as dead. It
is not.

**`client/.lovable/project.json` and `@lovable.dev/vite-tanstack-config` are the client build
toolchain.** They look like vendor scaffolding; removing them breaks the build.

**Windows CRLF noise.** `core.autocrlf=true` makes client eslint emit ~1080 `Delete ␍` errors
locally. Git stores LF and CI never sees them. Fix with `npx eslint --fix` from `client/`, or
ignore.

**The Grep *tool* has produced false negatives in this repo** — it reported "no matches" for a
string that plain `grep` found immediately. For any dead-code or deletion decision, verify with
Bash `grep` scoped to `git ls-files`. Also beware `grep -r . | grep -v node_modules`, which still
traverses `node_modules` and times out.

**A `graphify` knowledge graph exists at `graphify-out/`, and a PreToolUse hook enforces its use.**
Run `graphify query "<question>"` before grepping source, and `graphify update .` after changing
code. Expect a reminder if you skip it. In practice its output is noisy for narrow questions — it
is genuinely useful for orientation, less so for pinpoint lookups.

**`SESSION_UPDATE.md` looks like a scratch file but is cited by `EVAL_RESULTS.md:4`.** Do not
delete it.

---

## 18. Open questions

These need a human decision or information not present in the repository.

1. **What shape should the `supabase.ts` split take?** The refactor is queued and blocked. The
   characterization tests are written at the *public API boundary*, so where the seams land
   interacts with what the tests pin. The working proposal is users / games / players / aggregates
   / storage, but this has not been confirmed by the owner.

2. **Should the frozen bugs (§16 item 5) be fixed, and when?** The recommendation is a separate
   commit *after* the refactor, so the refactor diff stays provably behavior-preserving. Not agreed.

3. **How should CI get a database?** Adding a service container is the obvious fix, but it makes CI
   slower and introduces a dependency. The alternative — running only the unit project in CI —
   abandons 144 tests including all the real-SQL coverage. Needs a call.

4. **Should `scripts/squad-integration-check.ts` be folded into the Jest integration project?** Its
   71 checks are the only real verification of authorization. Merging them means CI actually runs
   them; it also means maintaining them as tests rather than a script.

5. **Is `src/utils/nameCorrection.ts` dead?** It is measurably unused but reserved by the squad
   plan. It has a test and 97.61% coverage. Keep or delete?

6. **Is the Render service actually configured as one instance, and does it auto-deploy?** The
   intended setup is documented (`README.md:311-320`) and the one-instance requirement is explicit
   (`DEV_HANDOFF.md:108`), but the live dashboard state is not in version control and I could not
   verify it. This matters more than it looks: a second instance breaks deduplication and quota
   enforcement **silently**, with no error anywhere. Worth confirming, and worth capturing as a
   `render.yaml` so it stops being undocumented truth.

7. **Should the repo adopt any review gate?** Established above: this is a solo project with no
   review process, so CI and the test suite are the only things standing between a mistake and
   `main`. That is a defensible choice for a personal project — but it is *why* the broken CI in
   §16 item 1 is the top priority rather than a nuisance.

**Resolved during this investigation** (previously open, now answered — recorded so nobody
re-investigates them):

- *Where do the client error modules send data?* Nowhere. Both traced; see §14 Monitoring.
  `error-capture.ts` is local-only; `lovable-error-reporting.ts` is a no-op because
  `__lovableEvents` is never defined in this repo. Only external hosts in the client are Google
  Fonts.
- *Is `UPLOAD_PATH` vestigial?* Yes, confirmed dead — one occurrence, in `env.example:51`, read by
  nothing. See §9.
- *Code review norms?* None exist; solo project, 3 self-merged PRs ever. See §12.

---

## 19. Suggested next steps

Prioritized. The first is a blocker; the rest follow the owner's stated goal of full coverage,
then refactoring against it.

**1. Fix CI (blocking, ~30 minutes).** Add a Postgres service container to the `server` job in
`.github/workflows/ci.yml`. Nothing merges green until this lands. The harness needs only a bare
`postgres:17` with `POSTGRES_PASSWORD=int` on port 55434; it builds its own schema from the
committed migrations.

**2. Test `src/middleware/squad.ts` (~1 hour, highest value per line).** 63 lines, currently 0%,
and it is the single security chokepoint for every data route. Cover: a spoofed `X-Squad-Id` for a
squad the user does not belong to, an array-valued header (`src/middleware/squad.ts:40`), the
`SquadError` → status passthrough, the missing-`req.user` 401, and `requireSquadId` throwing when
the middleware has not run. The integration harness already supports this.

**3. Test `gameMoveService.ts` and `mappingService.ts` (~half a day).** Both at 0%, and between
them they hold the merge guard, name reconciliation, and aggregate recompute — the logic most
likely to corrupt data silently. Real-Postgres integration tests.

**4. Fold `scripts/squad-integration-check.ts` into the Jest integration project (~2 hours).** Its
71 checks are the only genuine verification of the permission model. As a script, CI never runs
them.

**5. Then the `supabase.ts` refactor** — once question 1 in §18 is answered. Touch zero test files;
re-run the same 408 tests; let `git diff` prove the safety net was untouched.

**6. Stand up the client test stack** (vitest + @testing-library/react + jsdom + coverage), then
test `client/src/lib/api.ts` first — it is the chokepoint every request passes through.

Deliberately **not** first: `src/routes/screenshots.ts` (48%, 1,086 lines) and `ollamaExtractor.ts`
(18%). Both are large, and `screenshots.ts` likely wants the same characterization-then-refactor
treatment `supabase.ts` got — a much bigger unit of work than items 2–4.

---

## 20. Glossary

| Term | Meaning |
|---|---|
| **Squad** | A group of users sharing one pool of games, mappings, and analytics. The ownership scope for **all** data. Every user has a personal squad of one. |
| **Team** | Ambiguous — three meanings. (1) The `teams` table: per-game home/away totals. (2) `players.team`: a **generated composite lineup string**, not a team name. (3) "Matchups" in the client nav, renamed from "Teams" so it would not read as a synonym of Squad (`client/src/components/app-shell.tsx`). |
| **Personal squad** | The auto-created `isPersonal = true` squad every user gets at signup. Holds unshared data. |
| **Gamertag** | The in-game handle the model reads off a screenshot. The stable identity used when moving games between squads. |
| **Display name** | The human-readable name a gamertag maps to within one squad, via `player_mappings`. |
| **Mapping / roster entry** | A `player_mappings` row: gamertag → display name, scoped to a squad, optionally linked to an app user via `linkedUserId`. |
| **Lineup string** | The composite `players.team` value, e.g. `Akif (PG) + AI (SG) + …`, in position order. Drives lineup-efficiency analytics. |
| **Perceptual hash / dhash** | A 60-char fingerprint of a screenshot (`src/utils/imageHash.ts`) used for fuzzy duplicate detection within a squad. |
| **Hamming distance** | Bit-difference between two perceptual hashes. Below `DUPLICATE_HAMMING_THRESHOLD` counts as the same game. |
| **Junk filter** | A `minicpm-v` pre-check that the uploaded image is actually a box score. **Fails open.** |
| **Extraction** | Running the fine-tuned vision model over a screenshot to produce structured stat lines. ~22s warm. |
| **Team-split inference** | Running extraction on two half-image crops rather than the full image — how the round-5 fine-tune was trained. |
| **Aggregates** | The denormalized `player_totals` and `player_stats` tables, rebuilt wholesale by `recomputeSquadAggregates`. |
| **Characterization test** | A test that pins **current** behavior, bugs included, so a refactor can be proven behavior-preserving. Distinct from a specification test, which asserts intended behavior. |
| **Mutation testing** | Deliberately breaking source to confirm the right test fails, then reverting. Used repeatedly here to prove tests actually bite. |
| **`pendingHashes`** | In-memory `Map` bridging upload-time and save-time dedup. Pins the app to one instance. |
| **Graphify** | The knowledge-graph tool at `graphify-out/`, enforced by a PreToolUse hook. |
| **Modal** | The serverless-GPU provider hosting the Ollama model endpoint (`deploy/modal/`). |
| **`scorecheck-ocr-r5`** | The fine-tuned Qwen2.5-VL-3B extraction model. ~84.6% accuracy on holdout. |
