/**
 * Import the hand-labeled ground-truth dataset (eval/training_data.json) as
 * real games for a single owner account — the production-baseline data.
 *
 * Why: the labeled data is known-correct (vs. OCR-extracted games, which can
 * contain errors). Each of the 38 labeled screenshots has 10 players with
 * team (A/B), slot, teammate grade, and all stats. We derive everything a
 * game needs:
 *   - player names  → mapped through the owner's roster (gamertag → friend name)
 *   - positions     → from slot (1/6→PG, 2/7→SG, 3/8→SF, 4/9→PF, 5/10→C)
 *   - scores        → sum of each team's player points
 *   - team names    → lineup strings like
 *                     "Akif (PG) + Dylan (SG) + Nillan (SF) + AI (PF) + Anis (C)"
 *                     (friend display name / AI / Random, in position order);
 *                     "Team A"/"Team B" if a team has no friends
 *   - dates         → placeholder dates in IMG_#### (chronological) order; the
 *                     screenshot mtimes are a bulk-copy timestamp, not play dates
 *
 * players.team is stored EQUAL to games.homeTeam/awayTeam so the lineup-
 * efficiency query (which joins on p.team = g.homeTeam) computes correctly.
 *
 * SAFETY: one transaction; `--dry-run` executes everything then ROLLS BACK.
 *
 * Usage:
 *   npm run import:labeled -- --email you@example.com --dry-run   # preview
 *   npm run import:labeled -- --email you@example.com             # apply
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import supabaseService, { pgPool } from '@/services/supabase';
import { applyMapping } from '@/services/mappingService';
import { getLineupEfficiency } from '@/services/lineupEfficiency';

dotenv.config();

// ── Config ────────────────────────────────────────────────────────────────────
const DATA_FILE = 'eval/training_data.json';
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
// Placeholder dating: games spaced this many days apart in IMG order, ending on
// the anchor. Order is real (IMG numbers); absolute dates are placeholders.
const ANCHOR_DATE = new Date('2025-08-23T18:00:00Z');
const DAYS_BETWEEN = 2;

interface LabeledPlayer {
  slot: number;
  expectedName: string;
  team: 'A' | 'B';
  grade?: string;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  fgMade: number;
  fgAttempted: number;
  threeMade: number;
  threeAttempted: number;
  ftMade: number;
  ftAttempted: number;
}
interface LabeledGame {
  screenshotFile: string;
  players: LabeledPlayer[];
}

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
    else if (a?.startsWith('--email=')) email = a.slice('--email='.length);
    else if (a === '--dry-run' || a === 'dry-run') dryRun = true;
    // Positional fallback so `npm run import:labeled -- <email> dry-run` works
    // (npm 10.x swallows `--flags` after `--` as its own config).
    else if (a && !a.startsWith('-') && a.includes('@')) email = a;
  }
  if (!email) {
    console.error(
      'Usage:\n' +
        '  npm run import:labeled -- <you@example.com> [dry-run]\n' +
        '  npx ts-node -r tsconfig-paths/register scripts/import-labeled-data.ts --email <you@example.com> [--dry-run]',
    );
    process.exit(1);
  }
  return { email, dryRun };
}

const imgNum = (f: string): number => {
  const m = f.match(/(\d+)/);
  return m ? parseInt(m[1]!, 10) : 0;
};
const positionForSlot = (slot: number): string => POSITIONS[(slot - 1) % 5]!;
const isAiName = (raw: string): boolean => {
  const s = raw.trim().toLowerCase();
  return s === 'ai player' || s === 'ai' || s.startsWith('ai ');
};
const pct = (made: number, att: number): number =>
  att > 0 ? Math.round((made / att) * 100 * 100) / 100 : 0;

// player_totals recompute for the owner's mapped display names (one row per name).
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

const GAME_COLS = `(id, date, "homeTeam", "awayTeam", "homeScore", "awayScore",
  "screenshotUrl", processed, "imageHash", "userId", "createdAt", "updatedAt")`;
const PLAYER_COLS = `(id, "gameId", name, team, position, points, rebounds, assists,
  steals, blocks, turnovers, fouls, "fgMade", "fgAttempted", "threeMade",
  "threeAttempted", "ftMade", "ftAttempted", fg_percentage, three_percentage,
  ft_percentage, "teammateGrade", "playerId", "gameIdFromFile", "userId",
  "createdAt", "updatedAt")`;
const TEAM_COLS = `(id, "gameId", name, "isHome", points, rebounds, assists, steals,
  blocks, turnovers, fouls, "fgMade", "fgAttempted", "threeMade", "threeAttempted",
  "ftMade", "ftAttempted", fg_percentage, three_percentage, ft_percentage,
  "userId", "createdAt", "updatedAt")`;

function sum(players: LabeledPlayer[], key: keyof LabeledPlayer): number {
  return players.reduce((acc, p) => acc + (Number(p[key]) || 0), 0);
}

async function main(): Promise<void> {
  const { email, dryRun } = parseArgs();
  const connectionString = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DIRECT_DATABASE_URL or DATABASE_URL must be set');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as LabeledGame[];
  const games = [...raw].sort((a, b) => imgNum(a.screenshotFile) - imgNum(b.screenshotFile));

  const client = new Client({ connectionString });
  await client.connect();

  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Importing ${games.length} labeled games for: ${email}\n`);

  try {
    await client.query('BEGIN');

    // 1. Resolve owner + roster mappings.
    const target = (
      await client.query<{ id: string; email: string }>(
        'SELECT id, email FROM users WHERE LOWER(email) = LOWER($1) AND "passwordHash" IS NOT NULL',
        [email],
      )
    ).rows[0];
    if (!target) {
      throw new Error(`No password-based account found for "${email}". Sign up through the app first.`);
    }
    const targetId = target.id;

    const mapRows = (
      await client.query<{ gamertag: string; displayName: string }>(
        'SELECT gamertag, "displayName" FROM player_mappings WHERE "userId" = $1',
        [targetId],
      )
    ).rows;
    const mappings = new Map<string, string>();
    for (const m of mapRows) mappings.set(m.gamertag.toLowerCase().trim(), m.displayName);
    const allowed = new Set(mapRows.map((m) => m.displayName));
    console.log(`Owner: ${target.email} (${targetId}); ${mappings.size} roster mappings`);

    // 2. Clear all existing game data (full baseline). games cascades to
    //    players + teams; player_stats/player_totals reference users.
    await client.query('DELETE FROM games');
    await client.query('DELETE FROM player_stats');
    await client.query('DELETE FROM player_totals');

    // 3. Import each labeled game.
    let gamesIns = 0;
    let playersIns = 0;
    const N = games.length;

    for (let i = 0; i < N; i++) {
      const g = games[i]!;
      const num = imgNum(g.screenshotFile);
      const gameId = `game_import_${num}`;
      const date = new Date(ANCHOR_DATE.getTime() - (N - 1 - i) * DAYS_BETWEEN * 86_400_000);

      const teamA = g.players.filter((p) => p.team === 'A').sort((x, y) => x.slot - y.slot);
      const teamB = g.players.filter((p) => p.team === 'B').sort((x, y) => x.slot - y.slot);

      // Mapped display name + team-name label for a labeled player.
      const mappedName = (p: LabeledPlayer) => applyMapping(p.expectedName, mappings);
      const label = (p: LabeledPlayer): string => {
        const name = mappedName(p);
        if (allowed.has(name)) return name;
        if (isAiName(p.expectedName)) return 'AI';
        return 'Random';
      };
      const lineupName = (team: LabeledPlayer[]): string | null => {
        if (!team.some((p) => allowed.has(mappedName(p)))) return null;
        return team.map((p) => `${label(p)} (${positionForSlot(p.slot)})`).join(' + ');
      };

      const awayName = lineupName(teamA) ?? 'Team A'; // Team A = away
      const homeName = lineupName(teamB) ?? 'Team B'; // Team B = home
      const awayScore = sum(teamA, 'points');
      const homeScore = sum(teamB, 'points');

      await client.query(
        `INSERT INTO games ${GAME_COLS} VALUES ($1,$2,$3,$4,$5,$6,NULL,true,NULL,$7,NOW(),NOW())`,
        [gameId, date.toISOString(), homeName, awayName, homeScore, awayScore, targetId],
      );
      gamesIns++;

      // Players. team field == the game team name so lineup efficiency joins.
      const seen = new Set<string>();
      for (const p of g.players) {
        const teamName = p.team === 'A' ? awayName : homeName;
        let name = mappedName(p);
        // Defensive: keep (gameId, name, team) unique within the game.
        let key = `${name}|${teamName}`;
        if (seen.has(key)) {
          name = `${name} (${positionForSlot(p.slot)})`;
          key = `${name}|${teamName}`;
        }
        seen.add(key);
        await client.query(
          `INSERT INTO players ${PLAYER_COLS}
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,NOW(),NOW())`,
          [
            `${gameId}_P${p.slot}`, gameId, name, teamName, positionForSlot(p.slot),
            p.points, p.rebounds, p.assists, p.steals, p.blocks, p.turnovers, p.fouls,
            p.fgMade, p.fgAttempted, p.threeMade, p.threeAttempted, p.ftMade, p.ftAttempted,
            pct(p.fgMade, p.fgAttempted), pct(p.threeMade, p.threeAttempted), pct(p.ftMade, p.ftAttempted),
            p.grade ?? null, `${num}_P${p.slot}`, String(num), targetId,
          ],
        );
        playersIns++;
      }

      // Team totals.
      for (const [team, teamName, isHome] of [
        [teamA, awayName, false],
        [teamB, homeName, true],
      ] as [LabeledPlayer[], string, boolean][]) {
        await client.query(
          `INSERT INTO teams ${TEAM_COLS}
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW(),NOW())`,
          [
            `${gameId}_T${isHome ? 'H' : 'A'}`, gameId, teamName, isHome,
            sum(team, 'points'), sum(team, 'rebounds'), sum(team, 'assists'), sum(team, 'steals'),
            sum(team, 'blocks'), sum(team, 'turnovers'), sum(team, 'fouls'),
            sum(team, 'fgMade'), sum(team, 'fgAttempted'), sum(team, 'threeMade'),
            sum(team, 'threeAttempted'), sum(team, 'ftMade'), sum(team, 'ftAttempted'),
            pct(sum(team, 'fgMade'), sum(team, 'fgAttempted')),
            pct(sum(team, 'threeMade'), sum(team, 'threeAttempted')),
            pct(sum(team, 'ftMade'), sum(team, 'ftAttempted')),
            targetId,
          ],
        );
      }
    }

    // 4. Recompute totals + stats for the owner's mapped names.
    const totalsIns = await client.query(RECOMPUTE_TOTALS_SQL, [targetId]);
    await supabaseService.updatePlayerStatsFromTotals(targetId, Array.from(allowed), client);
    const statsRebuilt = (await client.query<{ n: string }>('SELECT COUNT(*) n FROM player_stats')).rows[0]!.n;

    // 5. Remove all other users.
    const usersDeleted = await client.query('DELETE FROM users WHERE id <> $1', [targetId]);

    // Sample of derived team names for a sanity check.
    const sampleTeams = (
      await client.query<{ name: string }>(
        `SELECT DISTINCT name FROM teams WHERE name LIKE '%+%' ORDER BY name LIMIT 4`,
      )
    ).rows.map((r) => r.name);

    // Verify: every player's team is one of its game's team names (the lineup
    // efficiency query joins on p.team = g.homeTeam, so this must hold).
    const orphan = (
      await client.query<{ n: string }>(
        `SELECT COUNT(*) n FROM players p JOIN games g ON g.id = p."gameId"
         WHERE p."userId" = $1 AND p.team <> g."homeTeam" AND p.team <> g."awayTeam"`,
        [targetId],
      )
    ).rows[0]!.n;
    // Verify: the lineup analysis actually produces results on the imported data.
    const lineups = await getLineupEfficiency(targetId, client);
    const topLineup = lineups[0];

    console.log('\n--- Summary ---');
    console.log(`  games imported:          ${gamesIns}`);
    console.log(`  players imported:        ${playersIns}`);
    console.log(`  player_totals recomputed:${totalsIns.rowCount}  for [${Array.from(allowed).join(', ')}]`);
    console.log(`  player_stats rebuilt:    ${statsRebuilt}`);
    console.log(`  other users deleted:     ${usersDeleted.rowCount}`);
    console.log('  sample lineup team names:');
    sampleTeams.forEach((t) => console.log(`    ${t}`));
    console.log('\n--- Verification ---');
    console.log(`  players with team not matching game teams: ${orphan}  (must be 0)`);
    console.log(`  lineup-efficiency lineups (>=2 games): ${lineups.length}`);
    if (topLineup) {
      console.log(
        `  top lineup: ${topLineup.players.join(' / ')} — ` +
          `${topLineup.games}g, ${topLineup.wins}-${topLineup.losses}, ` +
          `${topLineup.avgPointDifferential > 0 ? '+' : ''}${topLineup.avgPointDifferential} avg diff`,
      );
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('\n[DRY RUN] Rolled back — nothing persisted. Re-run without --dry-run to apply.\n');
    } else {
      await client.query('COMMIT');
      console.log('\nCOMMITTED — labeled dataset imported.\n');
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
  console.error('\nimport-labeled-data failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
