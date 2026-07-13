/**
 * holdout_split.mjs — carves a frozen eval set out of the labeled training data.
 *
 * Ensures eval/ground_truth.json and eval/training_data.json are disjoint:
 *   1. Any screenshot present in BOTH files is removed from training_data
 *      (it stays eval-only).
 *   2. Randomly moves additional *reviewed* training entries into ground_truth
 *      until it reaches the target size (default 10).
 *
 * Only human-verified entries are eligible: `reviewed: true` or legacy entries
 * with no flag. `reviewed: false` (unreviewed auto-scans) are never moved.
 *
 * Usage:
 *   node scripts/holdout_split.mjs            # dry run — shows the plan
 *   node scripts/holdout_split.mjs --apply    # writes both files
 *   node scripts/holdout_split.mjs --target 12 --apply
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TRAINING = path.join(ROOT, "eval", "training_data.json");
const GROUND_TRUTH = path.join(ROOT, "eval", "ground_truth.json");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const targetIdx = args.indexOf("--target");
const target = targetIdx !== -1 ? parseInt(args[targetIdx + 1], 10) : 10;

if (!Number.isInteger(target) || target < 1) {
  console.error("Invalid --target value");
  process.exit(1);
}

const training = JSON.parse(fs.readFileSync(TRAINING, "utf8"));
const groundTruth = JSON.parse(fs.readFileSync(GROUND_TRUTH, "utf8"));

const gtFiles = new Set(groundTruth.map((e) => e.screenshotFile));

// 1. Entries in both files: remove from training (they stay eval-only)
const overlap = training.filter((e) => gtFiles.has(e.screenshotFile));
let remaining = training.filter((e) => !gtFiles.has(e.screenshotFile));

// 2. Pick additional reviewed entries to move until GT reaches the target
const isVerified = (e) => e.reviewed === true || e.reviewed === undefined;
const needed = Math.max(0, target - groundTruth.length);
const eligible = remaining.filter(isVerified);

// Fisher–Yates on a copy, take the first `needed`
const pool = [...eligible];
for (let i = pool.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [pool[i], pool[j]] = [pool[j], pool[i]];
}
const toMove = pool.slice(0, needed);

if (needed > eligible.length) {
  console.warn(
    `Warning: need ${needed} more eval entries but only ${eligible.length} verified ` +
      `training entries are eligible — moving all of them.`,
  );
}

const moveFiles = new Set(toMove.map((e) => e.screenshotFile));
remaining = remaining.filter((e) => !moveFiles.has(e.screenshotFile));

// Strip the reviewed flag when promoting to ground truth
const promoted = toMove.map(({ reviewed, ...rest }) => rest);
const newGroundTruth = [...groundTruth, ...promoted];

const unreviewedLeft = remaining.filter((e) => e.reviewed === false).length;

console.log(`${apply ? "APPLYING" : "DRY RUN (pass --apply to write)"}\n`);
console.log(`Removed from training (already in ground truth): ${overlap.length}`);
overlap.forEach((e) => console.log(`  - ${e.screenshotFile}`));
console.log(`Promoted training → ground truth: ${promoted.length}`);
promoted.forEach((e) => console.log(`  - ${e.screenshotFile}`));
console.log(`\nResult: ground_truth ${newGroundTruth.length} entries | training ${remaining.length} entries`);
if (unreviewedLeft > 0) {
  console.log(
    `Note: ${unreviewedLeft} training entries are still unreviewed (reviewed: false) — ` +
      `finish them with \`npm run edit\` before exporting.`,
  );
}

if (apply) {
  fs.writeFileSync(GROUND_TRUTH, JSON.stringify(newGroundTruth, null, 2) + "\n");
  fs.writeFileSync(TRAINING, JSON.stringify(remaining, null, 2) + "\n");
  console.log("\nWrote eval/ground_truth.json and eval/training_data.json");
} else {
  console.log("\nNo files changed.");
}
