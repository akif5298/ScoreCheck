import { pgClient } from './supabase';
import logger from '@/utils/logger';

export interface PlayerMapping {
  id: string;
  userId: string;
  gamertag: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export async function getMappingsForUser(userId: string): Promise<Map<string, string>> {
  const result = await pgClient.query<{ gamertag: string; displayName: string }>(
    `SELECT gamertag, "displayName" FROM player_mappings WHERE "userId" = $1`,
    [userId],
  );
  const map = new Map<string, string>();
  for (const row of result.rows) {
    map.set(row.gamertag.toLowerCase().trim(), row.displayName);
  }
  return map;
}

export async function listMappingsForUser(userId: string): Promise<PlayerMapping[]> {
  const result = await pgClient.query<PlayerMapping>(
    `SELECT id, "userId", gamertag, "displayName", "createdAt", "updatedAt"
     FROM player_mappings WHERE "userId" = $1 ORDER BY gamertag ASC`,
    [userId],
  );
  return result.rows;
}

export async function createMapping(
  userId: string,
  gamertag: string,
  displayName: string,
): Promise<PlayerMapping> {
  const result = await pgClient.query<PlayerMapping>(
    `INSERT INTO player_mappings (id, "userId", gamertag, "displayName", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, NOW(), NOW())
     RETURNING id, "userId", gamertag, "displayName", "createdAt", "updatedAt"`,
    [userId, gamertag, displayName],
  );
  return result.rows[0]!;
}

export async function updateMapping(
  id: string,
  userId: string,
  gamertag: string,
  displayName: string,
): Promise<PlayerMapping> {
  const result = await pgClient.query<PlayerMapping>(
    `UPDATE player_mappings
     SET gamertag = $3, "displayName" = $4, "updatedAt" = NOW()
     WHERE id = $1 AND "userId" = $2
     RETURNING id, "userId", gamertag, "displayName", "createdAt", "updatedAt"`,
    [id, userId, gamertag, displayName],
  );
  if (result.rows.length === 0) {
    throw Object.assign(new Error('Mapping not found'), { status: 404 });
  }
  return result.rows[0]!;
}

export async function getMappingById(id: string, userId: string): Promise<PlayerMapping | null> {
  const result = await pgClient.query<PlayerMapping>(
    `SELECT id, "userId", gamertag, "displayName", "createdAt", "updatedAt"
     FROM player_mappings WHERE id = $1 AND "userId" = $2`,
    [id, userId],
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
  userId: string,
  gamertag: string,
  displayName: string,
  oldDisplayName?: string,
): Promise<number> {
  let total = 0;
  total += await renameInDb(userId, gamertag, displayName);
  if (oldDisplayName && oldDisplayName.toLowerCase() !== displayName.toLowerCase()) {
    total += await renameInDb(userId, oldDisplayName, displayName);
  }
  return total;
}

async function renameInDb(userId: string, fromName: string, toName: string): Promise<number> {
  // Skip if the names are already the same.
  if (fromName.toLowerCase() === toName.toLowerCase()) return 0;

  // Rename per-game player records.
  const playerRes = await pgClient.query(
    `UPDATE players SET name = $3, "updatedAt" = NOW()
     WHERE "userId" = $1 AND LOWER(name) = LOWER($2) AND LOWER(name) != LOWER($3)`,
    [userId, fromName, toName],
  );
  const count = playerRes.rowCount ?? 0;
  if (count === 0) return 0;

  // Rename aggregated player_stats.
  // On unique-constraint conflict (displayName already has stats), delete the
  // stale gamertag row — the displayName row's stats were built from uploads
  // that already had the mapping active and are more current.
  try {
    await pgClient.query(
      `UPDATE player_stats SET "playerName" = $3, "updatedAt" = NOW()
       WHERE "userId" = $1 AND LOWER("playerName") = LOWER($2)`,
      [userId, fromName, toName],
    );
  } catch {
    await pgClient.query(
      `DELETE FROM player_stats WHERE "userId" = $1 AND LOWER("playerName") = LOWER($2)`,
      [userId, fromName],
    );
  }

  return count;
}

export async function deleteMapping(id: string, userId: string): Promise<void> {
  const result = await pgClient.query(
    `DELETE FROM player_mappings WHERE id = $1 AND "userId" = $2`,
    [id, userId],
  );
  if ((result.rowCount ?? 0) === 0) {
    throw Object.assign(new Error('Mapping not found'), { status: 404 });
  }
}

/**
 * Applies a gamertag→displayName mapping to a raw extracted player name.
 * Checks exact match (case-insensitive) then substring match.
 * Returns the display name if matched, original name if not.
 */
export function applyMapping(rawName: string, mappings: Map<string, string>): string {
  if (!rawName) return rawName;
  const lower = rawName.toLowerCase().trim();

  if (mappings.has(lower)) return mappings.get(lower)!;

  for (const [key, value] of mappings) {
    if (lower.includes(key) || key.includes(lower)) return value;
  }

  return rawName;
}
