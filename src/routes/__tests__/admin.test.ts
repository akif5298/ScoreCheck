jest.mock('@/services/database', () => ({
  prisma: {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    game: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    player: {
      count: jest.fn(),
    },
  },
}));

jest.mock('@/middleware/auth', () => ({
  // Mirrors the real helper: the mocked authenticateToken above sets req.user.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireUserId: (req: any) => req.user?.userId,
  authenticateToken: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-1', email: 'admin@example.com', role: 'ADMIN' };
    next();
  }),
}));

jest.mock('@/services/supabase', () => ({
  __esModule: true,
  default: {
    deleteGameById: jest.fn(),
    deleteImage: jest.fn(),
    recomputeSquadAggregates: jest.fn(),
  },
}));

import request from 'supertest';
import express from 'express';
import { prisma } from '@/services/database';
import { authenticateToken } from '@/middleware/auth';
import supabaseService from '@/services/supabase';
import adminRouter from '@/routes/admin';

const mockedPrisma = jest.mocked(prisma, { shallow: true });
const mockedAuth = jest.mocked(authenticateToken);

const app = express();
app.use(express.json());
app.use('/', adminRouter);

beforeEach(() => {
  jest.clearAllMocks();
  mockedAuth.mockImplementation(async (req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-1', email: 'admin@example.com', role: 'ADMIN' };
    next();
  });
});

describe('admin routes — access control', () => {
  it('returns 403 for an authenticated non-admin user', async () => {
    mockedAuth.mockImplementationOnce(async (req: any, _res: any, next: any) => {
      req.user = { userId: 'user-1', email: 'user@example.com', role: 'USER' };
      next();
    });

    const res = await request(app).get('/users');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /users', () => {
  it('returns 200 with the user list', async () => {
    (mockedPrisma.user.findMany as jest.Mock).mockResolvedValue([
      { id: 'u1', email: 'u1@example.com', name: 'U1', role: 'USER', createdAt: new Date(), _count: { games: 2 } },
    ]);

    const res = await request(app).get('/users');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it('returns 500 when prisma throws', async () => {
    (mockedPrisma.user.findMany as jest.Mock).mockRejectedValue(new Error('DB down'));

    const res = await request(app).get('/users');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /games', () => {
  it('returns 200 with the game list', async () => {
    (mockedPrisma.game.findMany as jest.Mock).mockResolvedValue([{ id: 'g1' }]);

    const res = await request(app).get('/games');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('DELETE /games/:gameId', () => {
  it('returns 404 when the game does not exist', async () => {
    (supabaseService.deleteGameById as jest.Mock).mockResolvedValue({ outcome: 'not_found' });

    const res = await request(app).delete('/games/missing-game');

    expect(res.status).toBe(404);
    expect(supabaseService.deleteImage).not.toHaveBeenCalled();
    expect(supabaseService.recomputeSquadAggregates).not.toHaveBeenCalled();
  });

  it('returns 200, removes the screenshot, and rebuilds the squad aggregates', async () => {
    (supabaseService.deleteGameById as jest.Mock).mockResolvedValue({
      outcome: 'deleted',
      squadId: 'squad-1',
      screenshotUrl: 'squad-1-import-1-boxscore.jpg',
    });

    const res = await request(app).delete('/games/g1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(supabaseService.deleteGameById).toHaveBeenCalledWith('g1');
    expect(supabaseService.deleteImage).toHaveBeenCalledWith('squad-1-import-1-boxscore.jpg');
    // The point of this fix: deleting a game rebuilds its squad's totals, so admin deletes
    // no longer leave aggregates overstated.
    expect(supabaseService.recomputeSquadAggregates).toHaveBeenCalledWith('squad-1');
  });

  it('skips storage removal when the game has no screenshot but still rebuilds aggregates', async () => {
    (supabaseService.deleteGameById as jest.Mock).mockResolvedValue({
      outcome: 'deleted',
      squadId: 'squad-2',
      screenshotUrl: null,
    });

    const res = await request(app).delete('/games/g2');

    expect(res.status).toBe(200);
    expect(supabaseService.deleteImage).not.toHaveBeenCalled();
    expect(supabaseService.recomputeSquadAggregates).toHaveBeenCalledWith('squad-2');
  });
});

describe('DELETE /users/:userId', () => {
  it('returns 404 when the user does not exist', async () => {
    (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await request(app).delete('/users/missing-user');

    expect(res.status).toBe(404);
  });

  it('returns 400 when an admin tries to delete their own account', async () => {
    (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'admin-1' });

    const res = await request(app).delete('/users/admin-1');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own account/i);
    expect(mockedPrisma.user.delete).not.toHaveBeenCalled();
  });

  it('returns 200 and deletes another user', async () => {
    (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u2' });
    (mockedPrisma.user.delete as jest.Mock).mockResolvedValue({ id: 'u2' });

    const res = await request(app).delete('/users/u2');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('PATCH /users/:userId/role', () => {
  it('returns 400 for an invalid role', async () => {
    const res = await request(app).patch('/users/u2/role').send({ role: 'SUPERUSER' });

    expect(res.status).toBe(400);
    expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the target user does not exist', async () => {
    (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await request(app).patch('/users/missing/role').send({ role: 'ADMIN' });

    expect(res.status).toBe(404);
  });

  it('returns 400 when an admin tries to change their own role', async () => {
    (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'admin-1' });

    const res = await request(app).patch('/users/admin-1/role').send({ role: 'USER' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own role/i);
  });

  it('returns 200 and updates the role for another user', async () => {
    (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u2' });
    (mockedPrisma.user.update as jest.Mock).mockResolvedValue({ id: 'u2', role: 'ADMIN' });

    const res = await request(app).patch('/users/u2/role').send({ role: 'ADMIN' });

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('ADMIN');
  });
});

describe('GET /dashboard', () => {
  it('returns 200 with aggregated stats', async () => {
    (mockedPrisma.user.count as jest.Mock).mockResolvedValue(5);
    (mockedPrisma.game.count as jest.Mock).mockResolvedValue(10);
    (mockedPrisma.player.count as jest.Mock).mockResolvedValue(50);
    (mockedPrisma.game.findMany as jest.Mock).mockResolvedValue([]);
    (mockedPrisma.user.findMany as jest.Mock).mockResolvedValue([]);

    const res = await request(app).get('/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.data.totalUsers).toBe(5);
    expect(res.body.data.totalGames).toBe(10);
    expect(res.body.data.totalPlayers).toBe(50);
  });

  it('returns 500 when one of the aggregate queries throws', async () => {
    (mockedPrisma.user.count as jest.Mock).mockRejectedValue(new Error('DB down'));

    const res = await request(app).get('/dashboard');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
