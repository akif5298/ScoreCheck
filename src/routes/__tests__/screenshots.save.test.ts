/**
 * Integration tests for POST /save route in screenshots.ts.
 *
 * supabaseService is fully mocked so no database connection is needed.
 * authenticateToken is replaced by a stub that injects a test user.
 */

import request from 'supertest';
import express from 'express';

// ── Mocks (must be declared before any import that loads the mocked modules) ──

jest.mock('@/services/supabase', () => ({
  __esModule: true,
  default: {
    getGameByScreenshotUrl: jest.fn(),
    getGameById: jest.fn(),
    saveGameWithStats: jest.fn(),
    getGamesBySquadId: jest.fn(),
    // Single aggregate path; the per-player incremental helpers are gone.
    recomputeSquadAggregates: jest.fn(),
  },
}));

jest.mock('@/services/mappingService', () => ({
  __esModule: true,
  getMappingsForSquad: jest.fn().mockResolvedValue(new Map()),
  getAllowedNamesForSquad: jest.fn().mockResolvedValue(new Set(['Akif'])),
  getAllowedNamesArray: jest.fn().mockResolvedValue(['Akif']),
}));

jest.mock('@/services/enhancedOCRService', () => ({
  EnhancedOCRService: jest.fn().mockImplementation(() => ({
    extractStructuredDataFromImage: jest.fn(),
    clearCache: jest.fn(),
  })),
}));

jest.mock('@/services/junkFilter', () => ({
  classifyScreenshot: jest.fn().mockResolvedValue({
    isValidBoxScore: true,
    confidence: 'high',
    reason: 'model_yes',
    latencyMs: 50,
  }),
}));

jest.mock('@/middleware/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { userId: 'test-user-123', email: 'test@example.com', role: 'USER' };
    next();
  },
}));

jest.mock('@/middleware/squad', () => ({
  // Stands in for the DB-backed scope resolution; routes just need req.squadId set.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolveSquad: (req: any, _res: any, next: any) => {
    req.squadId = 'test-squad-1';
    next();
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireSquadId: (req: any) => req.squadId,
  SQUAD_HEADER: 'x-squad-id',
}));

// ── Imports (resolved after mocks are hoisted) ───────────────────────────────

import supabaseService from '@/services/supabase';
import screenshotsRouter from '@/routes/screenshots';

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockGame = {
  id: 'game-123',
  date: new Date('2026-06-23'),
  homeTeam: 'Team A',
  awayTeam: 'Team B',
  homeScore: 95,
  awayScore: 87,
  screenshotUrl: 'https://example.com/screenshot.jpg',
  processed: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  userId: 'test-user-123',
};

const mockPlayer = {
  id: 'player-1',
  name: 'Player 1',
  team: 'Team A',
  points: 20,
};

/** A minimal valid player entry (name not in the mocked allowed set to keep tests simple). */
const validPlayer = {
  name: 'NoRecord Player',
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
};

const validBody = {
  gameData: {
    homeTeam: 'Team A',
    awayTeam: 'Team B',
    homeScore: 95,
    awayScore: 87,
  },
  playersData: [validPlayer],
  imageUrl: 'https://example.com/screenshot.jpg',
};

// ── Test app ──────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use('/', screenshotsRouter);

// ── Setup / teardown ──────────────────────────────────────────────────────────

const mocked = jest.mocked(supabaseService);

beforeEach(() => {
  jest.clearAllMocks();
  mocked.getGameByScreenshotUrl.mockResolvedValue(null);
  mocked.getGameById.mockResolvedValue({ ...mockGame, players: [mockPlayer] });
  mocked.saveGameWithStats.mockResolvedValue({ game: mockGame, players: [mockPlayer] });
  mocked.getGamesBySquadId.mockResolvedValue([]);
  (mocked.recomputeSquadAggregates as jest.Mock).mockResolvedValue({ players: 1 });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /save', () => {
  describe('happy path', () => {
    it('returns 200 with success:true and game data', async () => {
      const res = await request(app)
        .post('/save')
        .send(validBody)
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.game.id).toBe('game-123');
    });

    it('returns the saved players — not the user\'s game list — in data.players', async () => {
      // Regression: data.players was previously populated from getGamesBySquadId, so a field
      // typed Player[] carried Game objects.
      const res = await request(app).post('/save').send(validBody);

      expect(res.body.data.players).toEqual([expect.objectContaining({ id: 'player-1' })]);
      expect(mocked.getGamesBySquadId).not.toHaveBeenCalled();
    });

    it('calls saveGameWithStats exactly once', async () => {
      await request(app).post('/save').send(validBody);

      expect(mocked.saveGameWithStats).toHaveBeenCalledTimes(1);
    });

    it('passes pre-computed player and team data into the transaction', async () => {
      await request(app).post('/save').send(validBody);

      const [gameArg, playersArg, homeTeamArg, awayTeamArg] =
        mocked.saveGameWithStats.mock.calls[0] as [any, any[], any, any];

      expect(gameArg.homeTeam).toBe('Team A');
      expect(gameArg.awayTeam).toBe('Team B');
      expect(playersArg).toHaveLength(1);
      expect(homeTeamArg.isHome).toBe(true);
      expect(awayTeamArg.isHome).toBe(false);
    });
  });

  describe('duplicate detection', () => {
    it('returns 200 with "already exists" message for a duplicate imageUrl', async () => {
      const existingGame = { ...mockGame, id: 'existing-game' };
      mocked.getGameByScreenshotUrl.mockResolvedValue(existingGame);
      mocked.getGameById.mockResolvedValue({ ...existingGame, players: [mockPlayer] });
      mocked.getGamesBySquadId.mockResolvedValue([]);

      const res = await request(app).post('/save').send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/already exists/i);
      expect(mocked.saveGameWithStats).not.toHaveBeenCalled();
      // Same regression as the happy path: this must be the game's players.
      expect(res.body.data.players).toEqual([expect.objectContaining({ id: 'player-1' })]);
    });

    it('strips nulls when the existing game has no player rows', async () => {
      // json_agg over a LEFT JOIN yields [null], not [], for a game with no players.
      const existingGame = { ...mockGame, id: 'existing-game' };
      mocked.getGameByScreenshotUrl.mockResolvedValue(existingGame);
      mocked.getGameById.mockResolvedValue({ ...existingGame, players: [null] });

      const res = await request(app).post('/save').send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.data.players).toEqual([]);
    });
  });

  describe('validation', () => {
    it('returns 400 when gameData is missing', async () => {
      const res = await request(app)
        .post('/save')
        .send({ playersData: [validPlayer], imageUrl: 'https://example.com/img.jpg' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when playersData is missing', async () => {
      const res = await request(app)
        .post('/save')
        .send({ gameData: validBody.gameData, imageUrl: 'https://example.com/img.jpg' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when imageUrl is missing', async () => {
      const res = await request(app)
        .post('/save')
        .send({ gameData: validBody.gameData, playersData: [validPlayer] });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('transaction errors', () => {
    it('returns 500 when saveGameWithStats throws (simulates mid-transaction failure)', async () => {
      mocked.saveGameWithStats.mockRejectedValue(new Error('DB write failed'));

      const res = await request(app).post('/save').send(validBody);

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });

    it('does not rebuild aggregates when the transaction fails', async () => {
      mocked.saveGameWithStats.mockRejectedValue(new Error('Transaction rolled back'));

      await request(app).post('/save').send(validBody);

      expect(mocked.recomputeSquadAggregates).not.toHaveBeenCalled();
    });
  });

  describe('aggregate rebuild', () => {
    it('rebuilds aggregates for the caller squad after a successful save', async () => {
      await request(app).post('/save').send(validBody);

      expect(mocked.recomputeSquadAggregates).toHaveBeenCalledWith('test-squad-1');
    });

    it('still returns 200 when the rebuild fails, because the game is already committed', async () => {
      // The save transaction has already committed by this point, so reporting a failure
      // would misdescribe what happened. The rebuild is idempotent and derived from
      // `players`, so the next write in this squad repairs it.
      (mocked.recomputeSquadAggregates as jest.Mock).mockRejectedValue(
        new Error('Totals DB error'),
      );

      const res = await request(app).post('/save').send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
