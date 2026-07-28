/**
 * Composite lineup names — the "Akif (PG) + AI (SG) + Random (SF)" strings stored in
 * games.homeTeam / games.awayTeam / players.team / teams.name.
 *
 * They are built once at extraction time (enhancedOCRService.generateCustomTeamNames) from
 * the player names as they stood *then*. Any later rename therefore has to rewrite them too:
 * lineupEfficiency.ts joins on `p.team = g."homeTeam"`, so if the two sides stop agreeing the
 * lineup analysis silently returns nothing — no error, just missing rows.
 *
 * Rewriting by string replacement is unsafe, because one display name can be a substring of
 * another: replacing "Nil" with "Nill" inside "Nillan (PG)" yields "Nilllan (PG)". These
 * helpers parse the string into whole tokens instead, and only ever swap a complete name.
 */

export interface LineupToken {
  name: string;
  position: string;
}

const SEPARATOR = ' + ';

// Name first, position last in parentheses. The name group is greedy so a display name that
// itself contains parentheses still parses — only the trailing "(POS)" is read as a position.
const TOKEN_PATTERN = /^(.*) \(([^()]*)\)$/;

/** Returns null if any token is malformed, rather than a partial parse. */
export function parseLineupName(lineup: string): LineupToken[] | null {
  if (!lineup) return null;

  const tokens: LineupToken[] = [];
  for (const part of lineup.split(SEPARATOR)) {
    const match = TOKEN_PATTERN.exec(part);
    if (!match) return null;
    tokens.push({ name: match[1]!, position: match[2]! });
  }
  return tokens;
}

export function formatLineupName(tokens: LineupToken[]): string {
  return tokens.map((t) => `${t.name} (${t.position})`).join(SEPARATOR);
}

/**
 * Applies a rename map to a composite lineup name, preserving token order exactly.
 *
 * Three outcomes, and the distinction between the last two matters:
 *
 *  - A composite name that parses: every token is rewritten through the map.
 *  - A plain name carrying no player tokens at all ("Team B", the conventional opponent
 *    side): returned unchanged. There is nothing in it to rename, so a rename is a no-op.
 *  - A string that looks composite — it carries the separator — but will not parse: null.
 *
 * Callers must treat null as "leave this value alone and report it", never as "close
 * enough": a half-rewritten lineup name breaks the p.team = g."homeTeam" join silently.
 *
 * The pass-through case was previously null too, which was a real bug rather than caution:
 * applyRenamesToGame is all-or-nothing per game, so one "Team B" suppressed the rename for
 * every player in that game — and since that is how the opponent side is always named, it
 * fired on most real moves. Passing it through is safe because this function is a pure
 * function of the string: two columns that held equal values still hold equal values
 * afterwards, which is the invariant the join depends on.
 */
export function renameInLineupName(lineup: string, renames: Map<string, string>): string | null {
  const tokens = parseLineupName(lineup);
  if (!tokens) {
    // The separator is the only thing that distinguishes the two failure modes. Without it
    // the parse tested this exact string against TOKEN_PATTERN and it did not match, so
    // there are no player tokens in it to rewrite and it passes through. With it, this is
    // a composite name that failed to parse, and rewriting part of it is unsafe.
    return lineup && !lineup.includes(SEPARATOR) ? lineup : null;
  }

  // Round-trip guard. Cheap insurance against a display name that interacts badly with the
  // separator or the spacing, where the rebuild would differ from what is already stored.
  if (formatLineupName(tokens) !== lineup) return null;

  return formatLineupName(tokens.map((t) => ({ ...t, name: renames.get(t.name) ?? t.name })));
}
