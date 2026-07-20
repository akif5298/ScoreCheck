/**
 * Reconciling player names across squads when games move between them.
 *
 * The problem: `players.name` holds a *display name*, not an identity. Mappings are applied
 * during extraction (enhancedOCRService) and the raw gamertag is never stored, so a game
 * arriving from a squad that calls someone "Nillan" carries no evidence that the target
 * squad calls the same person "Nil". Left alone they become two players, and the target
 * squad's averages are quietly wrong.
 *
 * The gamertag is the identity. Both squads map gamertag -> display name, so the shared
 * gamertag is what proves two different display names are one person:
 *
 *     source roster:  GRIM_BuLLeTzZz -> "Nillan"
 *     target roster:  GRIM_BuLLeTzZz -> "Nil"
 *     therefore:      "Nillan" in the moved games should become "Nil"
 *
 * Deliberately conservative in two places. When a display name maps to several gamertags and
 * the target squad resolves them to *different* people, this reports a conflict rather than
 * picking one — a wrong guess silently merges two real players' stats, which is worse than
 * leaving the names apart, and much harder to notice. And when the target squad has never
 * heard of the person at all, nothing is renamed; the name is reported as unmapped so the
 * user can fix it on the roster page.
 */

export interface RosterEntry {
  gamertag: string;
  displayName: string;
}

export interface Reconciliation {
  /** Source display name -> target display name. Only entries that actually change. */
  renames: Map<string, string>;
  /** Names whose gamertags resolve to more than one person in the target squad. */
  conflicts: string[];
  /** Names the target squad does not recognise; these accrue no stats until mapped. */
  unmapped: string[];
}

const norm = (s: string): string => s.toLowerCase().trim();

export function reconcileNames(
  namesInMovedGames: string[],
  sourceRoster: RosterEntry[],
  targetRoster: RosterEntry[],
): Reconciliation {
  // Source: display name -> the gamertags that resolve to it. Several gamertags per person
  // is normal — that is how a squad handles someone's alt accounts.
  const sourceGamertags = new Map<string, Set<string>>();
  for (const entry of sourceRoster) {
    const key = norm(entry.displayName);
    if (!sourceGamertags.has(key)) sourceGamertags.set(key, new Set());
    sourceGamertags.get(key)!.add(norm(entry.gamertag));
  }

  const targetByGamertag = new Map<string, string>();
  for (const entry of targetRoster) targetByGamertag.set(norm(entry.gamertag), entry.displayName);

  const targetDisplayNames = new Set(targetRoster.map((e) => norm(e.displayName)));

  const renames = new Map<string, string>();
  const conflicts: string[] = [];
  const unmapped: string[] = [];

  for (const name of new Set(namesInMovedGames)) {
    const known = sourceGamertags.get(norm(name));
    // If the source squad never mapped this name, the stored value *is* the raw gamertag,
    // so try it as one. Only as a fallback: when the source does know the name, its
    // gamertags are better evidence than the display name itself.
    const candidates = known ?? new Set([norm(name)]);

    const resolved = new Set<string>();
    for (const gamertag of candidates) {
      const targetName = targetByGamertag.get(gamertag);
      if (targetName) resolved.add(targetName);
    }

    if (resolved.size > 1) {
      conflicts.push(name);
      continue;
    }

    if (resolved.size === 1) {
      const targetName = [...resolved][0]!;
      if (targetName !== name) renames.set(name, targetName);
      continue;
    }

    // No gamertag match. The target may still track this exact display name under a
    // gamertag neither squad shares, in which case there is nothing to fix.
    if (!targetDisplayNames.has(norm(name))) unmapped.push(name);
  }

  return { renames, conflicts, unmapped };
}

/**
 * Renaming can collapse two distinct players in one game onto the same name, which violates
 * players' [gameId, name, team] uniqueness — and would silently sum two people's stat lines
 * if it did not. Returns the target names that more than one source name maps onto.
 */
export function findCollidingRenames(
  namesInMovedGames: string[],
  renames: Map<string, string>,
): string[] {
  const arrivingAt = new Map<string, Set<string>>();
  for (const name of new Set(namesInMovedGames)) {
    const final = renames.get(name) ?? name;
    if (!arrivingAt.has(final)) arrivingAt.set(final, new Set());
    arrivingAt.get(final)!.add(name);
  }

  return [...arrivingAt.entries()].filter(([, sources]) => sources.size > 1).map(([final]) => final);
}
