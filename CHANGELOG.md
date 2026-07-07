# Changelog

---

## [Unreleased] — 2026-06-29 (Lovable frontend sync)

### Feature — 4 new route pages (`client/src/routes/`)

Added the four Lovable-generated pages to the live app, wired to real endpoints where available:

- `teams.tsx` — standings table wired to `GET /api/analytics/teams`; columns: GP/W/L/Win%/PPG/FG%/3P%. PA/Diff skipped (endpoint doesn't return points-against yet).
- `games.index.tsx` + `games.tsx` layout — games list converted from card grid to a table with links to per-game detail. `games.tsx` is now a passthrough layout (`<Outlet />`).
- `games.$gameId.tsx` — full per-player box score wired to `GET /api/screenshots/games/:id`. Remaps API field names (`points`, `rebounds`, etc.) to display columns. Skips `min`, `ocrConfidence`, `status` (not in API response).
- `eval.tsx` — static benchmark harness (mock data; no eval-run API exists yet).
- `settings.tsx` — static settings page (OCR pipeline selector, notification toggles; UI only).

### Feature — Login page redesign (`client/src/routes/login.tsx`)

Applied Lovable's two-panel visual layout to `/login` while preserving all real auth wiring (`useAuth`, `demoLogin`, redirect guard). Added a muted "Skip (Dev)" button that calls the same demo session. Route path unchanged.

### Feature — App shell nav merge (`client/src/components/app-shell.tsx`)

Added Teams(06), Eval harness(08), Settings(10) to the sidebar nav; reordered Games to 03. Logo is now a `<Link to="/">`. Breadcrumb handles `/games/$gameId` sub-paths ("Games / Game detail"). Auth guard, real user footer, and logout button unchanged.

### Chore — Delete `_frontend_update/` Lovable clone

Reference clone removed after sync is complete.

---

## [Unreleased] — 2026-06-25 (Fine-tuning pipeline + Ollama bug workarounds)

### Fix — Ollama extraction broken in 0.30.x (`src/services/ollamaExtractor.ts`, `src/services/junkFilter.ts`)

`qwen2.5vl:*` models return `@@@` garbage for all vision requests in Ollama 0.30.x due
to a bug in the `qwen25vl` architecture image-token handler. Switched both the extractor
and junk filter to `minicpm-v:latest` as a working workaround. Switched API endpoint from
`/api/generate` to `/api/chat` (correct for instruction-tuned chat models) and added
`format: "json"` to eliminate markdown wrapping and JSON truncation.

### Fix — Stale model constants (`src/constants/index.ts`)

`OLLAMA_EXTRACTION_MODEL` and `OLLAMA_JUNK_FILTER_MODEL` were hardcoded to `qwen2.5vl:7b`
and unused — services redeclared their own string literals. Refactored so both services
import from `@/constants`. Update these two constants when `scorecheck-ocr:latest` is ready.

### Feature — Fine-tuning infrastructure (`scripts/`)

Added the full pipeline to train a custom `scorecheck-ocr` model on labeled box score
screenshots and deploy it via Ollama:

- `scripts/add_training_example.ts` — interactive CLI that runs `minicpm-v` on a new
  screenshot, lets the user accept or correct the extraction, and saves to
  `eval/training_data.json`. Alias: `npm run label -- eval/screenshots/IMG_XXXX.JPG`.
- `scripts/export_dataset.py` — converts `training_data.json` + screenshots to
  HuggingFace VLM JSONL format (80 / 20 train/val split). Alias: `npm run export:dataset`.
- `scripts/finetune.py` — QLoRA fine-tuning via unsloth on `Qwen/Qwen2.5-VL-3B-Instruct`,
  exports GGUF (Q4_K_M) when done. Aliases: `npm run finetune`, `npm run finetune:export`.
- `scripts/requirements_finetune.txt` — ML deps (install separately from project venv).
- `Modelfile` — packages the GGUF for Ollama with temperature 0 and a hardwired system prompt.
- `FINETUNING_GUIDE.md` — end-to-end instructions for collecting data, training, and deploying.

**Status:** infrastructure ready; 5 training examples collected (30+ needed before training).

---

## [Unreleased] — 2026-06-24 (Ollama timeout fix)

### Fix — Ollama extractor timeout too short (`src/services/ollamaExtractor.ts`)

Increased `TIMEOUT_MS` from `60_000` to `600_000` (60 s → 600 s / 10 min).

**Root cause:** qwen2.5vl:7b on CPU processes 4K (3840×2160) images with the
full extraction prompt in ~181 seconds. The 60-second AbortController fired
before the model responded, causing 5/5 parse failures with 0.00 s reported
latency in the eval harness.

**Diagnosis:**
1. `AbortError` (TIMEOUT) confirmed for every image — 60 s / 120 s too short.
2. Raw `node` test against `qwen2.5vl:7b` with the actual extraction prompt
   returned HTTP 200 with valid 10-player JSON — after **180.8 seconds**.
3. `TIMEOUT_MS` raised to 600 s to cover response-time variance across images.
4. Secondary root cause found: Ollama's internal model runner (Windows, GPU)
   crashes mid-inference returning HTTP 500 `"wsarecv: An existing connection
   was forcibly closed by the remote host"`. After crash, subsequent requests
   get immediate 500s until the runner recovers (~15 s).

**Additional fix — retry on HTTP 500:**
Added `MAX_RETRIES = 3` loop with `RETRY_DELAY_MS = 30_000` (30 s) backoff.
On HTTP 500, the loop waits 15 s for Ollama's model runner to restart, then
retries. Timeouts are not retried. All diagnostic logs removed.

---

## [Unreleased] — 2026-06-23 (gamertag mapping system)

### Feature — Gamertag → Display Name mapping (Phases A–F)

Adds a per-user `PlayerMapping` table that silently replaces known gamertags with
real display names during OCR extraction, before the review table is shown to the
user. Opponents and AI players are extracted as-is.

**Phase A — DB schema and seed**
- Added `PlayerMapping` Prisma model (`player_mappings` table) with
  `@@unique([userId, gamertag])` constraint and `@@index([userId])`.
- Applied table via raw SQL (`pg` Client) since `prisma migrate dev` requires
  interactive mode. `prisma db push` was rejected to avoid dropping untracked
  production columns on `players`/`teams` tables.
- Added `prisma/seed-mappings.ts` — upserts 8 known crew gamertags for the demo
  user (`dev.user@scorecheck.com`).

**Phase B — Service and API routes**
- `src/services/mappingService.ts` — CRUD (`getMappingsForUser`,
  `listMappingsForUser`, `createMapping`, `updateMapping`, `deleteMapping`) plus
  `applyMapping(rawName, mappings)` with exact-then-substring fallback.
- `src/routes/mappings.ts` — REST routes `GET/POST /api/mappings`,
  `PUT/DELETE /api/mappings/:id`. Validates gamertag (no spaces, max 50 chars).
  Returns 409 on duplicate gamertag, 404 on missing ID.
- `src/server/index.ts` — registers `/api/mappings` router.

**Phase C — Wire mappings into extraction and eval**
- `src/routes/screenshots.ts` — fetches mappings for the authenticated user before
  calling OCR; fail-open (logs error and proceeds with no mappings if DB fails).
- `src/services/enhancedOCRService.ts` — `extractStructuredDataFromImage` now
  accepts optional `mappings?: Map<string, string>` and applies `applyMapping` to
  each extracted player name.
- `eval/run_eval.ts` — loads demo-user mappings from DB before eval loop; passes
  mappings to GCV pipeline and `compareExtracted`; resolves ground-truth gamertags
  to display names for name comparison; tracks mapped vs unmapped player counts.

**Phase D — Frontend Roster page**
- `client/src/routes/roster.tsx` — full CRUD page at `/roster`. TanStack Query v5
  for data fetching, react-hook-form + zod for validation, sonner for toasts.
  Inline editing (no modals), inline delete confirmation.
- `client/src/routeTree.gen.ts` — registered `/roster` route.
- `client/src/components/app-shell.tsx` — added Roster nav entry (code 04).
- `client/src/routes/__root.tsx` — wired `<Toaster position="bottom-right" richColors />`.
- `client/src/lib/api.ts` — added `del` method.

**Phase E — Eval mapping breakdown**
- `eval/run_eval.ts` `printTableResult` now prints a mapping breakdown section:
  mapped player count, unmapped player count, accuracy for mapped players only,
  and overall accuracy.

**Phase F — Housekeeping**
- `src/constants/index.ts` — updated `ALLOWED_PLAYER_NAMES` comment to clarify it
  is a reference list for analytics routes, not an extraction filter.

**New script:**
```
npm run seed:mappings   # upsert demo-user crew gamertags
```

---

## [Unreleased] — 2026-06-23 (pipeline bug fixes)

### Fix 1 — Pass 1 preprocessing now actually runs (PIPELINE.md Known Issue #1)

**Root cause:** `preprocessImageWithPython()` in `enhancedOCRService.ts` passed
`--unique-id <random>` to `python_ocr_wrapper.py`, but argparse had no such
argument. Python exited with code 2 (unrecognised argument), Node fell back to
the raw unprocessed buffer. CLAHE+Otsu preprocessing never ran on Pass 1.

**Fix:** Added `parser.add_argument('--unique-id', help='...')` to
`python_ocr_wrapper.py` (Option A — one line; argument is accepted and ignored).
Added an INFO-level log line in the success branch of `preprocessImageWithPython`
so Pass 1 success is now visible in server logs:
`"Pass 1 (CLAHE+Otsu) preprocessing succeeded"`.

**Files changed:**
- `python_ocr_wrapper.py` — added `--unique-id` to argparse
- `src/services/enhancedOCRService.ts` — added success log line in `preprocessImageWithPython`

---

### Fix 2 — Unique temp files per preprocessing call (PIPELINE.md Known Issue #2)

**Root cause:** All 4 Python preprocessing passes wrote the input image to the
same hardcoded path (`<project_root>/temp_input.jpg`). Concurrent uploads would
overwrite each other's temp file mid-processing, producing corrupted OCR results.

**Fix:** Each preprocessing call now generates a unique path using
`crypto.randomUUID()`:
```
temp_input_<uuid>.jpg
```
Cleanup moved from the start of the `close` handler to a `try/finally` block so
the file is deleted on success, failure, and parse errors. The `error` handler
(Python spawn failure) also deletes the temp file. `crypto` imported at the top
of `enhancedOCRService.ts`.

**Files changed:**
- `src/services/enhancedOCRService.ts` — all 4 preprocessing functions
  (`preprocessImageWithPython`, `generateThresholdImage`,
  `createEnhancedPreprocessing`, `createMultiLevelPreprocessing`): unique temp
  path + try/finally cleanup + error-handler cleanup

---

## [Unreleased] — 2026-06-23

### Phase 4, Stage 3 — Professional Code Quality Audit (2A–2I)

---

#### 2A — TypeScript hygiene

**`src/types/index.ts`**
- `ApiResponse<T = any>` → `ApiResponse<T = unknown>`.
- `gameHighs: { points: any[] }` → `{ points: PlayerStats[] }`.

**`src/routes/screenshots.ts`**
- Fixed latent bug: `(req.user as any).id` was always `undefined` (JwtPayload has `userId`, not `id`); removed cast, uses `req.user.userId` directly.
- Introduced `IncomingPlayerData` interface for `/save` request body, replacing `any[]`.
- `playerNumMatch[1]` → `playerNumMatch?.[1] ?? ...` to satisfy `exactOptionalPropertyTypes`.

**`src/routes/analytics.ts`** — removed inline `ALLOWED_PLAYER_NAMES` literal (now imports from constants).

---

#### 2B — Error handling

**`src/errors/index.ts`** — new file with 6 typed error classes: `DatabaseError`, `GoogleVisionError`, `OllamaError`, `PreprocessorError`, `ValidationError`, `AuthenticationError`. All optional fields use `readonly field: type | undefined` (required by `exactOptionalPropertyTypes: true`).

**`src/services/supabase.ts`** — `pgClient.connect().catch(console.error)` → `pgClient.connect().catch(err => logger.error({ err }, '...'))`.

---

#### 2C — Logging

**`src/utils/logger.ts`** — new file. pino logger with `LOG_LEVEL` env var, dev/prod transport switch, and credential redaction (`authorization`, `identityToken`, `authorizationCode`, `privateKey`, `token`).

Replaced or removed 232 console.log/error/warn calls across 12 files. Notable: `appleAuth.ts` was logging raw Apple identity tokens in plaintext — removed.

Protected files (constraint): `enhancedOCRService.ts` (189 logs) and `boxScoreParser.ts` (15 logs) untouched.

---

#### 2D — Security

**`src/routes/screenshots.ts`**
- Added `validateMagicBytes()` using `file-type@16` (last CommonJS-compatible version) — called before junk filter and OCR; rejects files with unexpected magic bytes (HTTP 422).
- Added `uploadRateLimit` (10 req/min/IP) on `/upload` and `/upload-multiple`.

**`package.json`** — added `file-type@16.5.4`.

---

#### 2E — Code structure

**`src/constants/index.ts`** — new file. Centralises `ALLOWED_PLAYER_NAMES`, Ollama model names + timeouts, file upload constraints, rate limit parameters, HTTP status codes, pagination defaults, GCV cost.

**`src/routes/screenshots.ts`** — removed dead outer `updatePlayerStats` function (~130 lines that were never called — shadowed by the inner function in the `/save` route).

---

#### What was NOT changed in Stage 3

- `enhancedOCRService.ts` and `boxScoreParser.ts` extraction logic untouched.
- `ollamaExtractor.ts` remains eval-only (no production wiring).
- No database schema changes; no frontend changes.
- `file-type@16` is the only package version change (justified by ESM incompatibility of v22+).
- Full audit findings documented in `QUALITY_REPORT.md`.

---

### Stage 3 Upgrade — Testing, Transactions, Hashing, Analytics (Phases A–E)

---

#### Phase A — Logging cleanup

Replaced remaining `console.*` calls in `src/routes/screenshots.ts` with pino structured logger (`logger.debug`, `logger.warn`, `logger.error({ err }, ...)`).

---

#### Phase B — Minimum viable test coverage

**`jest.config.ts`** — new file. ts-jest preset, `@/` module alias, `roots: ['<rootDir>/src']`, `forceExit: true` (prevents pino worker thread from hanging Jest).

**`src/services/__tests__/boxScoreParser.test.ts`** — 29 tests for `BoxScoreParser.parse()`: team assignment, position mapping, gameId extraction, playerId assignment, shooting percentages, team stat totals, quarter totals.

**`src/routes/__tests__/screenshots.save.test.ts`** — 10 integration tests for `POST /save` using supertest: happy path, duplicate detection, validation (3 cases), transaction errors, updatePlayerStats error isolation.

**`src/services/__tests__/junkFilter.test.ts`** — 9 tests for `classifyScreenshot` with `global.fetch` mocking: yes/no/ambiguous model responses, network failure, AbortError timeout, HTTP errors, JSON parse failure, latencyMs.

**`package.json`** — added `supertest` and `@types/supertest` as devDependencies (only practical way to test Express routes; no viable alternative).

---

#### Phase C — Database transaction fix

**`src/services/supabase.ts`** — new `saveGameWithStats(gameData, playersData, homeTeamData, awayTeamData)` method. Wraps `createGame` + `createPlayer × N` + `createTeam × 2` in a `pgClient` `BEGIN`/`COMMIT`/`ROLLBACK` transaction. Uses raw pgClient (not Prisma.$transaction) because the Prisma schema is missing `fg_percentage`, `three_percentage`, `ft_percentage` columns for Player and Team.

**`src/routes/screenshots.ts`** — `/save` route now pre-generates `gameId = \`game_\${Date.now()}\`` before the transaction, pre-computes all player and team inputs (with shooting percentages), then calls `saveGameWithStats` for atomic write. `updatePlayerStats`/`updatePlayerTotals` inner functions remain outside the transaction (fail-open).

**`src/routes/__tests__/screenshots.save.test.ts`** — updated to mock `saveGameWithStats` instead of `createGame/createPlayer/createTeam`; added "does not call updatePlayerStatsFromTotals when the transaction fails" test.

---

#### Phase D — Perceptual hash deduplication

**`src/utils/imageHash.ts`** — new file:
- `computePerceptualHash(imageBuffer: Buffer): Promise<string>` — 16×16 dhash using sharp (already a dependency); 240 bits → 60-char hex.
- `hammingDistance(hashA: string, hashB: string): number` — XOR-and-popcount over hex byte pairs.

**`prisma/schema.prisma`** — added `imageHash String?` to the `Game` model. Migration SQL: `ALTER TABLE "games" ADD COLUMN "imageHash" TEXT;` — see "Needs human review" below.

**`src/services/supabase.ts`**:
- `pgClient` exported (was module-private).
- `getGameHashesByUserId(userId)` — returns all non-null `imageHash` values for a user's games.
- `createGame` — updated INSERT to include `imageHash` column.

**`src/routes/screenshots.ts`**:
- Module-level `pendingHashes = new Map<string, string>()` bridges hashes from upload to save time (single-instance; lost on restart — see "Needs human review").
- Both `/upload` and `/upload-multiple`: compute hash after magic-bytes check; query existing hashes; 409 `{ code: 'DUPLICATE_SCREENSHOT' }` if any stored hash has Hamming distance ≤ 10. Store hash in `pendingHashes` keyed by the upload URL.
- `/save`: retrieve hash from `pendingHashes.get(imageUrl)`, delete from map, pass as `imageHash` to `saveGameWithStats`.

**`src/utils/__tests__/imageHash.test.ts`** — 9 tests: hash is 60-char hex, uniform image → all-zeros, deterministic output, 1-bit-difference test, hammingDistance zero/240/exact-count/throws/symmetric.

---

#### Phase E — Lineup efficiency analytics

**`src/services/lineupEfficiency.ts`** — new file:
- `LineupEfficiency` interface: `players`, `team`, `games`, `wins`, `losses`, `avgPointDifferential`.
- `getLineupEfficiency(userId, db, minGames=2)` — CTE query: groups players by game+team into lineup arrays, computes per-game point differential (home perspective for home team, away for away), aggregates across lineups, filters `HAVING COUNT(*) >= minGames`, orders by `avgPointDifferential DESC`. Accepts an injected DB client (`Pick<Client, 'query'>`) for testability.

**`src/routes/analytics.ts`** — added `GET /lineups` (mounted at `/api/analytics/lineups`). Returns `{ success: true, data: { lineups } }`.

**`src/services/__tests__/lineupEfficiency.test.ts`** — 6 tests: empty result, row mapping, sort order preserved, userId + default minGames=2 passed to DB, custom minGames override, `avgPointDifferential` coerced from pg numeric string to JS number.

---

#### What was NOT changed in Stage 3 Upgrade

- `enhancedOCRService.ts` and `boxScoreParser.ts` extraction logic untouched.
- `ollamaExtractor.ts` remains eval-only.
- No frontend changes.
- No new runtime npm packages; only `supertest` + `@types/supertest` added as devDependencies.

---

### Phase 4, Stage 2 — Ollama integration (junk filter + benchmarking)

---

#### Phase A — Re-verification (no changes needed)

Confirmed `.gitignore`, `git log`, README fixes, and `env.example` from Stage 1 all intact.

---

#### Phase B — Eval harness expansion

**`.gitignore`**
- Added `eval/junk_samples/*` with `!eval/junk_samples/.gitkeep` exception.

**`eval/junk_samples/.gitkeep`** — new file, tracks the empty directory.

**`eval/run_eval.ts`** — major rewrite:
- Added `--pipeline=gcv|ollama|both` flag (default `gcv`).
- Added `--format=table|json` flag (default `table`).
- Added `--threshold N` flag (default `90`).
- Added `NormalisedPlayer` interface bridging both pipeline outputs.
- Added `PipelineResult` aggregate type with per-field accuracy counters.
- `runGCVOnImage()` — wraps `EnhancedOCRService`, maps `Player[]` → `NormalisedPlayer[]` via slot position.
- `runOllamaOnImage()` — lazy dynamic import of `src/services/ollamaExtractor`; falls through to error if Phase D module absent.
- `compareExtracted()` — core slot-based (GCV) or name-based (Ollama) comparison logic.
- `printBenchmarkTable()` — Phase E side-by-side table with GCV cost calculation (`$0.006/image`).
- `printJSONResult()` — machine-readable JSON output mode.

**`eval/run_junk_filter_eval.ts`** — new file:
- Scans `eval/screenshots/` (valid images, expect accept) and `eval/junk_samples/` (junk, expect block).
- Reports true-positive, false-positive, false-negative rates and avg latency.
- Exits non-zero on any false negative (blocking a legitimate upload is a hard failure).
- Lazy import of `src/services/junkFilter` — exits with a clear message if Phase C not done.

**`eval/README.md`** — rewritten:
- Documents both eval scripts, folder layout, ground_truth.json shape, matching strategies, and GCV cost.

**`eval/ground_truth.json`** — populated with 5 games (50 player entries), cross-verified against TOTAL rows.

**`eval/tsconfig.json`** — created to support ts-node path alias resolution for eval scripts.

---

#### Phase C — Junk filter

**`src/services/junkFilter.ts`** — new file:
- `classifyScreenshot(imageBuffer: Buffer): Promise<JunkFilterResult>` — sends image to qwen2.5vl:7b via Ollama HTTP API (`/api/generate`).
- Fail-open policy: timeout (15s), HTTP error, or parse failure → `{ isValidBoxScore: true, confidence: 'low', reason: '...' }`.
- Model warm latency: ~1.5s. Cold load: ~2 min (fails open per policy).
- Note: moondream:latest generates empty responses in Ollama ≥0.30 due to a template/temperature bug; switched to qwen2.5vl:7b.

**`src/routes/screenshots.ts`** — two changes:
- Imported `classifyScreenshot` from `@/services/junkFilter`.
- Added junk filter call in `/upload` (single) route before OCR extraction; returns 422 if `!isValidBoxScore && confidence === 'high'`.
- Added junk filter call in `/upload-multiple` batch loop; throws per-file error on junk detection.

---

#### Phase D — Ollama extraction pipeline (eval only)

**`src/services/ollamaExtractor.ts`** — new file (replaces Phase B stub):
- `extractBoxScore(imageBuffer: Buffer): Promise<OllamaExtractionResult>` — sends image to qwen2.5vl:7b with a structured prompt requesting JSON output.
- JSON extraction handles markdown code fences, raw JSON, and braces-only fallback.
- Number coercion: `Number(v) || 0` — handles strings, null, undefined gracefully.
- 60s timeout via AbortController; throws `OllamaExtractionError` on timeout, HTTP error, or parse failure.
- NOT wired into any production route — eval harness only.

---

#### Phase E — Benchmark table (scaffolded in Phase B, complete)

`printBenchmarkTable()` in `eval/run_eval.ts` produces a side-by-side table when `--pipeline=both`:
- Per-field accuracy for all 14 fields (name + 13 stats).
- Overall accuracy, parse failures, avg latency, est. cost per image.
- Winner annotation by accuracy and by cost.

---

#### Phase F — Housekeeping

**`env.example`**
- Added `OLLAMA_BASE_URL=http://localhost:11434` with install instructions.

**`package.json`**
- Added `"eval:both"` script: runs eval with `--pipeline=both`.
- Added `"eval:junk"` script: runs `eval/run_junk_filter_eval.ts`.

**`README.md`**
- Added **Upload Pipeline Architecture** section with ASCII diagram of the full upload flow.
- Added **Pipeline Comparison** table in the OCR Accuracy section.
- Updated **Implementation Status** checklist for junk filter and Ollama benchmarking.
- Added Ollama to Tech Stack list.

---

### What was NOT changed in Stage 2

- `src/services/enhancedOCRService.ts` — extraction logic untouched.
- `src/services/boxScoreParser.ts` — untouched.
- `ollamaExtractor.ts` is not wired into any production route.
- No database schema changes.
- No frontend changes.

---

## [Unreleased] — 2026-06-20

### Phase 4, Stage 1 — Credential hygiene (Gap 2) + Eval harness scaffolding (Gap 1)

---

#### Part A — Credential hygiene

**`.gitignore`**
- Confirmed `.env` and `service-account-key.json` were already listed. No changes needed.
- Added `eval/screenshots/*` (with `!eval/screenshots/.gitkeep` exception) so labeled screenshot images are not accidentally committed.

**`git log` finding**
- Neither `.env` nor `service-account-key.json` has ever appeared in any commit in this repository. No history-rewriting is needed.

**`README.md`** — multiple fixes:
- Removed "achieving 100% accuracy" from the project description (line 3).
- Rewrote the Project Overview paragraph to describe what the app actually does rather than citing a single-image OCR test result.
- Replaced the "Apple Integration: Seamlessly import…" key-feature bullet (the iCloud feature does not exist — `ICloud2FA.tsx` is a stub) with an accurate "Screenshot Upload" bullet.
- Removed the "100% OCR Accuracy" key-feature bullet; replaced with "High-Accuracy OCR … (see `eval/` for measured accuracy)".
- Removed "iCloud 2FA Support" from the key-features list (it is a UI-only stub).
- Rewrote the "OCR Results" section to clearly caveat that the 99.2% / 100% figures were measured on two specific development test images, and to direct users to the new eval harness for a rigorous number.
- Fixed the "Configuration" section in Project Structure: removed `service-account-key.json` as a listed tracked file; replaced with a warning that it must never be committed; promoted `env.example` as the canonical configuration reference.
- Replaced the "Success Metrics" footer (which claimed "100% OCR Accuracy Achieved") with an accurate "Implementation Status" checklist.

**`env.example`**
- Added a prominent warning banner at the top instructing users to copy to `.env` and never commit it.
- Added one-line comments on each variable explaining where to obtain the value (Supabase dashboard, Google Cloud Console, Apple Developer portal, `crypto.randomBytes`).

---

#### Part B — Eval harness scaffolding

**New files:**

| File | Purpose |
|---|---|
| `eval/screenshots/.gitkeep` | Keeps the empty screenshots dir in version control |
| `eval/ground_truth.json` | Starts as `[]`; each entry maps a screenshot filename to correct player stats |
| `eval/tsconfig.json` | Standalone TypeScript config for `ts-node` — sets `baseUrl: ../src` so `@/` path aliases resolve correctly |
| `eval/run_eval.ts` | The evaluation harness |
| `eval/README.md` | Instructions for adding labeled examples and running the script |

**`eval/run_eval.ts` — what it does:**
- Loads `.env` via `dotenv` before any module initialisation (so `EnhancedOCRService` gets Google Cloud credentials).
- Reads `eval/ground_truth.json` and, for each entry, reads the corresponding screenshot from `eval/screenshots/`.
- Calls `EnhancedOCRService.extractStructuredDataFromImage()` — the same function the app uses on every upload — so the measurement reflects real pipeline behaviour with no mocking.
- Matches extracted players to ground truth entries by **slot position** (row 1–10 in the box score), not by name, so stat accuracy is measured independently of name recognition accuracy.
- Compares 13 stat fields per player: `points`, `rebounds`, `assists`, `steals`, `blocks`, `turnovers`, `fouls`, `fgMade`, `fgAttempted`, `threeMade`, `threeAttempted`, `ftMade`, `ftAttempted`.
- Measures name accuracy separately (case-insensitive substring match).
- Prints a per-field accuracy table, an overall accuracy percentage, and a full mismatch list.
- Exits non-zero if overall accuracy falls below the configurable threshold (default 90%). This allows the script to gate CI once tests are wired up.
- Handles zero entries gracefully (exits 0, prints a help message).

**`package.json`**
- Added `"eval"` script: `ts-node -r tsconfig-paths/register --project eval/tsconfig.json eval/run_eval.ts`

---

### What was NOT changed in this stage

- No extraction logic in `enhancedOCRService.ts` was modified.
- No database schema changes.
- No frontend changes.
- The labeled screenshot dataset itself was not added (to be populated manually per `eval/README.md`).
- No other gaps from `GAPS.md` were started.
