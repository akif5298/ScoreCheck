/**
 * ScoreCheck Junk Filter Evaluation
 *
 * Tests the moondream2 junk filter against two labelled sets:
 *   eval/screenshots/   — valid box score images (every image must PASS = true positive)
 *   eval/junk_samples/  — non-box-score images (every image must BLOCK = true negative)
 *
 * Usage (from project root):
 *   npm run eval:junk
 *
 * Reports:
 *   True positive rate  (valid screenshots correctly accepted)
 *   False positive rate (junk incorrectly accepted)
 *   False negative rate (valid screenshots incorrectly blocked)
 *   Average latency per call
 *
 * Requires Phase C to be complete (src/services/junkFilter.ts must exist).
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import * as fs from 'fs';

// ── Lazy import of junkFilter (built in Phase C) ──────────────────────────────

interface JunkFilterResult {
  isValidBoxScore: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  latencyMs: number;
}

async function loadClassifier(): Promise<(buf: Buffer) => Promise<JunkFilterResult>> {
  try {
    const mod = await import('../src/services/junkFilter');
    return mod.classifyScreenshot as (buf: Buffer) => Promise<JunkFilterResult>;
  } catch {
    console.error(
      '\n❌  src/services/junkFilter.ts not found.\n' +
      '    Phase C must be completed before running the junk filter eval.\n'
    );
    process.exit(1);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function listImages(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f))
    .map(f => path.join(dir, f));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const classifyScreenshot = await loadClassifier();

  const evalDir    = __dirname;
  const validDir   = path.join(evalDir, 'screenshots');
  const junkDir    = path.join(evalDir, 'junk_samples');

  const validImages = listImages(validDir);
  const junkImages  = listImages(junkDir);

  if (validImages.length === 0 && junkImages.length === 0) {
    console.log('=== ScoreCheck Junk Filter Evaluation ===');
    console.log('No images found in eval/screenshots/ or eval/junk_samples/.');
    console.log('Add images to both folders and re-run.');
    process.exit(0);
  }

  console.log('=== ScoreCheck Junk Filter Evaluation ===');
  console.log(`Valid screenshots : ${validImages.length}`);
  console.log(`Junk samples      : ${junkImages.length}`);
  console.log('');

  // ── Run against valid images (expect isValidBoxScore = true)
  let tp = 0, fn = 0;
  const validLatencies: number[] = [];
  const fnFiles: string[] = [];

  for (const imgPath of validImages) {
    const buf = fs.readFileSync(imgPath);
    const res = await classifyScreenshot(buf);
    validLatencies.push(res.latencyMs);

    const basename = path.basename(imgPath);
    if (res.isValidBoxScore) {
      tp++;
    } else {
      fn++;
      fnFiles.push(`  ${basename} (confidence=${res.confidence}, reason=${res.reason})`);
    }
    process.stdout.write(`  [valid]  ${basename.padEnd(30)} → ${res.isValidBoxScore ? '✅ accepted' : '❌ blocked (FALSE NEGATIVE)'} (${res.latencyMs}ms)\n`);
  }

  // ── Run against junk images (expect isValidBoxScore = false with high confidence)
  let tn = 0, fp = 0;
  const junkLatencies: number[] = [];
  const fpFiles: string[] = [];

  for (const imgPath of junkImages) {
    const buf = fs.readFileSync(imgPath);
    const res = await classifyScreenshot(buf);
    junkLatencies.push(res.latencyMs);

    const basename = path.basename(imgPath);
    if (!res.isValidBoxScore && res.confidence === 'high') {
      tn++;
    } else {
      fp++;
      fpFiles.push(`  ${basename} (isValid=${res.isValidBoxScore}, confidence=${res.confidence}, reason=${res.reason})`);
    }
    const label = (!res.isValidBoxScore && res.confidence === 'high') ? '✅ blocked' : '❌ accepted (FALSE POSITIVE)';
    process.stdout.write(`  [junk]   ${basename.padEnd(30)} → ${label} (${res.latencyMs}ms)\n`);
  }

  // ── Summary
  const allLatencies = [...validLatencies, ...junkLatencies];
  const avgLatency   = allLatencies.length > 0
    ? allLatencies.reduce((s, v) => s + v, 0) / allLatencies.length
    : 0;

  const tpr = validImages.length > 0 ? (tp / validImages.length) * 100 : null;
  const fpr = junkImages.length  > 0 ? (fp / junkImages.length)  * 100 : null;
  const fnr = validImages.length > 0 ? (fn / validImages.length) * 100 : null;

  console.log('\n─── Results ──────────────────────────────────────────────');
  console.log(`True positive rate  (valid accepted) : ${tpr !== null ? tpr.toFixed(1) + '%' : 'N/A'} (${tp}/${validImages.length})`);
  console.log(`False negative rate (valid blocked)  : ${fnr !== null ? fnr.toFixed(1) + '%' : 'N/A'} (${fn}/${validImages.length})`);
  console.log(`True negative rate  (junk blocked)   : ${junkImages.length > 0 ? ((tn / junkImages.length) * 100).toFixed(1) + '%' : 'N/A'} (${tn}/${junkImages.length})`);
  console.log(`False positive rate (junk accepted)  : ${fpr !== null ? fpr.toFixed(1) + '%' : 'N/A'} (${fp}/${junkImages.length})`);
  console.log(`Avg latency per call                 : ${avgLatency.toFixed(0)}ms`);

  if (fnFiles.length > 0) {
    console.log('\nFalse negatives (valid screenshots incorrectly blocked):');
    fnFiles.forEach(f => console.log(f));
  }
  if (fpFiles.length > 0) {
    console.log('\nFalse positives (junk incorrectly accepted):');
    fpFiles.forEach(f => console.log(f));
  }

  // Exit non-zero if any false negatives (blocking a legitimate upload is a hard failure)
  if (fn > 0) {
    console.log('\n❌ FAIL — false negatives detected (legitimate uploads would be blocked)');
    process.exit(1);
  }
  console.log('\n✅ PASS — no false negatives');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
