import { pgPool, type Queryable } from './supabase';
import { NotFoundError } from '@/errors';
import logger from '@/utils/logger';

export interface PlayerMapping {
  id: string;
  squadId: string;
  gamertag: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export async function getMappingsForSquad(squadId: string): Promise<Map<string, string>> {
  const result = await pgPool.query<{ gamertag: string; displayName: string }>(
    `SELECT gamertag, "displayName" FROM player_mappings WHERE "squadId" = $1`,
    [squadId],
  );
  const map = new Map<string, string>();
  for (const row of result.rows) {
    map.set(row.gamertag.toLowerCase().trim(), row.displayName);
  }
  return map;
}

/**
 * The set of display names a user tracks totals/analytics for — exactly the
 * display names of their gamertag mappings. Replaces the old hardcoded
 * ALLOWED_PLAYER_NAMES list: a player only accrues totals once the user maps
 * a gamertag to them on the roster page.
 */
export async function getAllowedNamesForSquad(squadId: string): Promise<Set<string>> {
  const result = await pgPool.query<{ displayName: string }>(
    `SELECT DISTINCT "displayName" FROM player_mappings WHERE "squadId" = $1`,
    [squadId],
  );
  return new Set(result.rows.map((r) => r.displayName));
}

export async function getAllowedNamesArray(squadId: string): Promise<string[]> {
  return Array.from(await getAllowedNamesForSquad(squadId));
}

export async function listMappingsForSquad(squadId: string): Promise<PlayerMapping[]> {
  const result = await pgPool.query<PlayerMapping>(
    `SELECT id, "squadId", gamertag, "displayName", "createdAt", "updatedAt"
     FROM player_mappings WHERE "squadId" = $1 ORDER BY gamertag ASC`,
    [squadId],
  );
  return result.rows;
}

export async function createMapping(
  squadId: string,
  gamertag: string,
  displayName: string,
): Promise<PlayerMapping> {
  const result = await pgPool.query<PlayerMapping>(
    `INSERT INTO player_mappings (id, "squadId", gamertag, "displayName", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, NOW(), NOW())
     RETURNING id, "squadId", gamertag, "displayName", "createdAt", "updatedAt"`,
    [squadId, gamertag, displayName],
  );
  return result.rows[0]!;
}

export async function updateMapping(
  id: string,
  squadId: string,
  gamertag: string,
  displayName: string,
): Promise<PlayerMapping> {
  const result = await pgPool.query<PlayerMapping>(
    `UPDATE player_mappings
     SET gamertag = $3, "displayName" = $4, "updatedAt" = NOW()
     WHERE id = $1 AND "squadId" = $2
     RETURNING id, "squadId", gamertag, "displayName", "createdAt", "updatedAt"`,
    [id, squadId, gamertag, displayName],
  );
  if (result.rows.length === 0) {
    throw new NotFoundError('Mapping not found');
  }
  return result.rows[0]!;
}

export async function getMappingById(id: string, squadId: string): Promise<PlayerMapping | null> {
  const result = await pgPool.query<PlayerMapping>(
    `SELECT id, "squadId", gamertag, "displayName", "createdAt", "updatedAt"
     FROM player_mappings WHERE id = $1 AND "squadId" = $2`,
    [id, squadId],
  );
  return result.rows[0] ?? null;
}

/**
 * Retroactively renames all player records that still use a gamertag.
 * Also renames players that were previously mapped to an old display name (when
 * the display name itself is being changed via an update).
 * Returns the total number of per-game player rows renamed.
 */
export async function applyRetroactiveMapping(
  squadId: string,
  gamertag: string,
  displayName: string,
  oldDisplayName?: string,
): Promise<number> {
  // One transaction across both passes: each pass writes to `players` and then to
  // `player_stats`, and a failure between those two leaves the per-game rows renamed
  // while the aggregates still carry the old name — the exact split the aggregate
  // tables exist to avoid.
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    let total = 0;
    total += await renameInDb(squadId, gamertag, displayName, client);
    if (oldDisplayName && oldDisplayName.toLowerCase() !== displayName.toLowerCase()) {
      total += await renameInDb(squadId, oldDisplayName, displayName, client);
    }

    await client.query('COMMIT');
    return total;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error({ err: rollbackErr }, 'Rollback failed after retroactive rename error');
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * `db` is required rather than defaulting to the pool: both writes below have to land in
 * the same transaction as the caller's, so there is no correct way to call this outside
 * one. Making it mandatory says that in the type rather than in a comment.
 */
async function renameInDb(
  squadId: string,
  fromName: string,
  toName: string,
  db: Queryable,
): Promise<number> {
  // Skip if the names are already the same.
  if (fromName.toLowerCase() === toName.toLowerCase()) return 0;

  // Rename per-game player records.
  const playerRes = await db.query(
    `UPDATE players SET name = $3, "updatedAt" = NOW()
     WHERE "squadId" = $1 AND LOWER(name) = LOWER($2) AND LOWER(name) != LOWER($3)`,
    [squadId, fromName, toName],
  );
  const count = playerRes.rowCount ?? 0;

  // Deliberately NOT short-circuiting on `count === 0`. The aggregate can legitimately
  // carry a name the per-game rows no longer do, and returning early left it stranded under
  // the old gamertag with no way to ever fix it from the roster page. The two tables are
  // reconciled independently; `count` reports only how many per-game rows moved.

  // Rename aggregated player_stats.
  //
  // player_stats is UNIQUE(playerName, squadId), so if the target name already has a row
  // the rename would collide. Resolve that by dropping the stale source row first: the
  // target row's stats were built from uploads that already had the mapping active, so it
  // is the more current of the two.
  //
  // Done as an explicit conditional DELETE rather than by catching the unique violation.
  // Catching was actively harmful — a bare `catch` also swallowed transient failures
  // (a dropped connection, a deadlock) and deleted the aggregates in response to an error
  // that should simply have been retried. It is also unusable inside a transaction, where
  // any failed statement aborts the surrounding work.
  await db.query(
    `DELETE FROM player_stats
      WHERE "squadId" = $1 AND LOWER("playerName") = LOWER($2)
        AND EXISTS (
          SELECT 1 FROM player_stats existing
           WHERE existing."squadId" = $1 AND LOWER(existing."playerName") = LOWER($3)
        )`,
    [squadId, fromName, toName],
  );

  await db.query(
    `UPDATE player_stats SET "playerName" = $3, "updatedAt" = NOW()
     WHERE "squadId" = $1 AND LOWER("playerName") = LOWER($2)`,
    [squadId, fromName, toName],
  );

  return count;
}

export async function deleteMapping(id: string, squadId: string): Promise<void> {
  const result = await pgPool.query(
    `DELETE FROM player_mappings WHERE id = $1 AND "squadId" = $2`,
    [id, squadId],
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new NotFoundError('Mapping not found');
  }
}

/**
 * Shortest gamertag that may be matched as a substring rather than exactly.
 *
 * Below this, a substring match is not evidence of identity: a two-letter roster entry
 * like "ak" is contained in "akif", "akira" and "akash" alike, so it would quietly resolve
 * three different people to one — and merged stats are far harder to notice than a name
 * left unmapped. Exact matches are unaffected, so a genuinely short gamertag still works.
 */
const MIN_SUBSTRING_MATCH_LENGTH = 3;

/**
 * Applies a gamertag→displayName mapping to a raw extracted player name.
 *
 * Exact match (case-insensitive) first, then a substring match in either direction — the
 * stored value may be a decorated gamertag ("xxakifxx_ps5") or a truncated one, because
 * OCR reads whatever the scoreboard had room for.
 *
 * Among substring candidates the LONGEST key wins. Previously the first match in map order
 * won, which meant the answer depended on the order roster entries happened to be inserted:
 * two squads with identical rosters could resolve the same gamertag to different people.
 */
export function applyMapping(rawName: string, mappings: Map<string, string>): string {
  if (!rawName) return rawName;
  const lower = rawName.toLowerCase().trim();

  if (mappings.has(lower)) return mappings.get(lower)!;

  if (lower.length < MIN_SUBSTRING_MATCH_LENGTH) return rawName;

  let best: { key: string; value: string } | undefined;
  for (const [key, value] of mappings) {
    if (key.length < MIN_SUBSTRING_MATCH_LENGTH) continue;
    if (!lower.includes(key) && !key.includes(lower)) continue;
    if (!best || key.length > best.key.length) best = { key, value };
  }

  return best ? best.value : rawName;
}
