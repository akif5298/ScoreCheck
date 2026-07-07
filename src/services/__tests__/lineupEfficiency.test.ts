import { getLineupEfficiency } from '@/services/lineupEfficiency';

const mockDb = { query: jest.fn() };

describe('getLineupEfficiency', () => {
  beforeEach(() => {
    mockDb.query.mockReset();
  });

  it('returns an empty array when no lineups meet the min-games threshold', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });
    const result = await getLineupEfficiency('user-1', mockDb as any);
    expect(result).toEqual([]);
  });

  it('maps a DB row to a LineupEfficiency object', async () => {
    const row = {
      players: ['Abdul', 'Akif', 'Anis', 'Ikroop', 'Nillan'],
      team: 'Team A',
      games: 5,
      wins: 3,
      losses: 2,
      avgPointDifferential: 6.2,
    };
    mockDb.query.mockResolvedValue({ rows: [row] });
    const [result] = await getLineupEfficiency('user-1', mockDb as any);
    expect(result).toEqual(row);
  });

  it('preserves the DB sort order (highest avgPointDifferential first)', async () => {
    mockDb.query.mockResolvedValue({
      rows: [
        { players: ['Akif'], team: 'Team A', games: 3, wins: 2, losses: 1, avgPointDifferential: 8.5 },
        { players: ['Anis'], team: 'Team B', games: 2, wins: 0, losses: 2, avgPointDifferential: -5.0 },
      ],
    });
    const result = await getLineupEfficiency('user-1', mockDb as any);
    expect(result).toHaveLength(2);
    expect(result[0]?.avgPointDifferential).toBeGreaterThan(result[1]?.avgPointDifferential ?? Infinity);
  });

  it('passes userId and default minGames=2 to the DB', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });
    await getLineupEfficiency('user-42', mockDb as any);
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('lineup_per_game'),
      ['user-42', 2],
    );
  });

  it('passes a custom minGames override to the DB', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });
    await getLineupEfficiency('user-1', mockDb as any, 5);
    expect(mockDb.query).toHaveBeenCalledWith(expect.any(String), ['user-1', 5]);
  });

  it('coerces avgPointDifferential to a number (pg may return numeric as string)', async () => {
    mockDb.query.mockResolvedValue({
      rows: [{ players: ['Akif'], team: 'Team A', games: 2, wins: 1, losses: 1, avgPointDifferential: '3.50' }],
    });
    const [result] = await getLineupEfficiency('user-1', mockDb as any);
    expect(typeof result?.avgPointDifferential).toBe('number');
    expect(result?.avgPointDifferential).toBeCloseTo(3.5);
  });
});
