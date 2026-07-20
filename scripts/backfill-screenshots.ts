/**
 * Backfills games.screenshotUrl and games.imageHash for the labeled-data import.
 *
 * scripts/import-labeled-data.ts inserted all 38 games with both columns NULL, so those
 * games cannot participate in perceptual-hash duplicate detection: re-uploading any of
 * those screenshots would silently create a second game. This restores them from the
 * source images in eval/screenshots/.
 *
 * Join key: that import derived each game id as `game_import_<imgNum(screenshotFile)>`
 * (import-labeled-data.ts:214), so the file→game mapping is deterministic, not positional.
 *
 * Storage paths here are deterministic (unlike the live upload path, which randomises to
 * avoid collisions) so re-running is idempotent — an upsert overwrites the same object
 * rather than accumulating orphans.
 *
 * Usage (npm swallows --flags after --, so use positional args; see DEV_HANDOFF §7):
 *   npm run backfill:screenshots -- dry-run     # report only; no uploads, no writes
 *   npm run backfill:screenshots                # apply
 */

import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import dotenv from 'dotenv';
import supabaseService from '@/services/supabase';
import { computePerceptualHash, hammingDistance } from '@/utils/imageHash';

dotenv.config();

const DATA_FILE = path.join(__dirname, '..', 'eval', 'training_data.json');
const SCREENSHOT_DIR = path.join(__dirname, '..', 'eval', 'screenshots');

// Matches the live upload path's duplicate threshold.
const DUPLICATE_HAMMING_THRESHOLD = 10;

interface LabeledGame {
  screenshotFile: string;
}

const imgNum = (file: string): number => {
  const m = String(file).match(/(\d+)/);
  if (!m) throw new Error(`Cannot derive image number from filename: ${file}`);
  return parseInt(m[1]!, 10);
};

async function main(): Promise<void> {
  const dryRun = process.argv.slice(2).some((a) => a.replace(/^--/, '') === 'dry-run');

  const connectionString = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DIRECT_DATABASE_URL or DATABASE_URL must be set');
    process.exit(1);
  }

  const labeled = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as LabeledGame[];
  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Backfilling ${labeled.length} labeled games\n`);

  const client = new Client({ connectionString });
  await client.connect();

  try {
    // 1. Resolve every target game up front; abort before writing anything if the set
    //    does not line up with what is actually in the database.
    const { rows: gameRows } = await client.query<{
      id: string;
      userId: string;
      imageHash: string | null;
      screenshotUrl: string | null;
    }>('SELECT id, "userId", "imageHash", "screenshotUrl" FROM games');
    const byId = new Map(gameRows.map((g) => [g.id, g]));

    type Job = { gameId: string; userId: string; file: string; filePath: string; hash: string };
    const jobs: Job[] = [];
    const skipped: string[] = [];
    const problems: string[] = [];

    for (const entry of labeled) {
      const num = imgNum(entry.screenshotFile);
      const gameId = `game_import_${num}`;
      const game = byId.get(gameId);

      if (!game) {
        problems.push(`${entry.screenshotFile}: no game row ${gameId}`);
        continue;
      }
      if (game.imageHash) {
        skipped.push(`${gameId}: already has an imageHash`);
        continue;
      }
      const filePath = path.join(SCREENSHOT_DIR, entry.screenshotFile);
      if (!fs.existsSync(filePath)) {
        problems.push(`${entry.screenshotFile}: file missing on disk`);
        continue;
      }

      // Same function the upload path uses, applied to the same raw bytes, so the
      // resulting hashes are directly comparable to live uploads.
      const hash = await computePerceptualHash(fs.readFileSync(filePath));
      jobs.push({ gameId, userId: game.userId, file: entry.screenshotFile, filePath, hash });
    }

    if (problems.length) {
      console.error('Aborting — unresolved entries:');
      for (const p of problems) console.error(`  ${p}`);
      process.exit(1);
    }
    for (const s of skipped) console.log(`  skip  ${s}`);

    // 2. Report any pair of source screenshots that the live dedup rule would treat as
    //    the same image. Worth knowing before these hashes go in: such a pair means a
    //    future re-upload of either would be rejected as a duplicate of the other.
    const collisions: string[] = [];
    for (let i = 0; i < jobs.length; i++) {
      for (let j = i + 1; j < jobs.length; j++) {
        const d = hammingDistance(jobs[i]!.hash, jobs[j]!.hash);
        if (d <= DUPLICATE_HAMMING_THRESHOLD) {
          collisions.push(`  ${jobs[i]!.file} ~ ${jobs[j]!.file} (distance ${d})`);
        }
      }
    }
    if (collisions.length) {
      console.log(`\n⚠ ${collisions.length} near-duplicate pair(s) within threshold ${DUPLICATE_HAMMING_THRESHOLD}:`);
      for (const c of collisions) console.log(c);
      console.log('  These games would be treated as duplicates of each other on re-upload.\n');
    } else {
      console.log(`\nNo near-duplicate pairs among the ${jobs.length} source images (threshold ${DUPLICATE_HAMMING_THRESHOLD}).\n`);
    }

    if (dryRun) {
      console.log(`[DRY RUN] would upload ${jobs.length} screenshot(s) and update ${jobs.length} game row(s).`);
      for (const j of jobs.slice(0, 5)) {
        console.log(`  ${j.gameId} ← ${j.file}  hash=${j.hash.slice(0, 16)}…`);
      }
      if (jobs.length > 5) console.log(`  … and ${jobs.length - 5} more`);
      console.log('\n[DRY RUN] nothing uploaded, nothing written.');
      return;
    }

    // 3. Upload first. Storage is not transactional, but paths are deterministic, so a
    //    partial run followed by a re-run overwrites rather than duplicating.
    let uploaded = 0;
    for (const job of jobs) {
      const ext = path.extname(job.file).slice(1).toLowerCase() || 'jpg';
      const objectPath = `${job.userId}-import-${imgNum(job.file)}-boxscore.${ext}`;
      await supabaseService.uploadImage(fs.readFileSync(job.filePath), objectPath);
      (job as Job & { objectPath: string }).objectPath = objectPath;
      uploaded++;
    }
    console.log(`uploaded ${uploaded} screenshot(s) to Storage`);

    // 4. Then the DB writes, in one transaction.
    await client.query('BEGIN');
    let updated = 0;
    for (const job of jobs as Array<Job & { objectPath: string }>) {
      const res = await client.query(
        'UPDATE games SET "screenshotUrl" = $1, "imageHash" = $2, "updatedAt" = NOW() WHERE id = $3 AND "imageHash" IS NULL',
        [job.objectPath, job.hash, job.gameId],
      );
      updated += res.rowCount ?? 0;
    }
    await client.query('COMMIT');
    console.log(`updated ${updated} game row(s)`);

    const { rows: remaining } = await client.query<{ n: string }>(
      'SELECT COUNT(*) n FROM games WHERE "imageHash" IS NULL',
    );
    console.log(`games still missing an imageHash: ${remaining[0]!.n}`);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* no transaction open */
    }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('backfill failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
