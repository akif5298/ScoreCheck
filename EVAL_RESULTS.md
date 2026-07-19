# ScoreCheck — OCR Extraction Eval Results

**As of:** 2026-07-17 (Round 5 model, deployed)
**Sources:** `SESSION_UPDATE.md`, `src/constants/index.ts`, `src/services/ollamaExtractor.ts`, `eval/` harness.

> These are the numbers for the **currently deployed** extraction model
> (`scorecheck-ocr-r5:latest`). Note: the "Current status" table in
> `FINETUNING_GUIDE.md` is stale (it still reads "not yet trained") — this file
> supersedes it.

---

## Headline

| Metric | Value |
|---|---|
| Deployed model | `scorecheck-ocr-r5:latest` (fine-tuned Qwen2.5-VL-3B, QLoRA) |
| **Official accuracy (name-matched, field-level)** | **84.6%** |
| Latency | ~22 s / image |
| Cost | $0 (self-hosted / local) |
| Holdout | Frozen 10-image set (`eval/ground_truth.json`) |
| Junk filter model | `minicpm-v:latest` |

"Official" accuracy = the harness's name-matched field-level score: players are
matched by normalized name (case-insensitive substring), then every stat field
is compared to ground truth. Name accuracy is tracked separately from stat
accuracy (see `eval/README.md`).

---

## How it got here (frozen 10-image holdout, official / name-matched)

| Round | Config | Official | Latency |
|---|---|---|---|
| R4b (previously deployed) | Full-image single-pass | 77.9% | 21–29 s |
| R4b (today's rewiring) | Team-split, no retrain | 83.0% | 23 s |
| Probe (uncommitted) | R4b + team-split (out-of-distribution) | 84.4% | 33 s |
| **R5 (deployed)** | **Trained on team-half crops + team-split** | **84.6%** | **22 s** |

Round 5 is a **+6.7 pp** improvement over the previously deployed model (77.9% →
84.6%) at slightly lower latency, achieved by (a) switching the runtime to two
parallel team-half crops as the primary path and (b) retraining on team-half
crops so the model is in-distribution for 5-row inputs.

### Notable per-field changes (R4b probe → R5)

| Field | Before | After | Note |
|---|---|---|---|
| Blocks | 67% | 81% | was out-of-distribution on 5-row crops |
| Fouls | 60% | 80% | same |
| Turnovers | 90% | 85% | small regression — worth watching (small sample) |

A secondary, laxer metric — **per-cell accuracy** — is recorded in the extractor
docstring at ~**89.7%** for the team-split approach; it counts individual cells
rather than name-matched whole-row fields, so it reads higher than the 84.6%
official figure. Treat 84.6% official as the primary number.

---

## Extraction pipeline (per upload)

```
junk filter (minicpm-v)
   → 2 parallel team-half calls @ 1280px PNG   ← primary (each returns 5 players)
   → per-row retry for any half returning < 5 rows
   → full-image single-pass                    ← fallback, only if team-split fails
```

Team-half crops give the model bigger glyphs and localize missing rows to one
team; a lossy JPEG intermediate and an incorrect header-compositing step were
removed so runtime input matches the training data exactly (PNG, no composited
header).

---

## Dataset

| Artifact | Size |
|---|---|
| Labeled examples (`eval/training_data.json`) | 38 screenshots |
| Team-half training set (`eval/finetune_train_teams.jsonl`) | 60 examples |
| Team-half validation set (`eval/finetune_val_teams.jsonl`) | 16 examples |
| Eval holdout (`eval/ground_truth.json`) | 10 screenshots |

The 80/20 train/val split is done at the screenshot level (an image's two team
halves are never split across train and val).

---

## Caveats

- **Small holdout.** 84.6% is measured on a frozen **10-image** set. It's a
  reliable directional signal but not a large-sample benchmark; per-field
  numbers (especially the turnovers dip) come from a small denominator.
- **Not yet at target.** The stated goal in the fine-tuning guide is ≥90%
  overall; R5 is at 84.6% official. More labeled data (50+) and further rounds
  are the path there.
- **Model-host dependency.** These numbers assume the fine-tuned model is served
  by a reachable Ollama-compatible host (`OLLAMA_BASE_URL`). In production,
  uploads return `503` when that host is unreachable.
- **Junk filter.** True/false-positive rates are measured separately via
  `npm run eval:junk`; no committed current run is cited here to avoid quoting
  the illustrative example in `eval/README.md` as a real result.

---

## Reproducing

```bash
# Extraction accuracy against the labeled holdout (fine-tuned Ollama pipeline)
npm run eval -- --pipeline=ollama

# Full-pipeline benchmark (per-image accuracy + latency)
npm run eval:bench

# Junk filter true/false-positive rates
npm run eval:junk
```

Requires a reachable Ollama host serving `scorecheck-ocr-r5:latest` (extraction)
and `minicpm-v:latest` (junk filter). See `FINETUNING_GUIDE.md` for the training
pipeline and hardware notes.
