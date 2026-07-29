/**
 * Unit tests for EnhancedOCRService — the layer between raw model output and the review UI.
 *
 * extractBoxScore is mocked at the module boundary because it is the GPU call; everything
 * this file actually does (slot -> team assignment, id minting, position lookup, roster
 * mapping, composite lineup names) runs for real. The lineup names matter more than they
 * look: they are stored into games.homeTeam and players.team, and lineupEfficiency joins
 * the two on exact string equality.
 */
jest.mock('@/services/ollamaExtractor', () => ({
  extractBoxScore: jest.fn(),
}));

import { EnhancedOCRService } from '@/services/enhancedOCRService';
import { extractBoxScore } from '@/services/ollamaExtractor';
import type { Player } from '@/types';

const mockedExtract = extractBoxScore as jest.Mock;

function extractedRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    name: 'Player',
    grade: 'B',
    points: 10,
    rebounds: 5,
    assists: 3,
    steals: 1,
    blocks: 1,
    turnovers: 2,
    fouls: 2,
    fgMade: 4,
    fgAttempted: 8,
    threeMade: 1,
    threeAttempted: 3,
    ftMade: 1,
    ftAttempted: 2,
    ...over,
  };
}

/** Ten extracted rows — five per team, in slot order. */
function tenRows() {
  return Array.from({ length: 10 }, (_, i) => extractedRow({ name: `P${i + 1}`, points: i + 1 }));
}

function resolves(players: unknown[]) {
  mockedExtract.mockResolvedValue({ players, rawModelOutput: '', latencyMs: 1, model: 'test' });
}

/** A review-UI player, shaped the way extractStructuredDataFromImage emits them. */
function uiPlayer(slot: number, name: string): Player {
  const teamLetter = slot <= 5 ? 'A' : 'B';
  return {
    id: `0001_${slot}_${teamLetter}`,
    name,
    team: `Team ${teamLetter}`,
  } as unknown as Player;
}

beforeEach(() => mockedExtract.mockReset());

describe('extractStructuredDataFromImage', () => {
  it('assigns the first five rows to Team A and the rest to Team B', async () => {
    resolves(tenRows());

    const out = await new EnhancedOCRService().extractStructuredDataFromImage(
      Buffer.from('img'),
      'IMG_0042.png',
    );

    expect(out.players.filter((p) => p.team === 'Team A')).toHaveLength(5);
    expect(out.players.filter((p) => p.team === 'Team B')).toHaveLength(5);
  });

  it('mints ids as <imageNumber>_<slot>_<team> and derives the position from the slot', async () => {
    resolves(tenRows());

    const out = await new EnhancedOCRService().extractStructuredDataFromImage(
      Buffer.from('img'),
      'IMG_0042.png',
    );

    expect(out.players[0]).toMatchObject({
      id: '0042_1_A',
      playerId: '0042_1_A',
      gameIdFromFile: '0042',
      position: 'PG',
    });
    // Slot 6 is the other team's point guard.
    expect(out.players[5]).toMatchObject({ id: '0042_6_B', position: 'PG' });
    expect(out.players[9]).toMatchObject({ position: 'C' });
  });

  it.each([
    ['IMG_0042.png', '0042'],
    ['123-boxscore.jpg', '123'],
    ['77.png', '77'],
    ['shot99', '99'],
  ])('reads the image number out of %s', async (filename, expected) => {
    resolves([extractedRow()]);

    const out = await new EnhancedOCRService().extractStructuredDataFromImage(
      Buffer.from('img'),
      filename,
    );

    expect(out.players[0]!.gameIdFromFile).toBe(expected);
  });

  it.each([
    ['no filename', undefined],
    ['a filename with no digits', 'screenshot.png'],
  ])('falls back to a timestamp for %s', async (_label, filename) => {
    resolves([extractedRow()]);

    const out = await new EnhancedOCRService().extractStructuredDataFromImage(
      Buffer.from('img'),
      filename,
    );

    expect(out.players[0]!.gameIdFromFile).toMatch(/^\d{10,}$/);
  });

  it('applies the squad roster to the extracted names', async () => {
    resolves([extractedRow({ name: 'xxakifxx' })]);

    const out = await new EnhancedOCRService().extractStructuredDataFromImage(
      Buffer.from('img'),
      'IMG_1.png',
      new Map([['xxakifxx', 'Akif']]),
    );

    expect(out.players[0]!.name).toBe('Akif');
  });

  it('leaves names untouched when no roster is supplied', async () => {
    resolves([extractedRow({ name: 'xxakifxx' })]);

    const out = await new EnhancedOCRService().extractStructuredDataFromImage(
      Buffer.from('img'),
      'IMG_1.png',
    );

    expect(out.players[0]!.name).toBe('xxakifxx');
  });

  it('leaves names untouched for an empty roster', async () => {
    resolves([extractedRow({ name: 'xxakifxx' })]);

    const out = await new EnhancedOCRService().extractStructuredDataFromImage(
      Buffer.from('img'),
      'IMG_1.png',
      new Map(),
    );

    expect(out.players[0]!.name).toBe('xxakifxx');
  });

  it('scores each side as the sum of its players points', async () => {
    resolves(tenRows());

    const out = await new EnhancedOCRService().extractStructuredDataFromImage(
      Buffer.from('img'),
      'IMG_1.png',
    );

    // Slots 1-5 score 1+2+3+4+5 = 15; slots 6-10 give 6+7+8+9+10 = 40.
    expect(out.gameData.homeScore).toBe(15);
    expect(out.gameData.awayScore).toBe(40);
    expect(out.teamATotals.points).toBe(15);
    expect(out.teamBTotals.points).toBe(40);
  });

  it('emits placeholder team names — the real ones are assigned after review', async () => {
    resolves(tenRows());

    const out = await new EnhancedOCRService().extractStructuredDataFromImage(
      Buffer.from('img'),
      'IMG_1.png',
    );

    expect(out.gameData).toMatchObject({ homeTeam: 'Team A', awayTeam: 'Team B', quarters: 4 });
  });

  it('carries the teammate grade through, and nulls an empty one', async () => {
    resolves([extractedRow({ grade: 'A+' }), extractedRow({ grade: '' })]);

    const out = await new EnhancedOCRService().extractStructuredDataFromImage(
      Buffer.from('img'),
      'IMG_1.png',
    );

    expect(out.players[0]!.teammateGrade).toBe('A+');
    expect(out.players[1]!.teammateGrade).toBeNull();
  });

  it('leaves squadId blank — scope is assigned at save time, not extraction', async () => {
    resolves([extractedRow()]);

    const out = await new EnhancedOCRService().extractStructuredDataFromImage(
      Buffer.from('img'),
      'IMG_1.png',
    );

    expect(out.players[0]!.squadId).toBe('');
    expect(out.players[0]!.gameId).toBe('');
  });
});

describe('getPositionFromPlayerNumber', () => {
  it.each([
    ['0001_1_A', 'PG'],
    ['0001_2_A', 'SG'],
    ['0001_3_A', 'SF'],
    ['0001_4_A', 'PF'],
    ['0001_5_A', 'C'],
    ['0001_6_B', 'PG'],
    ['0001_10_B', 'C'],
  ])('maps %s to %s', (id, expected) => {
    expect(EnhancedOCRService.getPositionFromPlayerNumber(id)).toBe(expected);
  });

  it.each([
    ['P1', 'PG'],
    ['P10', 'C'],
  ])('also accepts the bare P-prefixed form %s', (id, expected) => {
    expect(EnhancedOCRService.getPositionFromPlayerNumber(id)).toBe(expected);
  });

  it.each([
    ['a slot outside 1-10', '0001_11_B'],
    ['an id with too few parts', 'garbage'],
    ['a non-numeric slot', '0001_x_A'],
  ])('returns N/A for %s', (_label, id) => {
    expect(EnhancedOCRService.getPositionFromPlayerNumber(id)).toBe('N/A');
  });
});

describe('isCustomName', () => {
  it('matches exactly, ignoring case', () => {
    expect(EnhancedOCRService.isCustomName('akif', ['Akif'])).toBe(true);
  });

  it('strips quotes before comparing', () => {
    expect(EnhancedOCRService.isCustomName('"Akif"', ['Akif'])).toBe(true);
  });

  it('matches in both directions, so a truncated read still resolves', () => {
    expect(EnhancedOCRService.isCustomName('Akifrahman', ['Akif'])).toBe(true);
    expect(EnhancedOCRService.isCustomName('Aki', ['Akif'])).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(EnhancedOCRService.isCustomName('Stranger', ['Akif', 'Nillan'])).toBe(false);
  });

  it('returns false against an empty roster', () => {
    expect(EnhancedOCRService.isCustomName('Akif', [])).toBe(false);
  });
});

describe('generateCustomTeamNamesAfterAssignment', () => {
  const roster = ['Akif', 'Nillan'];

  it('builds a composite lineup once at least one player is recognised', () => {
    const players = [
      uiPlayer(1, 'Akif'),
      uiPlayer(2, 'AI'),
      uiPlayer(3, 'Someone'),
      uiPlayer(4, 'AI'),
      uiPlayer(5, 'Nillan'),
    ];

    const { teamAName } = EnhancedOCRService.generateCustomTeamNamesAfterAssignment(
      players,
      roster,
    );

    // Recognised players keep their name; AI teammates collapse to "AI"; everyone else
    // becomes "Random". This exact string is stored on both games.homeTeam and
    // players.team, and lineupEfficiency joins them on equality.
    expect(teamAName).toBe('Akif (PG) + AI (SG) + Random (SF) + AI (PF) + Nillan (C)');
  });

  it('falls back to the placeholder when no player on that side is recognised', () => {
    const players = [uiPlayer(1, 'Nobody'), uiPlayer(6, 'Akif')];

    const { teamAName, teamBName } = EnhancedOCRService.generateCustomTeamNamesAfterAssignment(
      players,
      roster,
    );

    expect(teamAName).toBe('Team A');
    expect(teamBName).toBe('Akif (PG)');
  });

  it('falls back for both sides when the roster is empty', () => {
    const players = [uiPlayer(1, 'Akif'), uiPlayer(6, 'Nillan')];

    expect(EnhancedOCRService.generateCustomTeamNamesAfterAssignment(players, [])).toEqual({
      teamAName: 'Team A',
      teamBName: 'Team B',
    });
  });

  it('names each side independently', () => {
    const players = [uiPlayer(1, 'Akif'), uiPlayer(6, 'Nillan')];

    expect(EnhancedOCRService.generateCustomTeamNamesAfterAssignment(players, roster)).toEqual({
      teamAName: 'Akif (PG)',
      teamBName: 'Nillan (PG)',
    });
  });
});
