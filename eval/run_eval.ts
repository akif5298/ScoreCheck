/**
 * ScoreCheck OCR Evaluation Harness
 *
 * Usage (from project root):
 *   npm run eval                                     # Ollama, default model
 *   npm run eval:bench                               # multi-model Ollama benchmark
 *   npx ts-node ... eval/run_eval.ts --pipeline=ollama --models=minicpm-v:latest
 *   npx ts-node ... eval/run_eval.ts --pipeline=bench --models=qwen2.5vl:7b,qwen2.5vl:3b
 *   npx ts-node ... eval/run_eval.ts --threshold 85
 *   npx ts-node ... eval/run_eval.ts --format=json
 *
 * Exit codes:
 *   0 -- accuracy meets threshold (or no screenshots to evaluate)
 *   1 -- accuracy below threshold or a hard error occurred
 */

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(__dirname, '../.env') })

import * as fs from 'fs';
import { getMappingsForUser, applyMapping } from '../src/services/mappingService';
import { pgClient } from '../src/services/supabase';

// -- Default model list for --pipeline=bench ----------------------------------

const DEFAULT_BENCH_MODELS = [
  'qwen2.5vl:7b',
  'qwen2.5vl:3b',
  'minicpm-v',
  'moondream-sc:latest',
];

// -- CLI flag parsing ----------------------------------------------------------

type Pipeline = 'ollama' | 'bench';
type Format = 'table' | 'json';

interface Flags {
  pipeline: Pipeline;
  format: Format;
  threshold: number;
  models: string[];
}

function parseFlags(argv: string[]): Flags {
  const get = (prefix: string): string | undefined =>
    argv.find(a => a.startsWith(prefix))?.slice(prefix.length);

  const pipelineRaw = get('--pipeline=') ?? 'ollama';
  const pipeline: Pipeline = pipelineRaw === 'bench' ? 'bench' : 'ollama';

  const formatRaw = get('--format=') ?? 'table';
  const format: Format = formatRaw === 'json' ? 'json' : 'table';

  const threshIdx = argv.indexOf('--threshold');
  let threshold = 90;
  if (threshIdx !== -1 && argv[threshIdx + 1] !== undefined) {
    const v = Number(argv[threshIdx + 1]);
    if (!isNaN(v) && v >= 0 && v <= 100) threshold = v;
  }

  const modelsRaw = get('--models=');
  let models: string[];
  if (modelsRaw) {
    models = modelsRaw.split(/[,\s]+/).map(m => m.trim()).filter(Boolean);
  } else if (pipeline === 'bench') {
    models = DEFAULT_BENCH_MODELS;
  } else {
    models = ['minicpm-v:latest'];
  }

  return { pipeline, format, threshold, models };
}

// -- Ground-truth types -------------------------------------------------------

const STAT_FIELDS = [
  'points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'fouls',
  'fgMade', 'fgAttempted', 'threeMade', 'threeAttempted', 'ftMade', 'ftAttempted',
] as const;
type StatField = typeof STAT_FIELDS[number];

interface GroundTruthPlayer {
  slot: number;
  expectedName: string;
  team: 'A' | 'B';
  points: number; rebounds: number; assists: number; steals: number;
  blocks: number; turnovers: number; fouls: number;
  fgMade: number; fgAttempted: number;
  threeMade: number; threeAttempted: number;
  ftMade: number; ftAttempted: number;
}

interface GroundTruthEntry {
  screenshotFile: string;
  players: GroundTruthPlayer[];
}

interface NormalisedPlayer {
  name: string;
  slot?: number;
  stats: Record<StatField, number>;
}

interface Mismatch {
  screenshotFile: string;
  slot: number;
  expectedName: string;
  field: string;
  expected: number | string;
  actual: number | string | null;
}

interface PipelineResult {
  label: string;
  fieldCorrect: Record<string, number>;
  fieldTotal: Record<string, number>;
  nameCorrect: number;
  nameTotal: number;
  mappedNameCorrect: number;
  mappedNameTotal: number;
  mappedFieldCorrect: Record<string, number>;
  mappedFieldTotal: Record<string, number>;
  mismatches: Mismatch[];
  errors: string[];
  parseFails: number;
  totalLatencyMs: number;
  imagesRun: number;
}

// -- Ollama extraction --------------------------------------------------------

interface OllamaPlayerShape {
  name: string;
  points: number; rebounds: number; assists: number; steals: number;
  blocks: number; turnovers: number; fouls: number;
  fgMade: number; fgAttempted: number;
  threeMade: number; threeAttempted: number;
  ftMade: number; ftAttempted: number;
}

function ollamaPlayerToNormalised(p: OllamaPlayerShape): NormalisedPlayer {
  return {
    name: p.name,
    stats: {
      points: p.points, rebounds: p.rebounds, assists: p.assists,
      steals: p.steals, blocks: p.blocks, turnovers: p.turnovers,
      fouls: p.fouls, fgMade: p.fgMade, fgAttempted: p.fgAttempted,
      threeMade: p.threeMade, threeAttempted: p.threeAttempted,
      ftMade: p.ftMade, ftAttempted: p.ftAttempted,
    },
  };
}

type ExtractFn = (buf: Buffer, model: string) => Promise<{ players: OllamaPlayerShape[]; latencyMs: number }>;

async function getExtractFn(): Promise<ExtractFn> {
  try {
    const mod = await import('../src/services/ollamaExtractor');
    return mod.extractBoxScore as ExtractFn;
  } catch {
    throw new Error('src/services/ollamaExtractor.ts not found.');
  }
}

async function runOllamaOnImage(
  buffer: Buffer,
  model: string,
  extractFn: ExtractFn,
): Promise<{ players: NormalisedPlayer[]; latencyMs: number; parseFail: boolean; failReason?: string; rawOutput?: string }> {
  try {
    const result = await extractFn(buffer, model);
    return {
      players: result.players.map(ollamaPlayerToNormalised),
      latencyMs: result.latencyMs,
      parseFail: false,
    };
  } catch (err: unknown) {
    const rawOutput = (err as Record<string, unknown>)['rawOutput'] as string | undefined;
    return {
      players: [],
      latencyMs: 0,
      parseFail: true,
      failReason: err instanceof Error ? err.message : String(err),
      rawOutput,
    };
  }
}

// -- Comparison logic ---------------------------------------------------------

function normaliseName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function compareExtracted(
  entry: GroundTruthEntry,
  extracted: NormalisedPlayer[],
  matchBySlot: boolean,
  result: PipelineResult,
  mappings?: Map<string, string>,
): void {
  for (const gt of entry.players) {
    const resolvedName = mappings && mappings.size > 0
      ? applyMapping(gt.expectedName, mappings)
      : gt.expectedName;
    const isMapped = resolvedName !== gt.expectedName;

    const matched = matchBySlot
      ? extracted.find(p => p.slot === gt.slot)
      : extracted.find(p => normaliseName(p.name).includes(normaliseName(resolvedName)));

    result.nameTotal++;
    if (isMapped) result.mappedNameTotal++;

    const extractedName = matched?.name ?? '';
    if (matched && normaliseName(extractedName).includes(normaliseName(resolvedName))) {
      result.nameCorrect++;
      if (isMapped) result.mappedNameCorrect++;
    } else {
      result.mismatches.push({
        screenshotFile: entry.screenshotFile, slot: gt.slot,
        expectedName: resolvedName, field: 'name',
        expected: resolvedName, actual: extractedName || '(not found)',
      });
    }

    for (const field of STAT_FIELDS) {
      result.fieldTotal[field]++;
      if (isMapped) result.mappedFieldTotal[field]++;
      const expected = gt[field];
      const actual = matched ? matched.stats[field] ?? null : null;
      if (actual !== null && actual === expected) {
        result.fieldCorrect[field]++;
        if (isMapped) result.mappedFieldCorrect[field]++;
      } else {
        result.mismatches.push({
          screenshotFile: entry.screenshotFile, slot: gt.slot,
          expectedName: resolvedName, field, expected, actual,
        });
      }
    }
  }
}

function emptyResult(label: string): PipelineResult {
  const r: PipelineResult = {
    label,
    fieldCorrect: {}, fieldTotal: {},
    nameCorrect: 0, nameTotal: 0,
    mappedNameCorrect: 0, mappedNameTotal: 0,
    mappedFieldCorrect: {}, mappedFieldTotal: {},
    mismatches: [], errors: [],
    parseFails: 0, totalLatencyMs: 0, imagesRun: 0,
  };
  for (const f of STAT_FIELDS) {
    r.fieldCorrect[f] = 0; r.fieldTotal[f] = 0;
    r.mappedFieldCorrect[f] = 0; r.mappedFieldTotal[f] = 0;
  }
  return r;
}

// -- Formatters ---------------------------------------------------------------

function pct(correct: number, total: number): string {
  if (total === 0) return '  N/A  ';
  return `${((correct / total) * 100).toFixed(1).padStart(5)}%`;
}

function overallAccuracy(r: PipelineResult): number {
  const correct = r.nameCorrect + STAT_FIELDS.reduce((s, f) => s + r.fieldCorrect[f], 0);
  const total   = r.nameTotal   + STAT_FIELDS.reduce((s, f) => s + r.fieldTotal[f], 0);
  return total > 0 ? (correct / total) * 100 : 100;
}

function latStr(r: PipelineResult): string {
  return r.imagesRun > 0 ? (r.totalLatencyMs / r.imagesRun / 1000).toFixed(0) + 's' : '-';
}

function printTableResult(r: PipelineResult, threshold: number): void {
  console.log(`\n=== ${r.label} ===`);
  console.log(`Images run    : ${r.imagesRun}`);
  console.log(`Avg latency   : ${latStr(r)}`);
  if (r.parseFails > 0) console.log(`Parse failures: ${r.parseFails}`);
  console.log('');
  console.log('Per-field accuracy:');
  console.log(`  ${'name'.padEnd(16)}: ${pct(r.nameCorrect, r.nameTotal)} (${r.nameCorrect}/${r.nameTotal})`);
  for (const f of STAT_FIELDS) {
    console.log(`  ${f.padEnd(16)}: ${pct(r.fieldCorrect[f], r.fieldTotal[f])} (${r.fieldCorrect[f]}/${r.fieldTotal[f]})`);
  }
  console.log('');
  const oa = overallAccuracy(r);
  const totalCorrect = r.nameCorrect + STAT_FIELDS.reduce((s, f) => s + r.fieldCorrect[f], 0);
  const totalFields  = r.nameTotal   + STAT_FIELDS.reduce((s, f) => s + r.fieldTotal[f], 0);
  console.log(`Overall accuracy: ${oa.toFixed(1)}% (${totalCorrect}/${totalFields} fields correct)`);
  console.log('');
  if (oa >= threshold) {
    console.log(`PASS -- ${oa.toFixed(1)}% meets the ${threshold}% threshold`);
  } else {
    console.log(`FAIL -- ${oa.toFixed(1)}% is below the ${threshold}% threshold`);
  }
  if (r.errors.length > 0) {
    console.log('\nErrors:'); r.errors.forEach(e => console.log(e));
  }
}

function printJSONResult(r: PipelineResult): void {
  const totalCorrect = r.nameCorrect + STAT_FIELDS.reduce((s, f) => s + r.fieldCorrect[f], 0);
  const totalFields  = r.nameTotal   + STAT_FIELDS.reduce((s, f) => s + r.fieldTotal[f], 0);
  console.log(JSON.stringify({
    pipeline: r.label,
    imagesRun: r.imagesRun,
    avgLatencyMs: r.imagesRun > 0 ? r.totalLatencyMs / r.imagesRun : 0,
    parseFails: r.parseFails,
    overallAccuracy: overallAccuracy(r),
    totalCorrect, totalFields,
    perField: Object.fromEntries([
      ['name', { correct: r.nameCorrect, total: r.nameTotal }],
      ...STAT_FIELDS.map(f => [f, { correct: r.fieldCorrect[f], total: r.fieldTotal[f] }]),
    ]),
    errors: r.errors,
  }, null, 2));
}

function printModelBenchTable(results: PipelineResult[]): void {
  const LABEL_W = 18;
  const COL_W   = 16;
  const totalW  = LABEL_W + COL_W * results.length;

  const col = (s: string) => s.padStart(COL_W);
  const row = (label: string, vals: string[]) =>
    console.log(`${label.padEnd(LABEL_W)}${vals.map(col).join('')}`);

  console.log('\nScoreCheck -- Ollama Model Benchmark');
  console.log('='.repeat(totalW));
  console.log(`Images evaluated: ${results[0]?.imagesRun ?? 0}`);
  console.log('');
  console.log(`${''.padEnd(LABEL_W)}${results.map(r => col(r.label)).join('')}`);
  console.log('-'.repeat(totalW));

  row('Name accuracy', results.map(r => pct(r.nameCorrect, r.nameTotal)));
  for (const f of STAT_FIELDS) {
    row(f, results.map(r => pct(r.fieldCorrect[f], r.fieldTotal[f])));
  }
  console.log('-'.repeat(totalW));
  row('Overall accuracy', results.map(r => `${overallAccuracy(r).toFixed(1)}%`));
  row('Parse failures',   results.map(r => String(r.parseFails)));
  row('Avg latency',      results.map(latStr));
  console.log('='.repeat(totalW));

  const best = results.reduce((a, b) => overallAccuracy(a) >= overallAccuracy(b) ? a : b);
  const fastest = results.reduce((a, b) =>
    (a.imagesRun > 0 ? a.totalLatencyMs / a.imagesRun : Infinity) <=
    (b.imagesRun > 0 ? b.totalLatencyMs / b.imagesRun : Infinity) ? a : b);
  console.log(`\nBest accuracy : ${best.label} (${overallAccuracy(best).toFixed(1)}%)`);
  console.log(`Fastest       : ${fastest.label} (${latStr(fastest)}/image)`);
}

// -- Main ---------------------------------------------------------------------

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const evalDir = __dirname;
  const screenshotsDir = path.join(evalDir, 'screenshots');
  const groundTruthPath = path.join(evalDir, 'ground_truth.json');

  const groundTruth: GroundTruthEntry[] = JSON.parse(
    fs.readFileSync(groundTruthPath, 'utf-8'),
  );

  if (groundTruth.length === 0) {
    console.log('No entries in ground_truth.json -- nothing to evaluate.');
    process.exit(0);
  }

  let evalMappings: Map<string, string> = new Map();
  try {
    const userRes = await pgClient.query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1 LIMIT 1',
      ['dev.user@scorecheck.com'],
    );
    if (userRes.rows.length > 0) {
      evalMappings = await getMappingsForUser(userRes.rows[0].id);
      console.log(`Player mappings loaded: ${evalMappings.size}`);
    } else {
      console.log('Demo user not found in DB -- running without name mappings');
    }
  } catch {
    console.warn('Could not load player mappings -- running without them');
  }

  const extractFn = await getExtractFn();

  const ollamaResults: Map<string, PipelineResult> = new Map();
  for (const model of flags.models) {
    ollamaResults.set(model, emptyResult(model));
  }

  const imageBuffers: Array<{ entry: GroundTruthEntry; buffer: Buffer }> = [];
  for (const entry of groundTruth) {
    const screenshotPath = path.join(screenshotsDir, entry.screenshotFile);
    if (!fs.existsSync(screenshotPath)) {
      for (const r of ollamaResults.values()) r.errors.push(`MISSING FILE: ${entry.screenshotFile}`);
      continue;
    }
    imageBuffers.push({ entry, buffer: fs.readFileSync(screenshotPath) });
  }

  const { warmupModel, unloadModel } = await import('../src/services/ollamaExtractor');

  for (const model of flags.models) {
    const r = ollamaResults.get(model)!;
    console.log(`\n-- ${model} --`);

    process.stdout.write(`  Warming up... `);
    await warmupModel(model);
    console.log('ready.');

    for (const { entry, buffer } of imageBuffers) {
      r.imagesRun++;
      process.stdout.write(`  [${entry.screenshotFile}]... `);
      const { players, latencyMs, parseFail, failReason, rawOutput } =
        await runOllamaOnImage(buffer, model, extractFn);
      r.totalLatencyMs += latencyMs;
      if (parseFail) {
        r.parseFails++;
        const hint = rawOutput ? ` | raw: "${rawOutput.substring(0, 120)}"` : '';
        console.log(`FAIL (${failReason ?? 'parse error'})${hint}`);
      } else {
        console.log(`ok (${(latencyMs / 1000).toFixed(0)}s)`);
      }
      compareExtracted(entry, players, false, r, evalMappings);
    }

    process.stdout.write(`  Unloading ${model}... `);
    await unloadModel(model);
    console.log('done.');
  }

  if (flags.pipeline === 'bench') {
    if (flags.format === 'json') {
      for (const r of ollamaResults.values()) printJSONResult(r);
    } else {
      printModelBenchTable([...ollamaResults.values()]);
    }
    const anyPass = [...ollamaResults.values()].some(r => overallAccuracy(r) >= flags.threshold);
    process.exit(anyPass ? 0 : 1);
  } else {
    if (flags.format === 'json') {
      for (const r of ollamaResults.values()) printJSONResult(r);
    } else if (ollamaResults.size === 1) {
      printTableResult(ollamaResults.values().next().value!, flags.threshold);
    } else {
      printModelBenchTable([...ollamaResults.values()]);
    }
    const primary = ollamaResults.values().next().value ?? emptyResult('');
    process.exit(overallAccuracy(primary) >= flags.threshold ? 0 : 1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});