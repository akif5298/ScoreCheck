/**
 * Edit/relabel an existing screenshot entry in training_data.json and ground_truth.json.
 *
 * Usage:
 *   npm run edit -- eval/screenshots/IMG_XXXX.JPG
 *
 * Behaviour:
 *   1. Looks up the existing entry in training_data.json by filename.
 *   2. Pretty-prints the current labeled data as the starting point.
 *   3. Asks the user to accept as-is or paste corrected JSON.
 *   4. Validates shape before saving.
 *   5. Writes the updated entry back to training_data.json.
 *   6. If the entry also exists in ground_truth.json, updates it there too.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ── Paths ─────────────────────────────────────────────────────────────────────

const GROUND_TRUTH_PATH  = path.resolve(__dirname, '../eval/ground_truth.json');
const TRAINING_DATA_PATH = path.resolve(__dirname, '../eval/training_data.json');

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlayerEntry {
  slot:           number;
  expectedName:   string;
  team:           'A' | 'B';
  grade:          string;
  points:         number;
  rebounds:       number;
  assists:        number;
  steals:         number;
  blocks:         number;
  turnovers:      number;
  fouls:          number;
  fgMade:         number;
  fgAttempted:    number;
  threeMade:      number;
  threeAttempted: number;
  ftMade:         number;
  ftAttempted:    number;
}

interface TrainingEntry {
  screenshotFile: string;
  players:        PlayerEntry[];
}

// ── Validation ────────────────────────────────────────────────────────────────

const VALID_GRADES = new Set(['', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F']);

function validateEntry(entry: unknown): string[] {
  const errors: string[] = [];
  if (!entry || typeof entry !== 'object') {
    return ['Root value must be an object'];
  }
  const e = entry as Record<string, unknown>;

  if (typeof e['screenshotFile'] !== 'string' || !e['screenshotFile']) {
    errors.push('screenshotFile must be a non-empty string');
  }

  if (!Array.isArray(e['players'])) {
    errors.push('players must be an array');
    return errors;
  }

  const players = e['players'] as unknown[];
  if (players.length < 1 || players.length > 10) {
    errors.push(`players must have 1–10 entries (got ${players.length})`);
  }

  const slots = new Set<number>();
  players.forEach((p, i) => {
    if (!p || typeof p !== 'object') {
      errors.push(`players[${i}] must be an object`);
      return;
    }
    const pl = p as Record<string, unknown>;

    const slot = pl['slot'];
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > 10) {
      errors.push(`players[${i}].slot must be an integer 1–10`);
    } else {
      if (slots.has(slot)) errors.push(`Duplicate slot ${slot}`);
      slots.add(slot);
    }

    if (typeof pl['expectedName'] !== 'string' || !(pl['expectedName'] as string).trim()) {
      errors.push(`players[${i}].expectedName must be a non-empty string`);
    }

    if (pl['team'] !== 'A' && pl['team'] !== 'B') {
      errors.push(`players[${i}].team must be 'A' or 'B'`);
    }

    if (typeof pl['grade'] !== 'string' || !VALID_GRADES.has(pl['grade'] as string)) {
      errors.push(`players[${i}].grade must be one of: A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F (or empty string)`);
    }

    const intFields = [
      'points', 'rebounds', 'assists', 'steals', 'blocks',
      'turnovers', 'fouls', 'fgMade', 'fgAttempted',
      'threeMade', 'threeAttempted', 'ftMade', 'ftAttempted',
    ];
    for (const field of intFields) {
      const v = pl[field];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
        errors.push(`players[${i}].${field} must be a non-negative integer`);
      }
    }

    const check = (made: string, att: string) => {
      const m = pl[made] as number;
      const a = pl[att]  as number;
      if (typeof m === 'number' && typeof a === 'number' && m > a) {
        errors.push(`players[${i}].${made} (${m}) > ${att} (${a})`);
      }
    };
    check('fgMade', 'fgAttempted');
    check('threeMade', 'threeAttempted');
    check('ftMade', 'ftAttempted');
  });

  return errors;
}

// ── Stdin reader ──────────────────────────────────────────────────────────────

function readMultiLineInput(rl: readline.Interface): Promise<string> {
  return new Promise(resolve => {
    const lines: string[] = [];
    let emptyCount = 0;
    rl.on('line', line => {
      if (line === '') {
        emptyCount++;
        if (emptyCount >= 2 || lines.length === 0) {
          resolve(lines.join('\n'));
        } else {
          lines.push(line);
        }
      } else {
        emptyCount = 0;
        lines.push(line);
      }
    });
  });
}

// ── JSON helpers ──────────────────────────────────────────────────────────────

function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.error('Usage: npm run edit -- <path-to-screenshot>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(imagePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const screenshotFile = path.basename(resolvedPath);

  // ── Load training data ────────────────────────────────────────────────────
  const trainingData = readJson<TrainingEntry[]>(TRAINING_DATA_PATH, []);
  const trainingIdx  = trainingData.findIndex(e => e.screenshotFile === screenshotFile);

  if (trainingIdx === -1) {
    console.error(`Not found in training_data.json: ${screenshotFile}`);
    console.error(`Use "npm run label -- ${imagePath}" to add it first.`);
    process.exit(1);
  }

  const existing = trainingData[trainingIdx]!;

  // ── Check ground_truth.json ───────────────────────────────────────────────
  const groundTruth = readJson<TrainingEntry[]>(GROUND_TRUTH_PATH, []);
  const gtIdx       = groundTruth.findIndex(e => e.screenshotFile === screenshotFile);
  const inGT        = gtIdx !== -1;

  // ── Show current entry ────────────────────────────────────────────────────
  console.log(`Current entry for ${screenshotFile}:`);
  console.log(JSON.stringify(existing, null, 2));
  if (inGT) {
    console.log('\n(Also present in ground_truth.json — will be updated there too.)');
  }
  console.log('\nPress ENTER to accept as-is, or paste corrected JSON and press ENTER twice.');
  console.log('> ');

  const rl = readline.createInterface({ input: process.stdin });

  const firstLine = await new Promise<string>(resolve => {
    rl.once('line', resolve);
  });

  let accepted: TrainingEntry;

  if (firstLine.trim() === '') {
    console.log('No changes made.');
    rl.close();
    process.exit(0);
  }

  // User started typing — collect until double-ENTER
  const rest = await readMultiLineInput(rl);
  rl.close();
  const raw = firstLine + '\n' + rest;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  // Allow pasting just the players array
  if (Array.isArray(parsed)) {
    parsed = { screenshotFile, players: parsed };
  } else if (parsed && typeof parsed === 'object' && !('screenshotFile' in (parsed as object))) {
    (parsed as Record<string, unknown>)['screenshotFile'] = screenshotFile;
  }

  // Ensure screenshotFile isn't changed to a different file
  const p = parsed as Record<string, unknown>;
  if (typeof p['screenshotFile'] === 'string' && p['screenshotFile'] !== screenshotFile) {
    console.error(`screenshotFile in pasted JSON ("${p['screenshotFile']}") does not match ${screenshotFile}. Aborting.`);
    process.exit(1);
  }
  p['screenshotFile'] = screenshotFile;

  const errors = validateEntry(parsed);
  if (errors.length > 0) {
    console.error('Validation failed:');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  accepted = parsed as TrainingEntry;

  // ── Write back ────────────────────────────────────────────────────────────
  trainingData[trainingIdx] = accepted;
  try {
    writeJson(TRAINING_DATA_PATH, trainingData);
  } catch (e) {
    console.error(`Failed to write training_data.json: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  console.log(`\nUpdated training_data.json (entry ${trainingIdx + 1} of ${trainingData.length}).`);

  if (inGT) {
    groundTruth[gtIdx] = accepted;
    try {
      writeJson(GROUND_TRUTH_PATH, groundTruth);
    } catch (e) {
      console.error(`Failed to write ground_truth.json: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
    console.log(`Updated ground_truth.json (entry ${gtIdx + 1} of ${groundTruth.length}).`);
  }
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
