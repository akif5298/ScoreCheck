# ScoreCheck — Session Update (2026-07-17, continued)

Follow-up to `SESSION_SUMMARY.md`: made team-split extraction the production
default and trained Round 5 on team-half crops.

## 1. Team-split wired into `src/services/ollamaExtractor.ts`

`extractBoxScore` now tries 2 parallel team-half calls first for
`scorecheck-ocr*` models (was: single-pass full-image first, crop pipeline
as fallback). Per-row retry for any half returning <5; full-image is now
the fallback, only used if team-split fails outright.

Caught and fixed two bugs while matching this to `scripts/team_split_probe.mjs`
(the experiment that proved the approach):
- New team-half calls were round-tripping through a JPEG-quality-90
  intermediate (reused from the old generic-model compositing helper)
  before re-encoding to PNG — a lossy step on exactly the small gamertag
  text. Fixed to PNG-only, matching training.
- Production was compositing the shared column-header row onto Team B's
  crop; the probe (and now production) does **not** — both crops naturally
  include their own header at the top edge.

`alignBySlots` generalized to take a `slotCount` param (10 for full-table,
5 for a team-half) so missing-row padding works at either scale.

## 2. New dataset export: `scripts/export_dataset_teams.py`

Splits each of the 38 labeled screenshots into Team A / Team B crops (same
region coords as production, no header compositing), using each player's
existing `team` field and converting global slot 1-10 → local slot 1-5.
80/20 split at the screenshot level (never splits one image's two halves
across train/val). Output: 76 PNGs in `eval/team_screenshots/`, 60 train /
16 val JSONL examples.

## 3. Round 5 training

```
python scripts/finetune.py --train eval/finetune_train_teams.jsonl \
  --val eval/finetune_val_teams.jsonl --output scorecheck-ocr-r5 \
  --no-table-crop --img-size 1280 --epochs 10
ollama create scorecheck-ocr-r5:latest -f Modelfile-r5
```

`Modelfile-r5` drops the old "always extract exactly 10 players" SYSTEM
line (R4b's Modelfile) since it contradicted the 5-player team-half prompt.

## 4. Results (frozen 10-image holdout, official/name-matched)

| Round | Config | Official | Latency |
|---|---|---|---|
| R4b, deployed (before today) | Full-image single-pass | 77.9% | 21–29s |
| R4b, production (today's rewiring) | Team-split, no retrain | 83.0% | 23s |
| Probe (uncommitted script) | R4b + team-split (OOD) | 84.4% | 33s |
| **R5** | **Trained on team-half crops + team-split** | **84.6%** | **22s** |

Per-field, R5 fixed exactly the weakness the probe exposed: blocks 67%→81%,
fouls 60%→80% (both were out-of-distribution on 5-row crops before). Turnovers
dipped 90%→85% — worth watching, small sample.

## 5. Deployed

`OLLAMA_EXTRACTION_MODEL` now defaults to `scorecheck-ocr-r5:latest`
(env-overridable). The app's extraction path: junk filter (minicpm-v) →
2 parallel team-half calls @ 1280px PNG → per-row retry on short halves →
full-image fallback. 84.6% official / ~22s per upload.

## 6. Housekeeping

- `scripts/team_split_probe.mjs` deleted — subsumed by production + `npm run eval`.
- Verified post-flip: typecheck clean, 116 tests / 12 suites pass.
