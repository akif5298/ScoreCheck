/**
 * The pure half of player-name mapping: turning a raw extracted name into a display name
 * given an already-loaded gamertag→displayName map.
 *
 * Deliberately separate from `mappingService`. That module imports `pgPool`, which builds
 * the pg pool and both Supabase clients at module scope — so anything importing it must
 * have SUPABASE_URL and friends set merely to *load*. `applyMapping` touches no database,
 * but living in that file forced that requirement onto every consumer transitively:
 * `enhancedOCRService` imports only this function, and its unit test could not run without
 * a `.env` (which is gitignored, so CI had none and the suite failed to load at all).
 *
 * Keep this module free of any import that reaches the database layer.
 */

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
