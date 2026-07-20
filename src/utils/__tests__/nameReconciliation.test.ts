import { reconcileNames, findCollidingRenames, RosterEntry } from '@/utils/nameReconciliation';

const roster = (...pairs: [string, string][]): RosterEntry[] =>
  pairs.map(([gamertag, displayName]) => ({ gamertag, displayName }));

describe('reconcileNames', () => {
  it('renames via a gamertag shared by both squads', () => {
    const result = reconcileNames(
      ['Nillan'],
      roster(['GRIM_BuLLeTzZz', 'Nillan']),
      roster(['GRIM_BuLLeTzZz', 'Nil']),
    );

    expect(result.renames.get('Nillan')).toBe('Nil');
    expect(result.conflicts).toEqual([]);
    expect(result.unmapped).toEqual([]);
  });

  it('records no rename when both squads already agree', () => {
    const result = reconcileNames(
      ['Nillan'],
      roster(['GRIM_BuLLeTzZz', 'Nillan']),
      roster(['GRIM_BuLLeTzZz', 'Nillan']),
    );

    expect(result.renames.size).toBe(0);
    expect(result.unmapped).toEqual([]);
  });

  it('matches gamertags case-insensitively', () => {
    const result = reconcileNames(
      ['Nillan'],
      roster(['GRIM_BuLLeTzZz', 'Nillan']),
      roster(['grim_bulletzzz', 'Nil']),
    );

    expect(result.renames.get('Nillan')).toBe('Nil');
  });

  it('resolves through any one of several gamertags for the same person', () => {
    // Alt accounts: the source knows two tags, the target only one of them.
    const result = reconcileNames(
      ['Nillan'],
      roster(['GRIM_BuLLeTzZz', 'Nillan'], ['nil_alt', 'Nillan']),
      roster(['nil_alt', 'Nil']),
    );

    expect(result.renames.get('Nillan')).toBe('Nil');
    expect(result.conflicts).toEqual([]);
  });

  it('reports a conflict instead of guessing when gamertags disagree', () => {
    // The source lumped two tags under one name; the target treats them as two people.
    // Picking either would silently merge two players' stats.
    const result = reconcileNames(
      ['Nillan'],
      roster(['tag_a', 'Nillan'], ['tag_b', 'Nillan']),
      roster(['tag_a', 'Nil'], ['tag_b', 'Dylan']),
    );

    expect(result.conflicts).toEqual(['Nillan']);
    expect(result.renames.size).toBe(0);
  });

  it('reports a name the target squad has never heard of', () => {
    const result = reconcileNames(
      ['Nillan'],
      roster(['GRIM_BuLLeTzZz', 'Nillan']),
      roster(['someone_else', 'Akif']),
    );

    expect(result.unmapped).toEqual(['Nillan']);
    expect(result.renames.size).toBe(0);
  });

  it('does not report a name the target already tracks under its own gamertag', () => {
    // Same display name on both sides via different tags — nothing to fix, and flagging it
    // would send the user to the roster page for no reason.
    const result = reconcileNames(
      ['Nillan'],
      roster(['tag_a', 'Nillan']),
      roster(['tag_b', 'Nillan']),
    );

    expect(result.unmapped).toEqual([]);
    expect(result.renames.size).toBe(0);
  });

  it('treats an unmapped stored name as a raw gamertag', () => {
    // Games uploaded before the roster existed keep the raw gamertag in players.name.
    const result = reconcileNames(
      ['GRIM_BuLLeTzZz'],
      roster(),
      roster(['GRIM_BuLLeTzZz', 'Nil']),
    );

    expect(result.renames.get('GRIM_BuLLeTzZz')).toBe('Nil');
  });

  it('prefers the source roster over the raw-gamertag fallback', () => {
    // "Nillan" is a display name here, so its gamertag is the evidence — not the chance
    // that some unrelated player in the target uses "nillan" as a tag.
    const result = reconcileNames(
      ['Nillan'],
      roster(['GRIM_BuLLeTzZz', 'Nillan']),
      roster(['GRIM_BuLLeTzZz', 'Nil'], ['nillan', 'SomeoneElse']),
    );

    expect(result.renames.get('Nillan')).toBe('Nil');
  });

  it('reports AI and unmapped filler as unmapped without renaming', () => {
    const result = reconcileNames(
      ['AI Player', 'Nillan'],
      roster(['GRIM_BuLLeTzZz', 'Nillan']),
      roster(['GRIM_BuLLeTzZz', 'Nil']),
    );

    expect(result.unmapped).toEqual(['AI Player']);
    expect(result.renames.get('Nillan')).toBe('Nil');
  });

  it('deduplicates repeated names', () => {
    const result = reconcileNames(
      ['Nillan', 'Nillan', 'Nillan'],
      roster(['tag', 'Nillan']),
      roster(['tag', 'Nil']),
    );

    expect(result.renames.size).toBe(1);
  });

  it('handles empty rosters on both sides', () => {
    const result = reconcileNames(['Akif'], roster(), roster());

    expect(result.renames.size).toBe(0);
    expect(result.conflicts).toEqual([]);
    expect(result.unmapped).toEqual(['Akif']);
  });
});

describe('findCollidingRenames', () => {
  it('finds two names collapsing onto one', () => {
    // Both source names resolve to the same person in the target. Applying both would break
    // players' [gameId, name, team] uniqueness, or silently sum two stat lines.
    const renames = new Map([
      ['Nillan', 'Nil'],
      ['Nilly', 'Nil'],
    ]);

    expect(findCollidingRenames(['Nillan', 'Nilly'], renames)).toEqual(['Nil']);
  });

  it('finds a rename colliding with an untouched name', () => {
    const renames = new Map([['Nillan', 'Nil']]);

    expect(findCollidingRenames(['Nillan', 'Nil'], renames)).toEqual(['Nil']);
  });

  it('returns nothing when every name stays distinct', () => {
    const renames = new Map([['Nillan', 'Nil']]);

    expect(findCollidingRenames(['Nillan', 'Akif'], renames)).toEqual([]);
  });

  it('returns nothing for an empty rename map', () => {
    expect(findCollidingRenames(['Nillan', 'Akif'], new Map())).toEqual([]);
  });
});
