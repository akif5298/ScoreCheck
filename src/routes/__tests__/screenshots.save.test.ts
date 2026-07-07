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
    saveGameWithStats: jest.fn(),
    getGamesByUserId: jest.fn(),
    getPlayerTotalsByPlayerName: jest.fn(),
    updatePlayerTotals: jest.fn(),
    createPlayerTotals: jest.fn(),
    updatePlayerStatsFromTotals: jest.fn(),
  },
}));

jest.mock('@/services/enhancedOCRService', () => ({
  EnhancedOCRService: jest.fn().mockImplementation(() => ({
    extractStructuredDataFromImage: jest.fn(),
    clearCache: jest.fn(),
  })),
}));

jest.mock('@/services/imageProcessor', () => ({
  __esModule: true,
  default: { processImage: jest.fn() },
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

/** A minimal valid player entry (no name in ALLOWED_PLAYER_NAMES to keep tests simple). */
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
  mocked.saveGameWithStats.mockResolvedValue({ game: mockGame, players: [mockPlayer] });
  mocked.getGamesByUserId.mockResolvedValue([]);
  mocked.getPlayerTotalsByPlayerName.mockResolvedValue(null);
  mocked.createPlayerTotals.mockResolvedValue({});
  (mocked.updatePlayerStatsFromTotals as jest.Mock).mockResolvedValue(undefined);
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
      mocked.getGamesByUserId.mockResolvedValue([]);

      const res = await request(app).post('/save').send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/already exists/i);
      expect(mocked.saveGameWithStats).not.toHaveBeenCalled();
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

    it('does not call updatePlayerStatsFromTotals when the transaction fails', async () => {
      mocked.saveGameWithStats.mockRejectedValue(new Error('Transaction rolled back'));

      await request(app).post('/save').send(validBody);

      expect(mocked.updatePlayerStatsFromTotals).not.toHaveBeenCalled();
    });
  });

  describe('updatePlayerStats error isolation', () => {
    it('returns 200 even when getPlayerTotalsByPlayerName throws for a tracked player', async () => {
      // 'Akif' is in ALLOWED_PLAYER_NAMES, which triggers the updatePlayerTotals path.
      // The inner catch in updatePlayerTotals must absorb this error.
      mocked.getPlayerTotalsByPlayerName.mockRejectedValue(new Error('Totals DB error'));

      const bodyWithTrackedPlayer = {
        ...validBody,
        playersData: [{ ...validPlayer, name: 'Akif' }],
      };

      const res = await request(app).post('/save').send(bodyWithTrackedPlayer);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
