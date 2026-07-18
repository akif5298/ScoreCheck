/**
 * Ownership tests for the game-edit routes in screenshots.ts:
 * POST /games/:gameId/start-edit and PUT /games/:gameId must be scoped to the
 * authenticated user — a foreign gameId behaves exactly like a missing one.
 */

import request from 'supertest';
import express from 'express';

jest.mock('@/services/supabase', () => ({
  __esModule: true,
  default: {
    startGameEdit: jest.fn(),
    updateGame: jest.fn(),
  },
}));

jest.mock('@/services/mappingService', () => ({
  __esModule: true,
  getMappingsForUser: jest.fn().mockResolvedValue(new Map()),
  getAllowedNamesForUser: jest.fn().mockResolvedValue(new Set(['Akif'])),
  getAllowedNamesArray: jest.fn().mockResolvedValue(['Akif']),
}));

jest.mock('@/middleware/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { userId: 'test-user-123', email: 'test@example.com', role: 'USER' };
    next();
  },
}));

import supabaseService from '@/services/supabase';
import screenshotsRouter from '@/routes/screenshots';

const mocked = jest.mocked(supabaseService);

const app = express();
app.use(express.json());
app.use('/', screenshotsRouter);

const validUpdateBody = {
  homeTeam: 'Team A',
  awayTeam: 'Team B',
  homeScore: 100,
  awayScore: 90,
  date: '2026-07-18',
  players: [],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /games/:gameId/start-edit', () => {
  it('passes the authenticated userId and allowed names to the service', async () => {
    mocked.startGameEdit.mockResolvedValue({ success: true, message: 'ok' } as never);

    const res = await request(app).post('/games/game-1/start-edit');

    expect(res.status).toBe(200);
    expect(mocked.startGameEdit).toHaveBeenCalledWith('game-1', 'test-user-123', ['Akif']);
  });

  it("returns 404 when the game does not belong to the user", async () => {
    mocked.startGameEdit.mockResolvedValue(null as never);

    const res = await request(app).post('/games/foreign-game/start-edit');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('PUT /games/:gameId', () => {
  it('passes the authenticated userId and allowed names to the service', async () => {
    mocked.updateGame.mockResolvedValue({ id: 'game-1' } as never);

    const res = await request(app).put('/games/game-1').send(validUpdateBody);

    expect(res.status).toBe(200);
    expect(mocked.updateGame).toHaveBeenCalledWith(
      'game-1',
      'test-user-123',
      ['Akif'],
      expect.objectContaining({ homeTeam: 'Team A' }),
    );
  });

  it('returns 404 when the game does not belong to the user', async () => {
    mocked.updateGame.mockResolvedValue(null as never);

    const res = await request(app).put('/games/foreign-game').send(validUpdateBody);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).put('/games/game-1').send({ homeTeam: 'Team A' });

    expect(res.status).toBe(400);
    expect(mocked.updateGame).not.toHaveBeenCalled();
  });
});
