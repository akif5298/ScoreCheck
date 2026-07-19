/**
 * One-time migration: reassign ALL existing data to a single owner account.
 *
 * Use when converting the old single-user instance to multi-user — every
 * pre-existing game/player/team/mapping is moved to the account you name, then
 * player_totals and player_stats are recomputed from scratch for that account's
 * mapped display names, legacy screenshot references are cleaned up, and all
 * other user rows are removed.
 *
 * SAFETY:
 *   - Runs inside a single transaction.
 *   - `--dry-run` executes everything then ROLLS BACK, printing what WOULD
 *     change without persisting anything. Always dry-run first.
 *   - The target account must already exist (sign up through the app) and have
 *     a password set.
 *
 * Usage:
 *   npm run assign-owner -- --email you@example.com --dry-run   # preview
 *   npm run assign-owner -- --email you@example.com             # apply
 */

import dotenv from 'dotenv';
import { Client } from 'pg';
import supabaseService, { pgPool } from '@/services/supabase';

dotenv.config();

interface Args {
  email: string;
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let email = '';
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') email = argv[++i] ?? '';
    else if (a === '--dry-run') dryRun = true;
    else if (a?.startsWith('--email=')) email = a.slice('--email='.length);
  }
  if (!email) {
    console.error('Usage: npm run assign-owner -- --email <you@example.com> [--dry-run]');
    process.exit(1);
  }
  return { email, dryRun };
}

async function count(client: Client, sql: string, params: unknown[] = []): Promise<number> {
  const r = await client.query<{ n: string }>(sql, params);
  return parseInt(r.rows[0]?.n ?? '0', 10);
}

// player_totals recompute: one row per distinct player name that appears in the
// target's games AND is one of their mapped display names. player_id must be
// unique per (player_id, userid); reads key on name+user, so a uuid is fine.
const RECOMPUTE_TOTALS_SQL = `
  INSERT INTO player_totals (
    id, player_id, player_name, team, total_games,
    total_points, total_rebounds, total_assists, total_steals, total_blocks,
    total_fouls, total_turnovers,
    total_fgm, total_fga, total_3pm, total_3pa, total_ftm, total_fta,
    fg_percentage, three_percentage, ft_percentage,
    userid, createdat, updatedat
  )
  SELECT
    gen_random_uuid()::text, gen_random_uuid()::text, p.name, MAX(p.team),
    COUNT(DISTINCT p."gameId"),
    SUM(p.points), SUM(p.rebounds), SUM(p.assists), SUM(p.steals), SUM(p.blocks),
    SUM(p.fouls), SUM(p.turnovers),
    SUM(p."fgMade"), SUM(p."fgAttempted"), SUM(p."threeMade"), SUM(p."threeAttempted"),
    SUM(p."ftMade"), SUM(p."ftAttempted"),
    CASE WHEN SUM(p."fgAttempted") > 0
      THEN ROUND(SUM(p."fgMade")::numeric / SUM(p."fgAttempted") * 100, 2) ELSE 0 END,
    CASE WHEN SUM(p."threeAttempted") > 0
      THEN ROUND(SUM(p."threeMade")::numeric / SUM(p."threeAttempted") * 100, 2) ELSE 0 END,
    CASE WHEN SUM(p."ftAttempted") > 0
      THEN ROUND(SUM(p."ftMade")::numeric / SUM(p."ftAttempted") * 100, 2) ELSE 0 END,
    $1, NOW(), NOW()
  FROM players p
  WHERE p."userId" = $1
    AND p.name IN (SELECT DISTINCT "displayName" FROM player_mappings WHERE "userId" = $1)
  GROUP BY p.name
`;

async function main(): Promise<void> {
  const { email, dryRun } = parseArgs();
  const connectionString = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DIRECT_DATABASE_URL or DATABASE_URL must be set');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Assigning all data to: ${email}\n`);

  try {
    await client.query('BEGIN');

    // 1. Resolve target (must exist and have a password).
    const target = (
      await client.query<{ id: string; email: string }>(
        'SELECT id, email FROM users WHERE LOWER(email) = LOWER($1) AND "passwordHash" IS NOT NULL',
        [email],
      )
    ).rows[0];
    if (!target) {
      throw new Error(
        `No password-based account found for "${email}". Sign up through the app first.`,
      );
    }
    const targetId = target.id;
    console.log(`Target account: ${target.email} (${targetId})`);

    // Before-counts
    const before = {
      users: await count(client, 'SELECT COUNT(*) n FROM users'),
      games: await count(client, 'SELECT COUNT(*) n FROM games'),
      gamesOther: await count(client, 'SELECT COUNT(*) n FROM games WHERE "userId" <> $1', [targetId]),
      mappingsOther: await count(client, 'SELECT COUNT(*) n FROM player_mappings WHERE "userId" <> $1', [targetId]),
    };

    // 2. Reassign owned rows.
    const games = await client.query('UPDATE games SET "userId" = $1 WHERE "userId" <> $1', [targetId]);
    const players = await client.query('UPDATE players SET "userId" = $1 WHERE "userId" <> $1', [targetId]);
    const teams = await client.query('UPDATE teams SET "userId" = $1 WHERE "userId" <> $1', [targetId]);

    // 3. Mappings: move those whose gamertag the target doesn't already have,
    //    then drop the leftover duplicates.
    const mapMoved = await client.query(
      `UPDATE player_mappings pm SET "userId" = $1
       WHERE pm."userId" <> $1
         AND NOT EXISTS (
           SELECT 1 FROM player_mappings x
           WHERE x."userId" = $1 AND LOWER(x.gamertag) = LOWER(pm.gamertag)
         )`,
      [targetId],
    );
    const mapDropped = await client.query('DELETE FROM player_mappings WHERE "userId" <> $1', [targetId]);

    // 4. Wipe aggregates (also clears other users' player_totals so their
    //    NoAction FK doesn't block deletion in step 8).
    await client.query('DELETE FROM player_stats');
    await client.query('DELETE FROM player_totals');

    // 5. Recompute player_totals for the target's mapped display names.
    const allowedNames = (
      await client.query<{ displayName: string }>(
        'SELECT DISTINCT "displayName" FROM player_mappings WHERE "userId" = $1',
        [targetId],
      )
    ).rows.map((r) => r.displayName);
    if (allowedNames.length === 0) {
      console.warn(
        '\n  WARNING: target has no roster mappings — no totals/analytics will be produced.\n' +
          '  Add gamertag→name mappings on the Roster page, then re-run.\n',
      );
    }
    const totalsIns = await client.query(RECOMPUTE_TOTALS_SQL, [targetId]);

    // 6. Rebuild player_stats from the recomputed totals (same logic the app
    //    uses on save), on this transaction's client.
    await supabaseService.updatePlayerStatsFromTotals(targetId, allowedNames, client);
    const statsRebuilt = await count(client, 'SELECT COUNT(*) n FROM player_stats');

    // 7. Screenshot cleanup. Legacy values are base64 data URIs or signed URLs
    //    from a previous Supabase project (unrecoverable) — null them so only
    //    real object paths from new uploads remain.
    const shotsCleared = await client.query(
      `UPDATE games SET "screenshotUrl" = NULL
       WHERE "screenshotUrl" LIKE 'data:%' OR "screenshotUrl" LIKE 'http%'`,
    );

    // 8. Remove all other users.
    const usersDeleted = await client.query('DELETE FROM users WHERE id <> $1', [targetId]);

    // Summary
    console.log('\n--- Summary ---');
    console.log(`  games reassigned:        ${games.rowCount}  (of ${before.gamesOther} foreign)`);
    console.log(`  players reassigned:      ${players.rowCount}`);
    console.log(`  teams reassigned:        ${teams.rowCount}`);
    console.log(`  mappings moved:          ${mapMoved.rowCount}  (dropped dupes: ${mapDropped.rowCount})`);
    console.log(`  player_totals recomputed:${totalsIns.rowCount}  for names: [${allowedNames.join(', ')}]`);
    console.log(`  player_stats rebuilt:    ${statsRebuilt}`);
    console.log(`  screenshots cleared:     ${shotsCleared.rowCount}`);
    console.log(`  other users deleted:     ${usersDeleted.rowCount}  (users before: ${before.users})`);
    console.log(`  total games now owned:   ${before.games}`);

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('\n[DRY RUN] Rolled back — nothing persisted. Re-run without --dry-run to apply.\n');
    } else {
      await client.query('COMMIT');
      console.log('\nCOMMITTED — all data now belongs to the target account.\n');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
    await pgPool.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error('\nassign-owner failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
