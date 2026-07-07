/**
 * Labeling CLI — adds a new screenshot to eval/training_data.json.
 *
 * Usage:
 *   npm run label -- eval/screenshots/IMG_XXXX.JPG
 *
 * Behaviour:
 *   1. Reads the image file.
 *   2. Checks ground_truth.json for a duplicate — exits 0 if already labeled.
 *   3. Runs extractBoxScore via minicpm-v to produce a first-pass JSON.
 *   4. Pretty-prints the result and asks the user to accept or correct it.
 *   5. Validates shape before saving to eval/training_data.json.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { extractBoxScore, OllamaExtractionError } from '../src/services/ollamaExtractor';
import { OLLAMA_EXTRACTION_MODEL } from '../src/constants';

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

    const validGrades = new Set(['', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F']);
    if (typeof pl['grade'] !== 'string' || !validGrades.has(pl['grade'] as string)) {
      errors.push(`players[${i}].grade must be one of: A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F (or empty string)`);
    }

    const intFields: Array<[string, string]> = [
      ['points', ''],       ['rebounds', ''],    ['assists', ''],
      ['steals', ''],        ['blocks', ''],      ['turnovers', ''],
      ['fouls', ''],         ['fgMade', ''],      ['fgAttempted', ''],
      ['threeMade', ''],     ['threeAttempted', ''], ['ftMade', ''],
      ['ftAttempted', ''],
    ];
    for (const [field] of intFields) {
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

// ── Empty template ─────────────────────────────────────────────────────────────

function emptyTemplate(screenshotFile: string): TrainingEntry {
  const players: PlayerEntry[] = [];
  for (let slot = 1; slot <= 10; slot++) {
    players.push({
      slot,
      expectedName: '',
      team: slot <= 5 ? 'A' : 'B',
      grade: '',
      points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0,
      turnovers: 0, fouls: 0, fgMade: 0, fgAttempted: 0,
      threeMade: 0, threeAttempted: 0, ftMade: 0, ftAttempted: 0,
    });
  }
  return { screenshotFile, players };
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

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.error('Usage: npm run label -- <path-to-screenshot>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(imagePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const screenshotFile = path.basename(resolvedPath);

  // ── Check for existing label in ground_truth.json ────────────────────────
  const gt: TrainingEntry[] = fs.existsSync(GROUND_TRUTH_PATH)
    ? JSON.parse(fs.readFileSync(GROUND_TRUTH_PATH, 'utf-8'))
    : [];
  if (gt.some(e => e.screenshotFile === screenshotFile)) {
    console.log(`Already labeled: ${screenshotFile}`);
    process.exit(0);
  }

  // ── Check for existing label in training_data.json ────────────────────────
  const existing: TrainingEntry[] = fs.existsSync(TRAINING_DATA_PATH)
    ? JSON.parse(fs.readFileSync(TRAINING_DATA_PATH, 'utf-8'))
    : [];
  if (existing.some(e => e.screenshotFile === screenshotFile)) {
    console.log(`Already labeled: ${screenshotFile}`);
    process.exit(0);
  }

  // ── Run extraction ────────────────────────────────────────────────────────
  const buffer = fs.readFileSync(resolvedPath);
  let suggested: TrainingEntry;

  try {
    process.stdout.write(`Running ${OLLAMA_EXTRACTION_MODEL} on ${screenshotFile}... `);
    const result = await extractBoxScore(buffer, OLLAMA_EXTRACTION_MODEL);
    process.stdout.write('done.\n\n');

    // Map ExtractedPlayer[] → PlayerEntry[] with slot assignment (order = slot)
    const players: PlayerEntry[] = result.players.map((p, i) => ({
      slot:           i + 1,
      expectedName:   p.name,
      team:           i < 5 ? 'A' : 'B',
      grade:          p.grade || '',
      points:         p.points,
      rebounds:       p.rebounds,
      assists:        p.assists,
      steals:         p.steals,
      blocks:         p.blocks,
      turnovers:      p.turnovers,
      fouls:          p.fouls,
      fgMade:         p.fgMade,
      fgAttempted:    p.fgAttempted,
      threeMade:      p.threeMade,
      threeAttempted: p.threeAttempted,
      ftMade:         p.ftMade,
      ftAttempted:    p.ftAttempted,
    }));
    suggested = { screenshotFile, players };
  } catch (err) {
    const msg = err instanceof OllamaExtractionError
      ? err.message
      : (err instanceof Error ? err.message : String(err));
    const isConnErr = msg.includes('unreachable') || msg.includes('ECONNREFUSED');
    if (isConnErr) {
      console.warn(`\nWarning: Ollama unavailable (${msg}). Using empty template.\n`);
    } else {
      console.warn(`\nWarning: Extraction failed (${msg}). Using empty template.\n`);
    }
    suggested = emptyTemplate(screenshotFile);
  }

  // ── Show suggested JSON ──────────────────────────────────────────────────
  console.log('Extracted data:');
  console.log(JSON.stringify(suggested, null, 2));
  console.log('\nReview the extracted data above.');
  console.log('Press ENTER to accept as-is, or paste corrected JSON and press ENTER twice.');
  console.log('> ');

  const rl = readline.createInterface({ input: process.stdin });

  // Read first line to decide: empty ENTER = accept, anything else = collect JSON
  let accepted: TrainingEntry;

  const firstLine = await new Promise<string>(resolve => {
    rl.once('line', resolve);
  });

  if (firstLine.trim() === '') {
    // User pressed ENTER with no input — accept as-is
    accepted = suggested;
    rl.close();
  } else {
    // User started typing — collect more lines until double-ENTER
    const rest = await readMultiLineInput(rl);
    rl.close();
    const raw = firstLine + '\n' + rest;

    // Validation loop
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error(`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }

    // Attach screenshotFile if missing (user may have pasted only players array)
    if (Array.isArray(parsed)) {
      parsed = { screenshotFile, players: parsed };
    } else if (parsed && typeof parsed === 'object' && !('screenshotFile' in (parsed as object))) {
      (parsed as Record<string, unknown>)['screenshotFile'] = screenshotFile;
    }

    const errors = validateEntry(parsed);
    if (errors.length > 0) {
      console.error('Validation failed:');
      errors.forEach(e => console.error(`  - ${e}`));
      process.exit(1);
    }
    accepted = parsed as TrainingEntry;
  }

  // ── Validate the accepted entry one more time ─────────────────────────────
  const finalErrors = validateEntry(accepted);
  if (finalErrors.length > 0) {
    console.error('Validation failed on accepted entry:');
    finalErrors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  // ── Append to training_data.json ──────────────────────────────────────────
  existing.push(accepted);
  try {
    fs.writeFileSync(TRAINING_DATA_PATH, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
  } catch (e) {
    console.error(`Failed to write training_data.json: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  console.log(`\nSaved. training_data.json now has ${existing.length} ${existing.length === 1 ? 'entry' : 'entries'}.`);
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
