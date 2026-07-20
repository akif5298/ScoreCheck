/**
 * Scoping tests for the game-edit route in screenshots.ts: PUT /games/:gameId must be
 * scoped to the caller's SQUAD — a game in another squad behaves exactly like a missing
 * one (404, never 403, so membership is not disclosed).
 *
 * POST /games/:gameId/start-edit no longer exists. It subtracted a game from
 * player_totals with no way to restore them if the edit was abandoned, and
 * double-subtracted when it completed; updateGame now rebuilds aggregates instead.
 */

import request from 'supertest';
import express from 'express';

jest.mock('@/services/supabase', () => ({
  __esModule: true,
  default: {
    updateGame: jest.fn(),
  },
}));

jest.mock('@/services/mappingService', () => ({
  __esModule: true,
  getMappingsForSquad: jest.fn().mockResolvedValue(new Map()),
  getAllowedNamesForSquad: jest.fn().mockResolvedValue(new Set(['Akif'])),
  getAllowedNamesArray: jest.fn().mockResolvedValue(['Akif']),
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
  it('no longer exists', async () => {
    // Guards against the endpoint being reintroduced: it corrupted player_totals.
    const res = await request(app).post('/games/game-1/start-edit');

    expect(res.status).toBe(404);
  });
});

describe('PUT /games/:gameId', () => {
  it("scopes the update to the caller's squad, not their user id", async () => {
    mocked.updateGame.mockResolvedValue({ id: 'game-1' } as never);

    const res = await request(app).put('/games/game-1').send(validUpdateBody);

    expect(res.status).toBe(200);
    // Squad id, and no allowedNames argument — updateGame derives tracked names itself
    // via recomputeSquadAggregates.
    expect(mocked.updateGame).toHaveBeenCalledWith(
      'game-1',
      'test-squad-1',
      expect.objectContaining({ homeTeam: 'Team A' }),
    );
  });

  it('returns 404 when the game belongs to another squad', async () => {
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
