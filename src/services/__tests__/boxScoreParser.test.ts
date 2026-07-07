import { BoxScoreParser } from '@/services/boxScoreParser';
import type { ExtractedRow, TeamQuarterTotals } from '@/types';

const makeRow = (overrides: Partial<ExtractedRow> = {}): ExtractedRow => ({
  playerName: 'Default Player',
  team: 'Team A',
  teammateGrade: 'B+',
  points: 10,
  rebounds: 5,
  assists: 3,
  steals: 1,
  blocks: 0,
  fouls: 2,
  turnovers: 1,
  fgMade: 4,
  fgAttempted: 8,
  threeMade: 1,
  threeAttempted: 3,
  ftMade: 1,
  ftAttempted: 2,
  ...overrides,
});

describe('BoxScoreParser', () => {
  describe('parse() — team assignment', () => {
    it('always labels homeTeam as "Team A" and awayTeam as "Team B"', () => {
      const result = new BoxScoreParser([makeRow()], 'test.jpg').parse();
      expect(result.homeTeam).toBe('Team A');
      expect(result.awayTeam).toBe('Team B');
    });

    it('routes Team A rows to homeTeam and Team B rows to awayTeam', () => {
      const rows = [
        ...Array.from({ length: 5 }, () => makeRow({ team: 'Team A' })),
        ...Array.from({ length: 5 }, () => makeRow({ team: 'Team B' })),
      ];
      const { players } = new BoxScoreParser(rows, 'IMG_1754.jpg').parse();
      expect(players.filter(p => p.team === 'Team A')).toHaveLength(5);
      expect(players.filter(p => p.team === 'Team B')).toHaveLength(5);
    });

    it('defaults players with an unknown team assignment to homeTeam', () => {
      const row = makeRow({ team: 'SomeOtherTeam' });
      const { players } = new BoxScoreParser([row], 'test.jpg').parse();
      expect(players[0]?.team).toBe('Team A');
    });

    it('handles an empty row array gracefully', () => {
      const result = new BoxScoreParser([], 'test.jpg').parse();
      expect(result.players).toHaveLength(0);
      expect(result.teams).toHaveLength(0);
    });
  });

  describe('parse() — position mapping', () => {
    it('maps rows 1–5 to PG, SG, SF, PF, C', () => {
      const rows = Array.from({ length: 5 }, () => makeRow({ team: 'Team A' }));
      const { players } = new BoxScoreParser(rows, 'test.jpg').parse();
      expect(players[0]?.position).toBe('PG');
      expect(players[1]?.position).toBe('SG');
      expect(players[2]?.position).toBe('SF');
      expect(players[3]?.position).toBe('PF');
      expect(players[4]?.position).toBe('C');
    });

    it('maps rows 6–10 to PG, SG, SF, PF, C (second team)', () => {
      const rows = [
        ...Array.from({ length: 5 }, () => makeRow({ team: 'Team A' })),
        ...Array.from({ length: 5 }, () => makeRow({ team: 'Team B' })),
      ];
      const { players } = new BoxScoreParser(rows, 'test.jpg').parse();
      expect(players[5]?.position).toBe('PG');
      expect(players[6]?.position).toBe('SG');
      expect(players[9]?.position).toBe('C');
    });
  });

  describe('parse() — gameIdFromFile extraction', () => {
    it('extracts numeric ID from IMG_NNNN.jpg filename', () => {
      const { players } = new BoxScoreParser([makeRow()], 'IMG_1754.jpg').parse();
      expect(players[0]?.gameIdFromFile).toBe('1754');
    });

    it('returns "0000" for filenames without any digits', () => {
      const { players } = new BoxScoreParser([makeRow()], 'screenshot.jpg').parse();
      expect(players[0]?.gameIdFromFile).toBe('0000');
    });

    it('extracts leading digits from NNNN-boxscore.jpg pattern', () => {
      const { players } = new BoxScoreParser([makeRow()], '2024-boxscore.jpg').parse();
      expect(players[0]?.gameIdFromFile).toBe('2024');
    });
  });

  describe('parse() — playerId assignment', () => {
    it('uses row.id as playerId when the row provides one', () => {
      const row = makeRow({ id: 'custom-id-xyz' });
      const { players } = new BoxScoreParser([row], 'IMG_1754.jpg').parse();
      expect(players[0]?.playerId).toBe('custom-id-xyz');
    });

    it('generates "gameId-index" playerId when row.id is absent', () => {
      const { players } = new BoxScoreParser([makeRow()], 'IMG_1754.jpg').parse();
      expect(players[0]?.playerId).toBe('1754-1');
    });
  });

  describe('parse() — shooting percentages', () => {
    it('computes fgPercentage as (made / attempted) * 100', () => {
      const row = makeRow({ fgMade: 6, fgAttempted: 10 });
      const { players } = new BoxScoreParser([row], 'test.jpg').parse();
      expect(players[0]?.fgPercentage).toBeCloseTo(60, 5);
    });

    it('returns 0 for fgPercentage when fgAttempted is 0', () => {
      const row = makeRow({ fgMade: 0, fgAttempted: 0 });
      const { players } = new BoxScoreParser([row], 'test.jpg').parse();
      expect(players[0]?.fgPercentage).toBe(0);
    });

    it('computes threePercentage correctly', () => {
      const row = makeRow({ threeMade: 2, threeAttempted: 5 });
      const { players } = new BoxScoreParser([row], 'test.jpg').parse();
      expect(players[0]?.threePercentage).toBeCloseTo(40, 5);
    });

    it('returns 0 for threePercentage when threeAttempted is 0', () => {
      const row = makeRow({ threeMade: 0, threeAttempted: 0 });
      const { players } = new BoxScoreParser([row], 'test.jpg').parse();
      expect(players[0]?.threePercentage).toBe(0);
    });

    it('computes ftPercentage correctly', () => {
      const row = makeRow({ ftMade: 3, ftAttempted: 4 });
      const { players } = new BoxScoreParser([row], 'test.jpg').parse();
      expect(players[0]?.ftPercentage).toBeCloseTo(75, 5);
    });

    it('returns 0 for ftPercentage when ftAttempted is 0', () => {
      const row = makeRow({ ftMade: 0, ftAttempted: 0 });
      const { players } = new BoxScoreParser([row], 'test.jpg').parse();
      expect(players[0]?.ftPercentage).toBe(0);
    });
  });

  describe('parse() — team stat totals', () => {
    it('sums player counting stats correctly per team', () => {
      const rows = [
        makeRow({ team: 'Team A', points: 20, rebounds: 5, assists: 3, steals: 2, blocks: 1, turnovers: 1, fouls: 3 }),
        makeRow({ team: 'Team A', points: 15, rebounds: 7, assists: 4, steals: 0, blocks: 2, turnovers: 2, fouls: 2 }),
        makeRow({ team: 'Team B', points: 10, rebounds: 3, assists: 1, steals: 1, blocks: 0, turnovers: 3, fouls: 4 }),
      ];
      const { teams } = new BoxScoreParser(rows, 'test.jpg').parse();
      const home = teams.find(t => t.isHome);
      const away = teams.find(t => !t.isHome);

      expect(home?.points).toBe(35);
      expect(home?.rebounds).toBe(12);
      expect(home?.assists).toBe(7);
      expect(home?.steals).toBe(2);
      expect(home?.blocks).toBe(3);
      expect(away?.points).toBe(10);
      expect(away?.turnovers).toBe(3);
    });

    it('sums shooting volume stats per team', () => {
      const rows = [
        makeRow({ team: 'Team A', fgMade: 5, fgAttempted: 10, threeMade: 2, threeAttempted: 5, ftMade: 3, ftAttempted: 4 }),
        makeRow({ team: 'Team A', fgMade: 3, fgAttempted: 8, threeMade: 1, threeAttempted: 3, ftMade: 1, ftAttempted: 2 }),
      ];
      const { teams } = new BoxScoreParser(rows, 'test.jpg').parse();
      const home = teams.find(t => t.isHome);

      expect(home?.fgMade).toBe(8);
      expect(home?.fgAttempted).toBe(18);
      expect(home?.threeMade).toBe(3);
      expect(home?.threeAttempted).toBe(8);
      expect(home?.ftMade).toBe(4);
      expect(home?.ftAttempted).toBe(6);
    });

    it('marks home team with isHome: true and away team with isHome: false', () => {
      const rows = [
        makeRow({ team: 'Team A' }),
        makeRow({ team: 'Team B' }),
      ];
      const { teams } = new BoxScoreParser(rows, 'test.jpg').parse();
      const home = teams.find(t => t.name === 'Team A');
      const away = teams.find(t => t.name === 'Team B');
      expect(home?.isHome).toBe(true);
      expect(away?.isHome).toBe(false);
    });
  });

  describe('parse() — quarter totals', () => {
    const quarters: TeamQuarterTotals = { Q1: 25, Q2: 30, Q3: 28, Q4: 22 };

    it('attaches teamAQuarters and teamBQuarters when provided', () => {
      const result = new BoxScoreParser([makeRow()], 'test.jpg', quarters, quarters).parse();
      expect(result.teamAQuarters).toEqual(quarters);
      expect(result.teamBQuarters).toEqual(quarters);
    });

    it('omits teamAQuarters and teamBQuarters when not provided', () => {
      const result = new BoxScoreParser([makeRow()], 'test.jpg').parse();
      expect(result.teamAQuarters).toBeUndefined();
      expect(result.teamBQuarters).toBeUndefined();
    });
  });
});
