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
 * Returns null when the string cannot be rewritten safely — it did not parse, or the parse
 * did not round-trip. Callers must treat null as "leave this value alone and report it",
 * never as "close enough": a half-rewritten lineup name breaks the p.team = g."homeTeam"
 * join, and that failure is silent.
 */
export function renameInLineupName(lineup: string, renames: Map<string, string>): string | null {
  const tokens = parseLineupName(lineup);
  if (!tokens) return null;

  // Round-trip guard. Cheap insurance against a display name that interacts badly with the
  // separator or the spacing, where the rebuild would differ from what is already stored.
  if (formatLineupName(tokens) !== lineup) return null;

  return formatLineupName(tokens.map((t) => ({ ...t, name: renames.get(t.name) ?? t.name })));
}
