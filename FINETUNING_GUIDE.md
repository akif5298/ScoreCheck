# ScoreCheck OCR Fine-Tuning Guide

## Current status

| Item | Value |
|---|---|
| Extraction model | `minicpm-v:latest` (temp workaround — see note below) |
| Junk filter model | `minicpm-v:latest` (same workaround) |
| Training examples collected | 5 (need 30+ to start training) |
| Fine-tuned model | not yet trained |

## To add labeled screenshots

**GUI (recommended)** — opens a popup showing the image + editable stats table:
```bash
npm run label
```
Warms up the Ollama model on startup (`npm run warmup`, best-effort, ~60s on a
cold start), then background-scans every **unscanned** screenshot in
`eval/screenshots/` and immediately saves each result to `training_data.json`
as a tentative, unreviewed entry — nothing is lost if you close the GUI before
reviewing everything. Sidebar dots: grey = unscanned, blue = scanning right now,
orange = auto-saved but not yet reviewed, green = reviewed and confirmed.
Click an orange entry, fix anything wrong, hit Save (or `Ctrl+S`) to turn it green.

If OCR still times out, Ollama's default `keep_alive` (5 min) may be too short
for gaps between labeling actions — see the note on `OLLAMA_KEEP_ALIVE` below.

Already reviewed everything and just want to fix a mistake without triggering
any new OCR calls?
```bash
npm run edit
```
Same GUI, but skips warmup/pre-scan entirely and hides the Auto-fill button —
strictly for browsing and correcting existing entries.

**CLI (alternative)** — one screenshot at a time, terminal only:
```bash
npm run label:cli -- eval/screenshots/IMG_XXXX.JPG
```

Repeat until `training_data.json` has ≥ 30 entries (50+ is better).

## To train when ready

```bash
# 1. Collect 30+ examples
npm run label -- eval/screenshots/IMG_XXXX.JPG    # repeat for each new screenshot

# 2. Export to JSONL
npm run export:dataset
# → eval/finetune_train.jsonl (80 %)
# → eval/finetune_val.jsonl   (20 %)

# 3. Install ML deps (once, outside project venv)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
pip install -r scripts/requirements_finetune.txt

# 4. Train (~2-4 hours on RTX 4050/4060)
npm run finetune
# → scorecheck-ocr/*.gguf when done

# 5. Register with Ollama
ollama create scorecheck-ocr:latest -f Modelfile

# 6. Update src/constants/index.ts
#    OLLAMA_EXTRACTION_MODEL  = 'scorecheck-ocr:latest'
#    OLLAMA_JUNK_FILTER_MODEL = 'scorecheck-ocr:latest'

# 7. Verify accuracy
npm run eval -- --pipeline=ollama --models=scorecheck-ocr:latest
# Target: ≥ 90 % overall accuracy
```

## Hardware notes

| GPU | Action |
|---|---|
| RTX 4050 (6 GB) | `npm run finetune -- --batch 1 --grad-acc 16 --max-seq 1024` |
| RTX 4060+ (8 GB) | Default settings work |
| No suitable GPU | Use Kaggle free P100 (16 GB) — see `scripts/finetune.py` for upload instructions |

## Keeping the model warm

`npm run warmup` (also run automatically by `npm run label`/`edit`) loads the
model and asks Ollama to keep it loaded for 30 minutes (`keep_alive: "30m"`
in the warmup request). If your labeling session has longer gaps than that
between OCR calls, the model unloads again and the next call pays the cold-load
cost. To keep a model loaded indefinitely regardless of gaps, set an environment
variable on the machine running the Ollama **server** (not this repo) before
starting it:

```bash
# Windows (PowerShell) — persists for new shells after restart:
setx OLLAMA_KEEP_ALIVE -1
# or per-session:
$env:OLLAMA_KEEP_ALIVE = "-1"; ollama serve

# macOS/Linux:
OLLAMA_KEEP_ALIVE=-1 ollama serve
```

`-1` means "never unload"; a duration string (`"1h"`, `"24h"`) unloads after
that much idle time. Trade-off: the model's VRAM/RAM stays occupied the whole
time Ollama is running, even when you're not labeling.

## Ollama qwen2.5vl bug

Ollama 0.30.x returns `@@@` for all vision requests with `qwen2.5vl:*` models.
`minicpm-v` is the current working workaround.

```bash
ollama --version    # check installed version
```

When Ollama fixes the `qwen25vl` architecture handler, switch the base model in
`scripts/finetune.py` to `Qwen/Qwen2.5-VL-3B-Instruct` (already the default)
and update `OLLAMA_EXTRACTION_MODEL` / `OLLAMA_JUNK_FILTER_MODEL` in
`src/constants/index.ts` to `scorecheck-ocr:latest` after training.

## Files

| File | Purpose |
|---|---|
| `scripts/label_gui.py` | GUI labeler (image + editable table, recommended) |
| `scripts/add_training_example.ts` | CLI labeler (one screenshot at a time) |
| `scripts/export_dataset.py` | Converts training_data.json → JSONL |
| `scripts/finetune.py` | QLoRA training + GGUF export |
| `scripts/requirements_finetune.txt` | Python ML deps |
| `Modelfile` | Packages GGUF for Ollama |
| `eval/ground_truth.json` | Eval ground truth (5 entries) |
| `eval/training_data.json` | Accumulating training data |
