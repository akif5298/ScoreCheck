"""
export_dataset_teams.py — converts eval/training_data.json into team-half
JSONL files for Round 5 fine-tuning: each screenshot yields 2 training
examples (Team A crop, Team B crop) instead of 1 full-table example,
matching the team-split crop the production extractor uses at inference
(see extractFineTunedTeamHalf in src/services/ollamaExtractor.ts).

Reads:   eval/training_data.json  (same schema as ground_truth.json)
Writes:  eval/team_screenshots/<stem>_A.png / <stem>_B.png  (pre-cropped
             halves, native resolution — finetune.py's collator does the
             final 1280px resize, exactly as it already does for the
             full-image/table-crop dataset)
         eval/finetune_train_teams.jsonl  (80% of screenshots, 2 examples each)
         eval/finetune_val_teams.jsonl    (20% of screenshots, 2 examples each)

Usage:
    python scripts/export_dataset_teams.py

Then train with:
    python scripts/finetune.py --train eval/finetune_train_teams.jsonl \
        --val eval/finetune_val_teams.jsonl --output scorecheck-ocr-r5 \
        --no-table-crop --img-size 1280 --epochs 10
"""

import json
import random
import sys
from pathlib import Path

from PIL import Image

# ── Paths ──────────────────────────────────────────────────────────────────────

ROOT              = Path(__file__).resolve().parent.parent
TRAINING_DATA     = ROOT / "eval" / "training_data.json"
GROUND_TRUTH      = ROOT / "eval" / "ground_truth.json"
SCREENSHOTS       = ROOT / "eval" / "screenshots"
TEAM_SCREENSHOTS  = ROOT / "eval" / "team_screenshots"
TRAIN_OUT         = ROOT / "eval" / "finetune_train_teams.jsonl"
VAL_OUT           = ROOT / "eval" / "finetune_val_teams.jsonl"

# ── Crop regions ───────────────────────────────────────────────────────────────
# On a 3840x2160 reference frame, scaled to each image's actual size.
# MUST stay in sync with TEAM_A_CROP / TEAM_B_CROP in
# src/services/ollamaExtractor.ts. No header compositing — both halves
# naturally include their own header row at the top edge (column headers for
# A, "Home Team ..." section title for B); this is what
# scripts/team_split_probe.mjs measured at 84.4% official / 89.7% cell-level.
REF_W, REF_H = 3840, 2160
TEAM_CROPS = {
    "A": (1218, 434,  3525, 923),
    "B": (1218, 1058, 3525, 1545),
}

# ── Team-half prompt — copied verbatim from FINE_TUNED_TEAM_PROMPT in ────────
# src/services/ollamaExtractor.ts.

TEAM_PROMPT = """You are analyzing a cropped section of an NBA 2K basketball game box score, showing one team's 5 players.

Extract ALL player statistics from the visible rows. There are exactly 5 players, listed top to bottom. Number each row by its visual position from the top: 1-5. If a row is unreadable, skip it and keep the remaining rows' slot numbers unchanged — never renumber.

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
      "slot": 1,
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

def crop_team(image: Image.Image, region: tuple[int, int, int, int]) -> Image.Image:
    sx, sy = image.width / REF_W, image.height / REF_H
    x1, y1, x2, y2 = region
    return image.crop((round(x1 * sx), round(y1 * sy), round(x2 * sx), round(y2 * sy)))


def local_slot(global_slot: int, team: str) -> int:
    """Convert training_data.json's global 1-10 slot to a half-local 1-5 slot."""
    return global_slot if team == "A" else global_slot - 5


def team_player_to_output(p: dict) -> dict:
    return {
        "slot":           local_slot(p["slot"], p["team"]),
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


def entry_to_examples(entry: dict) -> list[dict]:
    """One training_data.json entry -> up to 2 team-half JSONL examples."""
    stem      = Path(entry["screenshotFile"]).stem
    src_path  = SCREENSHOTS / entry["screenshotFile"]
    image     = Image.open(src_path).convert("RGB")

    examples = []
    for team in ("A", "B"):
        team_players = [p for p in entry["players"] if p.get("team") == team]
        if not team_players:
            print(f"Warning: no team-{team} players in {entry['screenshotFile']}, skipping half")
            continue

        bad_slots = [p for p in team_players if not (1 <= local_slot(p["slot"], team) <= 5)]
        if bad_slots:
            print(f"Warning: {entry['screenshotFile']} team {team} has out-of-range slots, skipping half")
            continue

        crop_path = TEAM_SCREENSHOTS / f"{stem}_{team}.png"
        crop_team(image, TEAM_CROPS[team]).save(crop_path)

        players_output = [team_player_to_output(p) for p in team_players]
        assistant_json = json.dumps({"players": players_output}, separators=(",", ":"))

        examples.append({
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "image"},
                        {"type": "text", "text": TEAM_PROMPT},
                    ],
                },
                {
                    "role": "assistant",
                    "content": [{"type": "text", "text": assistant_json}],
                },
            ],
            # Repo-relative path so the JSONL is portable (Kaggle, another machine).
            "image": f"eval/team_screenshots/{stem}_{team}.png",
        })
    return examples


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

    # Held-out eval set: never train on images in ground_truth.json
    eval_files: set[str] = set()
    if GROUND_TRUTH.exists():
        with open(GROUND_TRUTH, encoding="utf-8") as f:
            eval_files = {e["screenshotFile"] for e in json.load(f)}

    # Filter: missing screenshots, unreviewed entries, and eval-set images
    # (same rules as export_dataset.py).
    valid, skipped = [], 0
    for entry in entries:
        img_path = SCREENSHOTS / entry["screenshotFile"]
        if not img_path.exists():
            print(f"Warning: screenshot not found, skipping — {entry['screenshotFile']}")
            skipped += 1
        elif entry.get("reviewed") is False:
            print(f"Warning: not yet reviewed, skipping — {entry['screenshotFile']}")
            skipped += 1
        elif entry["screenshotFile"] in eval_files:
            print(f"Warning: in held-out eval set, skipping — {entry['screenshotFile']}")
            skipped += 1
        else:
            valid.append(entry)

    if not valid:
        print("Error: no valid entries after checking screenshot files.", file=sys.stderr)
        sys.exit(1)

    TEAM_SCREENSHOTS.mkdir(parents=True, exist_ok=True)

    # Reproducible shuffle then 80/20 split — same seed as export_dataset.py,
    # split at the screenshot level so both halves of one screenshot always
    # land in the same split (never leak Team A into train while Team B of
    # the same image is in val).
    random.seed(42)
    shuffled = valid[:]
    random.shuffle(shuffled)

    split = max(1, int(len(shuffled) * 0.8))
    train_entries = shuffled[:split]
    val_entries   = shuffled[split:]

    def write_jsonl(path: Path, entries_: list[dict]) -> int:
        count = 0
        with open(path, "w", encoding="utf-8") as f:
            for entry in entries_:
                for example in entry_to_examples(entry):
                    f.write(json.dumps(example, ensure_ascii=False) + "\n")
                    count += 1
        return count

    train_count = write_jsonl(TRAIN_OUT, train_entries)
    val_count   = write_jsonl(VAL_OUT,   val_entries)

    print(
        f"Exported: {train_count} train, {val_count} val team-half examples "
        f"({len(train_entries)} + {len(val_entries)} screenshots, {skipped} skipped)"
    )


if __name__ == "__main__":
    main()
