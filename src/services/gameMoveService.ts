/**
 * Moving games between squads (Phase 6).
 *
 * This is how the bootstrap works — you create a squad and move your existing games in —
 * and it is also the fix for "I uploaded to the wrong squad", which is the most likely
 * everyday mistake once uploads target whichever squad is active.
 *
 * A game lives in exactly one scope, so this is a move, never a fan-out. Four things have
 * to happen together or the target squad's analytics end up quietly wrong:
 *
 *   1. games, players and teams all re-scope, or orphaned rows keep the old squad's stats.
 *   2. Player names reconcile through the roster, or one person becomes two (see
 *      nameReconciliation.ts for why the gamertag is the identity and the name is not).
 *   3. The composite lineup strings rewrite alongside the names, or lineupEfficiency.ts's
 *      `p.team = g."homeTeam"` join stops matching and silently returns nothing.
 *   4. Aggregates recompute for the target AND every source, because player_totals has no
 *      decrement path — a game moved out would otherwise stay in the source's totals
 *      forever.
 */

import { pgPool, type Queryable, SQUAD_SAVE_LOCK_NAMESPACE } from './supabase';
import supabaseService from './supabase';
import { assertMember, getMembership, SquadError } from './squadService';
import { hammingDistance, DUPLICATE_HAMMING_THRESHOLD } from '@/utils/imageHash';
import { renameInLineupName } from '@/utils/lineupName';
import { reconcileNames, findCollidingRenames, type RosterEntry } from '@/utils/nameReconciliation';
import logger from '@/utils/logger';

export interface MoveResult {
  /** Games whose scope actually changed. */
  moved: string[];
  /** Already in the target squad; a no-op rather than an error, so re-running is safe. */
  alreadyThere: string[];
  /** The target squad already holds a perceptually identical screenshot. */
  duplicates: Array<{ gameId: string; existingGameId: string }>;
  /** Names rewritten to the target squad's spelling. */
  renamed: Array<{ from: string; to: string }>;
  /** Names whose gamertags resolve to different people in the target; left untouched. */
  conflicts: string[];
  /** Names the target squad does not recognise. These accrue no stats until mapped. */
  unmapped: string[];
  /** Games moved without renaming because a lineup string could not be parsed. */
  lineupRewriteSkipped: string[];
}

interface GameRow {
  id: string;
  squadId: string;
  uploadedByUserId: string;
  imageHash: string | null;
}

async function loadRoster(squadId: string, db: Queryable): Promise<RosterEntry[]> {
  const { rows } = await db.query<RosterEntry>(
    `SELECT gamertag, "displayName" FROM player_mappings WHERE "squadId" = $1`,
    [squadId],
  );
  return rows;
}

/**
 * Rewrites one game's player names and every lineup string that mentions them.
 *
 * All-or-nothing per game: if any lineup string fails to parse, nothing in that game is
 * renamed. A partial rewrite would leave players.team disagreeing with games."homeTeam",
 * and that breaks the lineup join with no error — far worse than leaving the old name in
 * place, which is merely untidy and fixable from the roster page.
 *
 * Returns false when the game was left alone.
 */
async function applyRenamesToGame(
  gameId: string,
  renames: Map<string, string>,
  client: Queryable,
): Promise<boolean> {
  const game = await client.query<{ homeTeam: string; awayTeam: string }>(
    'SELECT "homeTeam", "awayTeam" FROM games WHERE id = $1',
    [gameId],
  );
  const players = await client.query<{ id: string; name: string; team: string }>(
    'SELECT id, name, team FROM players WHERE "gameId" = $1',
    [gameId],
  );
  const teams = await client.query<{ id: string; name: string }>(
    'SELECT id, name FROM teams WHERE "gameId" = $1',
    [gameId],
  );

  // Compute every rewrite before applying any of them.
  const row = game.rows[0];
  if (!row) return false;

  const newHome = renameInLineupName(row.homeTeam, renames);
  const newAway = renameInLineupName(row.awayTeam, renames);
  if (newHome === null || newAway === null) return false;

  const playerTeams = new Map<string, string>();
  for (const p of players.rows) {
    const rewritten = renameInLineupName(p.team, renames);
    if (rewritten === null) return false;
    playerTeams.set(p.id, rewritten);
  }

  const teamNames = new Map<string, string>();
  for (const t of teams.rows) {
    const rewritten = renameInLineupName(t.name, renames);
    if (rewritten === null) return false;
    teamNames.set(t.id, rewritten);
  }

  // Every string parsed; commit the rewrite.
  await client.query('UPDATE games SET "homeTeam" = $2, "awayTeam" = $3, "updatedAt" = NOW() WHERE id = $1', [
    gameId,
    newHome,
    newAway,
  ]);

  for (const p of players.rows) {
    await client.query(
      'UPDATE players SET name = $2, team = $3, "updatedAt" = NOW() WHERE id = $1',
      [p.id, renames.get(p.name) ?? p.name, playerTeams.get(p.id)!],
    );
  }

  for (const t of teams.rows) {
    await client.query('UPDATE teams SET name = $2, "updatedAt" = NOW() WHERE id = $1', [
      t.id,
      teamNames.get(t.id)!,
    ]);
  }

  return true;
}

/**
 * Moves games into `targetSquadId`.
 *
 * Permissions follow the plan's rule that relocating a game is a deletion from the source
 * squad's point of view: the caller must be the game's uploader or an OWNER of the source
 * squad, and must be a member of the target. A plain member therefore cannot walk off with
 * the group's shared history.
 */
export async function moveGamesToSquad(
  userId: string,
  targetSquadId: string,
  gameIds: string[],
): Promise<MoveResult> {
  if (gameIds.length === 0) {
    throw new SquadError(400, 'No games selected');
  }

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    // Throws 404, not 403, for a squad the caller is not in — membership is not disclosed.
    await assertMember(userId, targetSquadId, client);

    const { rows: games } = await client.query<GameRow>(
      `SELECT id, "squadId", "uploadedByUserId", "imageHash"
       FROM games WHERE id = ANY($1::text[]) FOR UPDATE`,
      [gameIds],
    );

    if (games.length !== gameIds.length) {
      throw new SquadError(404, 'One or more games were not found');
    }

    const sourceSquadIds = [...new Set(games.map((g) => g.squadId))].filter(
      (id) => id !== targetSquadId,
    );

    // Serialise against concurrent saves into any squad involved, so the duplicate check
    // below cannot be raced the way the save path could be before Phase 3. Locks are taken
    // in a deterministic order: two moves touching the same pair of squads in opposite
    // directions would otherwise deadlock.
    for (const squadId of [...sourceSquadIds, targetSquadId].sort()) {
      await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
        SQUAD_SAVE_LOCK_NAMESPACE,
        squadId,
      ]);
    }

    // Permission: uploader of the game, or OWNER of the squad it is leaving.
    for (const squadId of sourceSquadIds) {
      const membership = await getMembership(userId, squadId, client);
      if (!membership) throw new SquadError(404, 'One or more games were not found');

      if (membership.role !== 'OWNER') {
        const notMine = games.find(
          (g) => g.squadId === squadId && g.uploadedByUserId !== userId,
        );
        if (notMine) {
          throw new SquadError(
            403,
            'You can only move games you uploaded, unless you own the squad',
          );
        }
      }
    }

    const alreadyThere = games.filter((g) => g.squadId === targetSquadId).map((g) => g.id);
    const candidates = games.filter((g) => g.squadId !== targetSquadId);

    // Duplicate check against the target's existing games — the same perceptual match the
    // upload and save paths use, at the same threshold so the three cannot disagree.
    const { rows: targetHashes } = await client.query<{ id: string; imageHash: string }>(
      `SELECT id, "imageHash" FROM games
       WHERE "squadId" = $1 AND "imageHash" IS NOT NULL AND NOT (id = ANY($2::text[]))`,
      [targetSquadId, gameIds],
    );

    const duplicates: MoveResult['duplicates'] = [];
    const toMove: GameRow[] = [];
    for (const game of candidates) {
      const match = game.imageHash
        ? targetHashes.find(
            (row) =>
              row.imageHash.length === game.imageHash!.length &&
              hammingDistance(game.imageHash!, row.imageHash) <= DUPLICATE_HAMMING_THRESHOLD,
          )
        : undefined;

      if (match) duplicates.push({ gameId: game.id, existingGameId: match.id });
      else toMove.push(game);
    }

    const result: MoveResult = {
      moved: toMove.map((g) => g.id),
      alreadyThere,
      duplicates,
      renamed: [],
      conflicts: [],
      unmapped: [],
      lineupRewriteSkipped: [],
    };

    if (toMove.length === 0) {
      await client.query('COMMIT');
      return result;
    }

    const targetRoster = await loadRoster(targetSquadId, client);
    const movedIds = toMove.map((g) => g.id);

    // Re-scope first, so the rename below operates on rows already owned by the target.
    await client.query('UPDATE games SET "squadId" = $1, "updatedAt" = NOW() WHERE id = ANY($2::text[])', [
      targetSquadId,
      movedIds,
    ]);
    await client.query(
      'UPDATE players SET "squadId" = $1, "updatedAt" = NOW() WHERE "gameId" = ANY($2::text[])',
      [targetSquadId, movedIds],
    );
    await client.query(
      'UPDATE teams SET "squadId" = $1, "updatedAt" = NOW() WHERE "gameId" = ANY($2::text[])',
      [targetSquadId, movedIds],
    );

    // Reconcile per source squad: each has its own roster, so "Nillan" arriving from one
    // squad and from another are not necessarily the same person.
    for (const sourceSquadId of sourceSquadIds) {
      const idsFromSource = toMove.filter((g) => g.squadId === sourceSquadId).map((g) => g.id);
      if (idsFromSource.length === 0) continue;

      const { rows: nameRows } = await client.query<{ name: string }>(
        'SELECT DISTINCT name FROM players WHERE "gameId" = ANY($1::text[])',
        [idsFromSource],
      );
      const names = nameRows.map((r) => r.name);

      const sourceRoster = await loadRoster(sourceSquadId, client);
      const { renames, conflicts, unmapped } = reconcileNames(names, sourceRoster, targetRoster);

      result.conflicts.push(...conflicts);
      result.unmapped.push(...unmapped);

      if (renames.size === 0) continue;

      // Two source names collapsing onto one target name would breach players'
      // [gameId, name, team] uniqueness and, worse, sum two people's stat lines. Refuse
      // the whole move rather than half-apply it — the user fixes the roster and retries.
      const colliding = findCollidingRenames(names, renames);
      if (colliding.length > 0) {
        throw new SquadError(
          409,
          `Moving these games would merge two different players into ${colliding.join(', ')}. ` +
            `Fix the roster in the target squad first.`,
        );
      }

      for (const gameId of idsFromSource) {
        const applied = await applyRenamesToGame(gameId, renames, client);
        if (!applied) result.lineupRewriteSkipped.push(gameId);
      }

      for (const [from, to] of renames) result.renamed.push({ from, to });
    }

    // Both scopes, always. player_totals is add-only, so the source squad's totals still
    // include these games until they are rebuilt from the players rows.
    for (const squadId of [...sourceSquadIds, targetSquadId]) {
      await supabaseService.recomputeSquadAggregates(squadId, client);
    }

    await client.query('COMMIT');

    logger.info(
      {
        userId,
        targetSquadId,
        moved: result.moved.length,
        duplicates: result.duplicates.length,
        renamed: result.renamed.length,
      },
      'Moved games between squads',
    );

    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
