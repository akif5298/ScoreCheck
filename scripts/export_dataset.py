"""
export_dataset.py — converts eval/training_data.json into JSONL files for fine-tuning.

Reads:   eval/training_data.json  (same schema as ground_truth.json)
Writes:  eval/finetune_train.jsonl  (80 % of entries)
         eval/finetune_val.jsonl    (20 % of entries)

Usage:
    python scripts/export_dataset.py
    npm run export:dataset
"""

import json
import os
import random
import sys
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent.parent
TRAINING_DATA = ROOT / "eval" / "training_data.json"
SCREENSHOTS   = ROOT / "eval" / "screenshots"
TRAIN_OUT     = ROOT / "eval" / "finetune_train.jsonl"
VAL_OUT       = ROOT / "eval" / "finetune_val.jsonl"

# ── Extraction prompt — copied verbatim from src/services/ollamaExtractor.ts ──

EXTRACTION_PROMPT = """You are analyzing a screenshot of an NBA 2K basketball game box score.

Extract ALL player statistics from the box score table. There are exactly 10 players (5 per team), listed top to bottom.

The columns are:
- Player name (the gamertag/username)
- PTS (points)
- REB (rebounds)
- AST (assists)
- STL (steals)
- BLK (blocks)
- TO (turnovers)
- PF (personal fouls)
- FGM/FGA (field goals made / attempted)
- 3PM/3PA (three-pointers made / attempted)
- FTM/FTA (free throws made / attempted)

Return ONLY valid JSON — no markdown, no explanation, no code fences:
{
  "players": [
    {
      "name": "PLAYER_NAME",
      "points": 0,
      "rebounds": 0,
      "assists": 0,
      "steals": 0,
      "blocks": 0,
      "turnovers": 0,
      "fouls": 0,
      "fgMade": 0,
      "fgAttempted": 0,
      "threeMade": 0,
      "threeAttempted": 0,
      "ftMade": 0,
      "ftAttempted": 0
    }
  ]
}"""

# ── Helpers ────────────────────────────────────────────────────────────────────

def gt_player_to_output(p: dict) -> dict:
    """Map a ground-truth player entry to the ollamaExtractor output schema."""
    return {
        "name":           p["expectedName"],
        "points":         p["points"],
        "rebounds":       p["rebounds"],
        "assists":        p["assists"],
        "steals":         p["steals"],
        "blocks":         p["blocks"],
        "turnovers":      p["turnovers"],
        "fouls":          p["fouls"],
        "fgMade":         p["fgMade"],
        "fgAttempted":    p["fgAttempted"],
        "threeMade":      p["threeMade"],
        "threeAttempted": p["threeAttempted"],
        "ftMade":         p["ftMade"],
        "ftAttempted":    p["ftAttempted"],
    }


def entry_to_jsonl(entry: dict) -> dict:
    """Convert one training_data.json entry to HuggingFace VLM conversation format."""
    screenshot_path = str(SCREENSHOTS / entry["screenshotFile"])
    players_output  = [gt_player_to_output(p) for p in entry["players"]]
    assistant_json  = json.dumps({"players": players_output}, separators=(",", ":"))

    return {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image"},
                    {"type": "text", "text": EXTRACTION_PROMPT},
                ],
            },
            {
                "role": "assistant",
                "content": assistant_json,
            },
        ],
        "image": screenshot_path,
    }


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    if not TRAINING_DATA.exists():
        print(f"Error: {TRAINING_DATA} not found.", file=sys.stderr)
        print("Run 'npm run label' to add labeled screenshots first.", file=sys.stderr)
        sys.exit(1)

    with open(TRAINING_DATA, encoding="utf-8") as f:
        entries: list[dict] = json.load(f)

    if len(entries) < 5:
        print(
            f"Error: training_data.json has only {len(entries)} entries (need ≥5).",
            file=sys.stderr,
        )
        sys.exit(1)

    # Filter out entries whose screenshot file is missing
    valid, skipped = [], 0
    for entry in entries:
        img_path = SCREENSHOTS / entry["screenshotFile"]
        if not img_path.exists():
            print(f"Warning: screenshot not found, skipping — {entry['screenshotFile']}")
            skipped += 1
        else:
            valid.append(entry)

    if not valid:
        print("Error: no valid entries after checking screenshot files.", file=sys.stderr)
        sys.exit(1)

    # Reproducible shuffle then 80/20 split
    random.seed(42)
    shuffled = valid[:]
    random.shuffle(shuffled)

    split = max(1, int(len(shuffled) * 0.8))
    train_entries = shuffled[:split]
    val_entries   = shuffled[split:]

    # Write JSONL files
    def write_jsonl(path: Path, entries_: list[dict]) -> None:
        with open(path, "w", encoding="utf-8") as f:
            for entry in entries_:
                f.write(json.dumps(entry_to_jsonl(entry), ensure_ascii=False) + "\n")

    write_jsonl(TRAIN_OUT, train_entries)
    write_jsonl(VAL_OUT,   val_entries)

    total = len(valid)
    print(
        f"Exported: {len(train_entries)} train, {len(val_entries)} val "
        f"({total} total, {skipped} skipped)"
    )


if __name__ == "__main__":
    main()
