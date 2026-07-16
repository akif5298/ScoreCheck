import { alignBySlots, ExtractedPlayer } from '../ollamaExtractor';

function player(slot: number | undefined, name: string): ExtractedPlayer {
  return {
    ...(slot !== undefined ? { slot } : {}),
    name, grade: 'B',
    points: 10, rebounds: 1, assists: 2, steals: 0, blocks: 0, turnovers: 1, fouls: 2,
    fgMade: 4, fgAttempted: 8, threeMade: 1, threeAttempted: 3, ftMade: 1, ftAttempted: 2,
  };
}

describe('alignBySlots', () => {
  it('pads a missing slot with an empty row instead of shifting players up', () => {
    // Slot 1 (Team A PG) missing — players 2-10 present
    const players = [2, 3, 4, 5, 6, 7, 8, 9, 10].map(s => player(s, `P${s}`));
    const aligned = alignBySlots(players);

    expect(aligned).toHaveLength(10);
    expect(aligned[0]?.name).toBe('');        // PG slot padded empty
    expect(aligned[0]?.points).toBe(0);
    expect(aligned[1]?.name).toBe('P2');      // SG stays in slot 2
    expect(aligned[5]?.name).toBe('P6');      // team boundary preserved
  });

  it('reorders out-of-sequence slots into visual positions', () => {
    const players = [3, 1, 2].concat([4, 5, 6, 7, 8, 9, 10]).map(s => player(s, `P${s}`));
    const aligned = alignBySlots(players);
    expect(aligned.map(p => p.name)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(s => `P${s}`),
    );
  });

  it('returns players unchanged when any slot is missing (older models)', () => {
    const players = [player(1, 'A'), player(undefined, 'B')];
    expect(alignBySlots(players)).toBe(players);
  });

  it('returns players unchanged on duplicate slots', () => {
    const players = [player(1, 'A'), player(1, 'B')];
    expect(alignBySlots(players)).toBe(players);
  });

  it('passes a complete 10-slot extraction through in slot order', () => {
    const players = Array.from({ length: 10 }, (_, i) => player(10 - i, `P${10 - i}`));
    const aligned = alignBySlots(players);
    expect(aligned[0]?.name).toBe('P1');
    expect(aligned[9]?.name).toBe('P10');
  });
});
