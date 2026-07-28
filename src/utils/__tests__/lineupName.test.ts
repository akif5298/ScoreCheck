import { parseLineupName, formatLineupName, renameInLineupName } from '@/utils/lineupName';

describe('parseLineupName', () => {
  it('splits a lineup into name/position tokens', () => {
    expect(parseLineupName('Akif (PG) + AI (SG) + Random (SF)')).toEqual([
      { name: 'Akif', position: 'PG' },
      { name: 'AI', position: 'SG' },
      { name: 'Random', position: 'SF' },
    ]);
  });

  it('handles a single-player lineup', () => {
    expect(parseLineupName('Akif (PG)')).toEqual([{ name: 'Akif', position: 'PG' }]);
  });

  it('keeps spaces inside a display name', () => {
    expect(parseLineupName('VFY Eros (C)')).toEqual([{ name: 'VFY Eros', position: 'C' }]);
  });

  it('reads only the trailing parens as the position', () => {
    // A display name may legitimately contain parentheses; the greedy name group means the
    // last group wins rather than the first.
    expect(parseLineupName('Akif (the second) (PG)')).toEqual([
      { name: 'Akif (the second)', position: 'PG' },
    ]);
  });

  it.each([
    ['no position', 'Akif + AI (SG)'],
    ['empty string', ''],
    ['trailing separator', 'Akif (PG) + '],
    ['unclosed parens', 'Akif (PG'],
  ])('returns null rather than a partial parse for %s', (_label, input) => {
    expect(parseLineupName(input)).toBeNull();
  });
});

describe('formatLineupName', () => {
  it('round-trips a parsed lineup', () => {
    const lineup = 'Akif (PG) + AI (SG) + Random (SF) + Nillan (PF) + AI (C)';
    expect(formatLineupName(parseLineupName(lineup)!)).toBe(lineup);
  });
});

describe('renameInLineupName', () => {
  it('renames a matching token and leaves the rest alone', () => {
    const renamed = renameInLineupName(
      'Nillan (PG) + AI (SG) + Akif (SF)',
      new Map([['Nillan', 'Nil']]),
    );
    expect(renamed).toBe('Nil (PG) + AI (SG) + Akif (SF)');
  });

  it('preserves token order', () => {
    const renamed = renameInLineupName(
      'AI (PG) + Nillan (SG) + Random (SF)',
      new Map([['Nillan', 'Zed']]),
    );
    expect(renamed).toBe('AI (PG) + Zed (SG) + Random (SF)');
  });

  it('does not corrupt a name that contains the renamed name as a substring', () => {
    // The whole reason this is token-based. A string replace of "Nil" -> "Nill" would
    // turn "Nillan" into "Nilllan".
    const renamed = renameInLineupName(
      'Nil (PG) + Nillan (SG)',
      new Map([['Nil', 'Nill']]),
    );
    expect(renamed).toBe('Nill (PG) + Nillan (SG)');
  });

  it('renames every occurrence of the same name', () => {
    const renamed = renameInLineupName(
      'Nillan (PG) + Nillan (SG)',
      new Map([['Nillan', 'Nil']]),
    );
    expect(renamed).toBe('Nil (PG) + Nil (SG)');
  });

  it('returns the original string when no token matches', () => {
    const lineup = 'Akif (PG) + AI (SG)';
    expect(renameInLineupName(lineup, new Map([['Nillan', 'Nil']]))).toBe(lineup);
  });

  it('returns the original string for an empty rename map', () => {
    const lineup = 'Akif (PG) + AI (SG)';
    expect(renameInLineupName(lineup, new Map())).toBe(lineup);
  });

  it('matches names case-sensitively', () => {
    // Display names are stored as-is and compared as-is; a case-insensitive match here
    // would rewrite a name the caller did not ask to rewrite.
    const lineup = 'nillan (PG)';
    expect(renameInLineupName(lineup, new Map([['Nillan', 'Nil']]))).toBe(lineup);
  });

  it('returns null for a partially-parseable lineup rather than guessing', () => {
    // Callers must leave the value alone: a half-rewritten lineup name breaks the
    // p.team = g."homeTeam" join silently. The " + " marks this as a composite name whose
    // second token is malformed — quite different from a plain name (below).
    expect(renameInLineupName('Akif + AI (SG)', new Map([['Akif', 'A']]))).toBeNull();
  });

  it.each([
    ['a plain opponent name', 'Team B'],
    ['a plain name with spaces', 'The Visitors'],
    ['a plain name containing parens', 'Team B (away)x'],
  ])('passes %s through unchanged instead of failing', (_label, lineup) => {
    // These carry no player tokens at all, so there is nothing in them to rewrite and a
    // rename is a no-op. Reporting them as unrewritable used to abort the rename for the
    // WHOLE game — and since the opponent side is named "Team A"/"Team B" by convention,
    // that silently suppressed renaming on most real moves.
    expect(renameInLineupName(lineup, new Map([['Nillan', 'Nil']]))).toBe(lineup);
  });

  it('still refuses a name that carries the separator but will not parse', () => {
    // The distinction that keeps the loosening safe: structure present, parse failed.
    expect(renameInLineupName('Nillan (PG) + Akif', new Map([['Nillan', 'Nil']]))).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(renameInLineupName('', new Map())).toBeNull();
  });
});
