import { correctName, levenshtein } from '../nameCorrection';

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('GRIM_AR15', 'GRIM_AR15')).toBe(0);
  });

  it('counts single-character substitutions', () => {
    expect(levenshtein('kitten', 'sitten')).toBe(1);
  });

  it('counts insertions and deletions', () => {
    expect(levenshtein('LyricalJuicee', 'LyricalJuiceee')).toBe(1);
    expect(levenshtein('abc', '')).toBe(3);
  });
});

describe('correctName', () => {
  const roster = ['GRIM_AR15', 'Anis_Rahman13', 'LyricalJuicee', 'VFY_Eros', 'AI Player'];

  it('returns roster spelling on exact match ignoring case', () => {
    expect(correctName('grim_ar15', roster)).toBe('GRIM_AR15');
  });

  it('snaps a 1-char typo to the roster name', () => {
    expect(correctName('LyricalJuiceee', roster)).toBe('LyricalJuicee');
  });

  it('snaps a 2-char typo to the roster name', () => {
    expect(correctName('Anis_Rahmen1', roster)).toBe('Anis_Rahman13');
  });

  it('leaves distant names unchanged', () => {
    expect(correctName('CompletelyNewPlayer', roster)).toBe('CompletelyNewPlayer');
  });

  it('never fuzzy-corrects very short names', () => {
    expect(correctName('VFYE', roster)).toBe('VFYE');
  });

  it('leaves empty names unchanged', () => {
    expect(correctName('', roster)).toBe('');
  });

  it('does not correct when two roster names tie', () => {
    const tieRoster = ['Player_One1', 'Player_One2'];
    expect(correctName('Player_One3', tieRoster)).toBe('Player_One3');
  });
});
