"""
finetune.py — QLoRA fine-tuning for scorecheck-ocr on NBA 2K box score screenshots.

SETUP (run once, outside the project venv):
  pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
  pip install -r scripts/requirements_finetune.txt

USAGE:
  # 1. Collect 30+ labeled screenshots:
  #    npm run label -- eval/screenshots/IMG_XXXX.JPG   (repeat for each)

  # 2. Export dataset:
  #    npm run export:dataset

  # 3. Train (~2-4 hours on RTX 4050 / 4060):
  #    npm run finetune

  # 4. Register with Ollama:
  #    ollama create scorecheck-ocr:latest -f Modelfile

  # 5. Update src/constants/index.ts:
  #    OLLAMA_EXTRACTION_MODEL  = 'scorecheck-ocr:latest'
  #    OLLAMA_JUNK_FILTER_MODEL = 'scorecheck-ocr:latest'

HARDWARE NOTES:
  - RTX 4050 6 GB : use --batch 1 --grad-acc 16 --max-seq 1024
  - RTX 4060+ 8 GB: default settings should work
  - CUDA OOM      : try Kaggle free GPU (P100 16 GB) — see bottom of this file
"""

import argparse
import json
import os
import sys
import warnings
from pathlib import Path

# ── Unsloth must be imported before transformers ───────────────────────────────
try:
    from unsloth import FastVisionModel  # type: ignore
    from unsloth.trainer import UnslothVisionDataCollator  # type: ignore
except ImportError:
    print(
        "\nError: unsloth is not installed.\n"
        "Run: pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121\n"
        "     pip install -r scripts/requirements_finetune.txt\n",
        file=sys.stderr,
    )
    sys.exit(1)

from datasets import load_dataset  # type: ignore
from PIL import Image              # type: ignore
from trl import SFTConfig, SFTTrainer  # type: ignore

warnings.filterwarnings("ignore", category=UserWarning)

# ── CLI args ───────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser(description="Fine-tune scorecheck-ocr with QLoRA")
parser.add_argument("--train",    default="eval/finetune_train.jsonl", help="Training JSONL")
parser.add_argument("--val",      default="eval/finetune_val.jsonl",   help="Validation JSONL")
parser.add_argument("--output",   default="scorecheck-ocr",            help="Output directory + GGUF name")
parser.add_argument("--model",    default="Qwen/Qwen2.5-VL-3B-Instruct", help="HuggingFace base model")
parser.add_argument("--epochs",   type=int,   default=3,    help="Training epochs")
parser.add_argument("--batch",    type=int,   default=1,    help="Per-device batch size (1 for 6 GB VRAM)")
parser.add_argument("--grad-acc", type=int,   default=8,    help="Gradient accumulation steps (effective batch = batch × grad-acc)")
parser.add_argument("--lr",       type=float, default=2e-4, help="Learning rate")
parser.add_argument("--max-seq",  type=int,   default=2048, help="Max sequence length (lower if OOM)")
parser.add_argument("--img-size", type=int,   default=1280,
                    help="Longest image edge during training (0 = native resolution). "
                         "The collator's default is 512, which makes the dense middle "
                         "stat columns illegible — keep >= 1024 for box scores.")
args = parser.parse_args()

ROOT = Path(__file__).resolve().parent.parent

# ── Validate inputs ────────────────────────────────────────────────────────────

train_path = ROOT / args.train
val_path   = ROOT / args.val

for p, label in [(train_path, "--train"), (val_path, "--val")]:
    if not p.exists():
        print(f"Error: {label} file not found: {p}", file=sys.stderr)
        print("Run 'npm run export:dataset' first.", file=sys.stderr)
        sys.exit(1)

train_lines = train_path.read_text(encoding="utf-8").strip().splitlines()
if len(train_lines) < 5:
    print(
        f"Error: training set has only {len(train_lines)} examples (need ≥5).\n"
        "Collect more labeled screenshots with 'npm run label'.",
        file=sys.stderr,
    )
    sys.exit(1)

print(f"Training set  : {len(train_lines)} examples")
print(f"Validation set: {len(val_path.read_text().strip().splitlines())} examples")
print(f"Base model    : {args.model}")
print(f"Output dir    : {args.output}")
print(f"Epochs        : {args.epochs}  |  batch {args.batch} × grad-acc {args.grad_acc}  |  lr {args.lr}")
print(f"Max seq len   : {args.max_seq}\n")

# ── Load model ─────────────────────────────────────────────────────────────────

print("Loading model (this downloads ~6 GB on first run)...")
model, tokenizer = FastVisionModel.from_pretrained(
    args.model,
    load_in_4bit=True,
    use_gradient_checkpointing=True,  # required for 6 GB VRAM
)

model = FastVisionModel.get_peft_model(
    model,
    r=16,
    lora_alpha=16,
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    ],
    use_gradient_checkpointing=True,
)
print("Model loaded and LoRA adapters attached.\n")

# ── Dataset loading ────────────────────────────────────────────────────────────

def load_and_filter(jsonl_path: Path, split_name: str):
    """Load JSONL, drop entries with missing screenshot files, return dataset."""
    raw = load_dataset("json", data_files=str(jsonl_path), split="train")

    valid_indices = []
    for i, example in enumerate(raw):
        img_path = example.get("image", "")
        # JSONL stores repo-relative paths (portable to Kaggle etc.)
        if img_path and not Path(img_path).is_absolute():
            img_path = str(ROOT / img_path)
        if not img_path or not Path(img_path).exists():
            print(f"Warning [{split_name}]: image not found, skipping — {img_path}")
        else:
            valid_indices.append(i)

    filtered = raw.select(valid_indices)
    print(f"  {split_name}: {len(filtered)} / {len(raw)} examples kept")
    return filtered


print("Loading datasets...")
train_dataset = load_and_filter(train_path, "train")
val_dataset   = load_and_filter(val_path,   "val")
print()

# ── Conversation formatter ─────────────────────────────────────────────────────

def format_example(example: dict) -> dict:
    """
    Convert one JSONL entry into the conversation format Unsloth's vision
    collator expects: {"messages": [...]} with the PIL image embedded in the
    user turn's image content part. The collator applies the chat template
    and image processing itself — no pre-tokenization here.
    """
    img_path = Path(example["image"])
    if not img_path.is_absolute():
        img_path = ROOT / img_path
    image = Image.open(img_path).convert("RGB")
    messages = []
    for msg in example["messages"]:
        parts = []
        for part in msg["content"]:
            if part["type"] == "image":
                parts.append({"type": "image", "image": image})
            else:
                parts.append(part)
        messages.append({"role": msg["role"], "content": parts})
    return {"messages": messages}


# Plain Python lists (not datasets.Dataset.map) — PIL images can't round-trip
# through arrow, and the vision collator consumes dicts directly.
train_formatted = [format_example(ex) for ex in train_dataset]
val_formatted   = [format_example(ex) for ex in val_dataset]

# ── Training config ────────────────────────────────────────────────────────────

training_args = SFTConfig(
    output_dir=str(ROOT / args.output),
    num_train_epochs=args.epochs,
    per_device_train_batch_size=args.batch,
    gradient_accumulation_steps=args.grad_acc,
    learning_rate=args.lr,
    lr_scheduler_type="cosine",
    warmup_ratio=0.1,
    logging_steps=5,
    eval_strategy="epoch",
    save_strategy="epoch",
    load_best_model_at_end=True,
    metric_for_best_model="eval_loss",
    greater_is_better=False,
    bf16=True,              # RTX 40xx (Ada) supports bfloat16 natively; Unsloth loads the model in bf16
    max_seq_length=args.max_seq,
    # Vision fine-tuning: the collator does all preparation, so TRL's own
    # dataset preprocessing must be disabled.
    remove_unused_columns=False,
    dataset_text_field="",
    dataset_kwargs={"skip_prepare_dataset": True},
    report_to="none",       # no wandb / tensorboard dependency
    dataloader_num_workers=0,
)

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    data_collator=UnslothVisionDataCollator(
        model,
        tokenizer,
        # Explicit size: the "min" default falls back to 512px on Qwen2.5-VL
        # (dynamic-resolution model, no fixed image_size in config), which
        # blurs the small stat digits the model must read.
        resize=(args.img_size if args.img_size > 0 else "max"),
        resize_dimension="max",  # scale by the longest edge
    ),
    train_dataset=train_formatted,
    eval_dataset=val_formatted,
    args=training_args,
)

# ── Train ──────────────────────────────────────────────────────────────────────

FastVisionModel.for_training(model)

print("Starting training...")
try:
    trainer.train()
except RuntimeError as e:
    if "out of memory" in str(e).lower():
        print(
            "\n=== CUDA OUT OF MEMORY ===\n"
            "Try reducing memory usage:\n"
            "  python scripts/finetune.py --batch 1 --grad-acc 16 --max-seq 1024\n"
            "\nOr run on Kaggle free GPU (P100, 16 GB VRAM):\n"
            "  1. Upload eval/finetune_train.jsonl + eval/finetune_val.jsonl + eval/screenshots/\n"
            "  2. Copy scripts/finetune.py into the notebook\n"
            "  3. Run the SETUP block, then: !python finetune.py\n"
            "  4. Download the resulting scorecheck-ocr/*.gguf file\n",
            file=sys.stderr,
        )
    raise

print("\nTraining complete.")

# ── GGUF export ────────────────────────────────────────────────────────────────

gguf_name = str(ROOT / args.output)
print(f"Saving GGUF (Q4_K_M) to {gguf_name}/ ...")
model.save_pretrained_gguf(gguf_name, tokenizer, quantization_method="q4_k_m")
print(
    f"\nDone. Register with Ollama:\n"
    f"  ollama create scorecheck-ocr:latest -f Modelfile\n"
    f"\nThen update src/constants/index.ts:\n"
    f"  OLLAMA_EXTRACTION_MODEL  = 'scorecheck-ocr:latest'\n"
    f"  OLLAMA_JUNK_FILTER_MODEL = 'scorecheck-ocr:latest'\n"
)
