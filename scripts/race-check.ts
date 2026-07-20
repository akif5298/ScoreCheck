/**
 * Concurrency harness for the save-time duplicate check. NOT part of the app and NOT run
 * by `npm test` — it needs a real Postgres, because the guarantee it verifies (an advisory
 * lock serialising concurrent transactions) cannot be reproduced against a mock.
 *
 * It drives the real SupabaseService.saveGameWithStats from several simultaneous
 * connections and asserts the claim the whole squad-dedup feature rests on: N members
 * saving the same screenshot at the same time produce exactly ONE game.
 *
 * Recorded results (2026-07-20, Postgres 17.10, production DDL):
 *   - with the fix                     → all 16 checks pass
 *   - with the check removed entirely  → 5 games instead of 1
 *   - with the re-check but NO lock    → 3 games instead of 1  ← the lock is load-bearing;
 *     the re-check alone is a partial fix that looks correct under light testing
 *
 * To run:
 *   docker run -d --rm --name sc-race -e POSTGRES_PASSWORD=race -p 55433:5432 postgres:17
 *   pg_dump --schema-only --no-owner -t public.games -t public.players -t public.teams \
 *     "$PROD_DATABASE_URL" | docker exec -i sc-race psql -U postgres
 *   DATABASE_URL="postgresql://postgres:race@localhost:55433/postgres" \
 *     SUPABASE_URL=http://localhost:1 SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=y \
 *     npx ts-node -r tsconfig-paths/register scripts/race-check.ts
 *
 * It TRUNCATEs games/players/teams between scenarios — never point it at production.
 */
import { randomUUID } from 'node:crypto';
import supabaseService, { DuplicateGameError, pgPool } from '@/services/supabase';

const SQUAD_A = 'squad-A';
const SQUAD_B = 'squad-B';

const BASE = '00'.repeat(30);
const THREE_BITS_OFF = '07' + '00'.repeat(29); // hamming 3 → same game
const DIFFERENT = 'ff'.repeat(30); // hamming 240 → different game

function game(squadId: string, imageHash: string | null, uploader: string) {
  const id = `game_${randomUUID()}`;
  return {
    id,
    date: new Date().toISOString(),
    homeTeam: 'Team A',
    awayTeam: 'Team B',
    homeScore: 95,
    awayScore: 87,
    screenshotUrl: `path/${id}.jpg`,
    imageHash,
    processed: true,
    squadId,
    uploadedByUserId: uploader,
  };
}

const player = (gameId: string, squadId: string) => ({
  id: `player_${randomUUID()}`,
  name: 'Akif',
  team: 'Team A',
  teammateGrade: 'A',
  gameIdFromFile: '1',
  playerId: '1_1_A',
  position: 'PG',
  points: 20,
  rebounds: 5,
  assists: 3,
  steals: 1,
  blocks: 0,
  turnovers: 2,
  fouls: 3,
  fgMade: 8,
  fgAttempted: 15,
  threeMade: 2,
  threeAttempted: 5,
  ftMade: 2,
  ftAttempted: 2,
  gameId,
  squadId,
});

const team = (gameId: string, squadId: string, isHome: boolean) => ({
  id: `team_${randomUUID()}`,
  name: isHome ? 'Team A' : 'Team B',
  isHome,
  points: 95,
  rebounds: 40,
  assists: 20,
  steals: 5,
  blocks: 3,
  turnovers: 10,
  fouls: 15,
  fgMade: 35,
  fgAttempted: 70,
  threeMade: 8,
  threeAttempted: 20,
  ftMade: 17,
  ftAttempted: 20,
  gameId,
  squadId,
});

/** One simulated /save request. Resolves to 'saved' or 'duplicate'. */
async function attemptSave(squadId: string, hash: string | null, uploader: string) {
  const g = game(squadId, hash, uploader);
  try {
    await supabaseService.saveGameWithStats(
      g,
      [player(g.id, squadId)],
      team(g.id, squadId, true),
      team(g.id, squadId, false),
    );
    return 'saved';
  } catch (e) {
    if (e instanceof DuplicateGameError) return 'duplicate';
    throw e;
  }
}

const countGames = async (squadId: string) =>
  (await pgPool.query('SELECT count(*)::int AS n FROM games WHERE "squadId" = $1', [squadId]))
    .rows[0].n as number;

const countRows = async (tbl: string, squadId: string) =>
  (await pgPool.query(`SELECT count(*)::int AS n FROM ${tbl} WHERE "squadId" = $1`, [squadId]))
    .rows[0].n as number;

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} → ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
}

(async () => {
  await pgPool.query('TRUNCATE games, players, teams');

  // ── 1. Five members save the same screenshot simultaneously ──────────────────
  // The scenario the whole feature exists for.
  const five = await Promise.all([
    attemptSave(SQUAD_A, BASE, 'user-1'),
    attemptSave(SQUAD_A, THREE_BITS_OFF, 'user-2'),
    attemptSave(SQUAD_A, BASE, 'user-3'),
    attemptSave(SQUAD_A, THREE_BITS_OFF, 'user-4'),
    attemptSave(SQUAD_A, BASE, 'user-5'),
  ]);
  check('5 concurrent saves of one screenshot → games in squad', await countGames(SQUAD_A), 1);
  check('  …exactly one reported "saved"', five.filter(r => r === 'saved').length, 1);
  check('  …the other four reported "duplicate"', five.filter(r => r === 'duplicate').length, 4);
  check('  …no orphaned player rows from rolled-back saves', await countRows('players', SQUAD_A), 1);
  check('  …no orphaned team rows from rolled-back saves', await countRows('teams', SQUAD_A), 2);

  // ── 2. Concurrent saves of DIFFERENT screenshots must all succeed ────────────
  // Guards against the lock over-serialising into false duplicates.
  await pgPool.query('TRUNCATE games, players, teams');
  const distinct = await Promise.all(
    ['00', '0f', 'f0', 'ff', '3c'].map((b, i) =>
      attemptSave(SQUAD_A, b.repeat(30), `user-${i}`),
    ),
  );
  check('5 concurrent saves of 5 DIFFERENT screenshots → all saved', distinct.filter(r => r === 'saved').length, 5);
  check('  …games in squad', await countGames(SQUAD_A), 5);

  // ── 3. Two squads uploading the same screenshot must not collide ─────────────
  // Separation is the core promise of the squad model.
  await pgPool.query('TRUNCATE games, players, teams');
  const crossSquad = await Promise.all([
    attemptSave(SQUAD_A, BASE, 'user-1'),
    attemptSave(SQUAD_B, BASE, 'user-9'),
  ]);
  check('same screenshot in two squads → both saved', crossSquad, ['saved', 'saved']);
  check('  …squad A has its own copy', await countGames(SQUAD_A), 1);
  check('  …squad B has its own copy', await countGames(SQUAD_B), 1);

  // ── 4. Sequential duplicate (the already-working case) still works ───────────
  await pgPool.query('TRUNCATE games, players, teams');
  const first = await attemptSave(SQUAD_A, BASE, 'user-1');
  const second = await attemptSave(SQUAD_A, THREE_BITS_OFF, 'user-2');
  check('sequential duplicate', [first, second], ['saved', 'duplicate']);
  check('  …games in squad', await countGames(SQUAD_A), 1);

  // ── 5. Hash-less saves are not deduped against each other ───────────────────
  await pgPool.query('TRUNCATE games, players, teams');
  const noHash = await Promise.all([
    attemptSave(SQUAD_A, null, 'user-1'),
    attemptSave(SQUAD_A, null, 'user-2'),
  ]);
  check('two hash-less saves both persist', noHash, ['saved', 'saved']);

  // ── 6. A genuinely different game is never mistaken for the duplicate ───────
  await pgPool.query('TRUNCATE games, players, teams');
  await attemptSave(SQUAD_A, BASE, 'user-1');
  check('different screenshot after a save', await attemptSave(SQUAD_A, DIFFERENT, 'user-2'), 'saved');
  check('  …games in squad', await countGames(SQUAD_A), 2);

  // ── 7. NULL squadId must not silently skip the lock ─────────────────────────
  // pg_advisory_xact_lock is strict: a NULL argument returns NULL without locking.
  // Confirm the save cannot proceed anyway (games.squadId is NOT NULL).
  const nullSquad = await attemptSave(null as any, BASE, 'user-1')
    .then(() => 'saved')
    .catch(e => `rejected: ${e.code ?? e.message.slice(0, 40)}`);
  check('NULL squadId is rejected by the database', nullSquad.startsWith('rejected'), true);
  console.log(`      (${nullSquad})`);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  await pgPool.end();
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
  console.error('HARNESS ERROR:', e);
  process.exit(1);
});
