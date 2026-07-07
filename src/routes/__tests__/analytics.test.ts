jest.mock('@/services/supabase', () => ({
  __esModule: true,
  default: {
    getGamesByUserId: jest.fn(),
    getDistinctPlayerCount: jest.fn(),
    getPlayerStats: jest.fn(),
  },
  pgClient: {},
}));

jest.mock('@/services/lineupEfficiency', () => ({
  getLineupEfficiency: jest.fn(),
}));

jest.mock('@/middleware/auth', () => ({
  authenticateToken: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', email: 'user@example.com', role: 'USER' };
    next();
  }),
}));

import request from 'supertest';
import express from 'express';
import supabaseService from '@/services/supabase';
import { getLineupEfficiency } from '@/services/lineupEfficiency';
import { authenticateToken } from '@/middleware/auth';
import analyticsRouter from '@/routes/analytics';

const mockedSupabase = jest.mocked(supabaseService);
const mockedLineups = jest.mocked(getLineupEfficiency);
const mockedAuth = jest.mocked(authenticateToken);

const app = express();
app.use(express.json());
app.use('/', analyticsRouter);

const mockGame = {
  id: 'game-1',
  homeTeam: 'Team A',
  awayTeam: 'Team B',
  homeScore: 100,
  awayScore: 90,
  createdAt: new Date('2026-01-01'),
  teams: [{ name: 'Team A' }, { name: 'Team B' }],
  players: [
    {
      name: 'Akif',
      team: 'Team A',
      points: 20,
      rebounds: 5,
      assists: 3,
      steals: 1,
      blocks: 0,
      turnovers: 2,
      fouls: 3,
      fgMade: 8,
      fgAttempted: 15,
      threeMade: 2,
      threeAttempted: 5,
      ftMade: 2,
      ftAttempted: 2,
      gameId: 'game-1',
    },
  ],
};

const mockPlayerStats = [
  {
    id: 'ps1',
    playerName: 'Akif',
    team: 'Team A',
    gamesPlayed: 1,
    avgPoints: 20,
    avgRebounds: 5,
    avgAssists: 3,
    avgSteals: 1,
    avgBlocks: 0,
    avgTurnovers: 2,
    avgFouls: 3,
    avgFgPercentage: 53.3,
    avgThreePercentage: 40,
    avgFtPercentage: 100,
    avgPlusMinus: 0,
    totalPoints: 20,
    totalRebounds: 5,
    totalAssists: 3,
    totalSteals: 1,
    totalBlocks: 0,
    totalTurnovers: 2,
    totalFouls: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: 'user-1',
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockedAuth.mockImplementation(async (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', email: 'user@example.com', role: 'USER' };
    next();
  });
  mockedSupabase.getGamesByUserId.mockResolvedValue([mockGame as any]);
  mockedSupabase.getPlayerStats.mockResolvedValue(mockPlayerStats as any);
  mockedSupabase.getDistinctPlayerCount.mockResolvedValue(1);
  mockedLineups.mockResolvedValue([]);
});

describe('GET /players', () => {
  it('returns 200 with players and aggregated stats', async () => {
    const res = await request(app).get('/players');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.stats).toHaveLength(1);
  });

  it('returns 401 when req.user is not set', async () => {
    mockedAuth.mockImplementationOnce(async (_req: any, _res: any, next: any) => next());

    const res = await request(app).get('/players');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 500 when fetching games throws', async () => {
    mockedSupabase.getGamesByUserId.mockRejectedValue(new Error('DB down'));

    const res = await request(app).get('/players');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /teams', () => {
  it('returns 200 with team stats computed from games', async () => {
    const res = await request(app).get('/teams');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const teamA = res.body.data.stats.find((t: any) => t.name === 'Team A');
    expect(teamA.wins).toBe(1);
    expect(teamA.avgPoints).toBe(100);
  });

  it('returns 500 when fetching games throws', async () => {
    mockedSupabase.getGamesByUserId.mockRejectedValue(new Error('DB down'));

    const res = await request(app).get('/teams');

    expect(res.status).toBe(500);
  });
});

describe('GET /dashboard', () => {
  it('returns 200 with a full analytics summary', async () => {
    const res = await request(app).get('/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.data.totalGames).toBe(1);
    expect(res.body.data.totalPlayers).toBe(1);
    expect(res.body.data.topPerformers.points).toHaveLength(1);
  });

  it('returns 500 when an aggregate call throws', async () => {
    mockedSupabase.getDistinctPlayerCount.mockRejectedValue(new Error('DB down'));

    const res = await request(app).get('/dashboard');

    expect(res.status).toBe(500);
  });
});

describe('GET /lineups', () => {
  it('returns 200 with lineup efficiency data', async () => {
    mockedLineups.mockResolvedValue([
      { players: ['Akif'], team: 'Team A', games: 3, wins: 2, losses: 1, avgPointDifferential: 5 },
    ]);

    const res = await request(app).get('/lineups');

    expect(res.status).toBe(200);
    expect(res.body.data.lineups).toHaveLength(1);
  });

  it('returns 401 when req.user is not set', async () => {
    mockedAuth.mockImplementationOnce(async (_req: any, _res: any, next: any) => next());

    const res = await request(app).get('/lineups');

    expect(res.status).toBe(401);
  });

  it('returns 500 when getLineupEfficiency throws', async () => {
    mockedLineups.mockRejectedValue(new Error('DB down'));

    const res = await request(app).get('/lineups');

    expect(res.status).toBe(500);
  });
});
