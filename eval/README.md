# ScoreCheck — Evaluation Harness

This directory contains infrastructure for measuring the accuracy and quality of the extraction pipeline. Two separate evaluations are available:

1. **`run_eval.ts`** — measures OCR extraction accuracy field-by-field against labeled ground truth
2. **`run_junk_filter_eval.ts`** — measures the moondream2 junk filter's true/false positive rates

---

## Directory layout

```
eval/
  screenshots/            Real NBA 2K26 box score screenshots (not committed)
  junk_samples/           Non-box-score images for junk filter testing (not committed)
  ground_truth.json       Labeled correct values for each screenshot in screenshots/
  run_eval.ts             Extraction accuracy evaluator
  run_junk_filter_eval.ts Junk filter evaluator
  tsconfig.json           TypeScript config for ts-node
  README.md               This file
```

Both image directories are in `.gitignore`. Only `.gitkeep` files are tracked.

---

## 1 — Extraction accuracy eval (`run_eval.ts`)

### Adding a labeled screenshot

**Step 1:** Copy a real box score screenshot into `eval/screenshots/`.

```
eval/screenshots/game001.jpg
eval/screenshots/IMG_0312.JPEG
```

**Step 2:** Add a ground truth entry to `eval/ground_truth.json`.

The file starts as `[]`. Each element covers one screenshot:

```json
[
  {
    "screenshotFile": "game001.jpg",
    "players": [
      {
        "slot": 1,
        "expectedName": "AKIF RAHMAN",
        "team": "A",
        "points": 24,
        "rebounds": 5,
        "assists": 3,
        "steals": 2,
        "blocks": 1,
        "turnovers": 1,
        "fouls": 2,
        "fgMade": 9,
        "fgAttempted": 15,
        "threeMade": 3,
        "threeAttempted": 6,
        "ftMade": 3,
        "ftAttempted": 4
      }
    ]
  }
]
```

**Field reference:**

| Field | Type | Notes |
|---|---|---|
| `screenshotFile` | string | Filename inside `eval/screenshots/` |
| `slot` | integer 1–10 | Row position top-to-bottom. Slots 1–5 = away/team A; 6–10 = home/team B |
| `expectedName` | string | Raw name as it appears in the screenshot (all-caps is common) |
| `team` | `"A"` or `"B"` | Informational only; matching is done by slot (GCV) or name (Ollama) |
| stat fields | integer | All values must be integers, never null |

You don't need all 10 players per entry — unlisted slots are skipped.

### Running the eval

```bash
# From project root:
npm run eval                          # GCV pipeline, table output, 90% threshold
npm run eval -- --threshold 85        # Custom threshold
npm run eval -- --format=json         # Machine-readable JSON output
npm run eval -- --pipeline=ollama     # Qwen2.5-VL pipeline (requires Phase D)
npm run eval:both                     # Side-by-side benchmark of both pipelines
```

### Reading the output (table format)

```
=== Google Cloud Vision ===
Images run    : 5
Avg latency   : 12.34s

Per-field accuracy:
  name             :  95.0% (19/20 correct)
  points           :  90.0% (18/20 correct)
  ...

Overall accuracy: 91.2% (254/280 fields correct)

Mismatches (26):
  IMG_0312.JPEG | slot 3 (LMGMasdog336) | turnovers: expected 2, got 0
  ...

✅ PASS — 91.2% meets the 90% threshold
```

**Player matching strategy:**
- **GCV pipeline:** matched by slot position (row 1–10 in the box score). Stat accuracy is independent of whether the name was recognised correctly.
- **Ollama pipeline:** matched by normalised name (case-insensitive substring). Useful when Ollama doesn't preserve slot order.
- **Name accuracy** is measured separately in both cases.

---

## 2 — Junk filter eval (`run_junk_filter_eval.ts`)

### Adding test images

- Put valid box score screenshots in `eval/screenshots/` (same images used for extraction eval)
- Put non-box-score images in `eval/junk_samples/` (menu screens, celebration screens, random photos, etc.)

### Running the eval

```bash
npm run eval:junk
```

Requires Phase C to be complete (`src/services/junkFilter.ts` must exist).

### Reading the output

```
=== ScoreCheck Junk Filter Evaluation ===
Valid screenshots : 5
Junk samples      : 8

  [valid]  IMG_0312.JPEG                  → ✅ accepted (312ms)
  [junk]   celebration.jpg                → ✅ blocked (287ms)
  ...

─── Results ──────────────────────────────────────────────
True positive rate  (valid accepted) : 100.0% (5/5)
False negative rate (valid blocked)  :   0.0% (0/5)
True negative rate  (junk blocked)   :  87.5% (7/8)
False positive rate (junk accepted)  :  12.5% (1/8)
Avg latency per call                 : 301ms
```

**Exit code:** exits non-zero if any false negatives are detected (a valid screenshot being blocked is a hard failure since it breaks the upload flow).

---

## Updating the README accuracy claim

Once you have run the extraction eval against a representative set, update the headline in the root `README.md`:

```markdown
## 🏆 OCR Accuracy

Field-level extraction accuracy: **XX.X%** across YY labeled screenshots
(see [`eval/`](eval/) for methodology and labeled dataset).
```

Replace `XX.X%` with the overall accuracy from `npm run eval`.

---

## Google Cloud Vision API costs

Each 4-pass OCR run costs ~4 Vision API text-detection calls.  
Pricing: $1.50 / 1,000 calls → **~$0.006 per image**.  
The free tier covers 1,000 calls/month. Evaluating 100 screenshots costs ~$0.60.
