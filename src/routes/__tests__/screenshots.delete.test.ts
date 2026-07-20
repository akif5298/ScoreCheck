/**
 * DELETE /games/:gameId — the member-facing delete endpoint added with the squad work.
 *
 * Until now deletion existed only as an admin route, so this is the first place a normal
 * user can remove data. The permission rule is uploader-or-owner, and the interesting part
 * is what happens *after* the commit: neither the storage cleanup nor the aggregate rebuild
 * is transactional, so neither may turn a completed delete into a reported failure.
 */

jest.mock('@/services/supabase', () => ({
  __esModule: true,
  default: {
    deleteGameForSquad: jest.fn(),
    deleteImage: jest.fn(),
    recomputeSquadAggregates: jest.fn(),
  },
}));

jest.mock('@/services/squadService', () => ({
  __esModule: true,
  getMembership: jest.fn(),
}));

jest.mock('@/services/mappingService', () => ({
  __esModule: true,
  getMappingsForSquad: jest.fn().mockResolvedValue(new Map()),
  getAllowedNamesForSquad: jest.fn().mockResolvedValue(new Set()),
  getAllowedNamesArray: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/services/enhancedOCRService', () => ({
  EnhancedOCRService: jest.fn().mockImplementation(() => ({
    extractStructuredDataFromImage: jest.fn(),
    clearCache: jest.fn(),
  })),
}));

jest.mock('@/services/junkFilter', () => ({
  classifyScreenshot: jest.fn(),
}));

jest.mock('@/middleware/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { userId: CALLER, email: 'test@example.com', role: 'USER' };
    next();
  },
}));

jest.mock('@/middleware/squad', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolveSquad: (req: any, _res: any, next: any) => {
    req.squadId = 'squad-1';
    next();
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireSquadId: (req: any) => req.squadId,
  SQUAD_HEADER: 'x-squad-id',
}));

const CALLER = 'user-caller';

import request from 'supertest';
import express from 'express';
import supabaseService from '@/services/supabase';
import { getMembership } from '@/services/squadService';
import screenshotsRouter from '@/routes/screenshots';

const app = express();
app.use(express.json());
app.use('/', screenshotsRouter);

const mocked = jest.mocked(supabaseService) as unknown as {
  deleteGameForSquad: jest.Mock;
  deleteImage: jest.Mock;
  recomputeSquadAggregates: jest.Mock;
};
const mockedMembership = getMembership as jest.Mock;

const asMember = () => mockedMembership.mockResolvedValue({ squadId: 'squad-1', userId: CALLER, role: 'MEMBER' });
const asOwner = () => mockedMembership.mockResolvedValue({ squadId: 'squad-1', userId: CALLER, role: 'OWNER' });

beforeEach(() => {
  jest.clearAllMocks();
  asMember();
  mocked.deleteGameForSquad.mockResolvedValue({ outcome: 'deleted', screenshotUrl: 'obj/path.jpg' });
  mocked.deleteImage.mockResolvedValue(undefined);
  mocked.recomputeSquadAggregates.mockResolvedValue({ players: 0 });
});

describe('DELETE /games/:gameId', () => {
  describe('permission', () => {
    it('passes isOwner=false for a plain member', async () => {
      asMember();
      await request(app).delete('/games/game-1');

      expect(mocked.deleteGameForSquad).toHaveBeenCalledWith('game-1', 'squad-1', {
        userId: CALLER,
        isOwner: false,
      });
    });

    it('passes isOwner=true for the squad owner', async () => {
      asOwner();
      await request(app).delete('/games/game-1');

      expect(mocked.deleteGameForSquad).toHaveBeenCalledWith('game-1', 'squad-1', {
        userId: CALLER,
        isOwner: true,
      });
    });

    it('returns 403 when the service refuses', async () => {
      mocked.deleteGameForSquad.mockResolvedValue({ outcome: 'forbidden' });

      const res = await request(app).delete('/games/game-1');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(mocked.deleteImage).not.toHaveBeenCalled();
      expect(mocked.recomputeSquadAggregates).not.toHaveBeenCalled();
    });

    it('returns 404 for a game outside the active squad', async () => {
      // The service reports not_found rather than forbidden for another squad's game, so
      // the response cannot be used to discover that a game exists elsewhere.
      mocked.deleteGameForSquad.mockResolvedValue({ outcome: 'not_found' });

      const res = await request(app).delete('/games/game-1');

      expect(res.status).toBe(404);
      expect(mocked.deleteImage).not.toHaveBeenCalled();
    });

    it('returns 404 when the caller has no membership row', async () => {
      mockedMembership.mockResolvedValue(null);

      const res = await request(app).delete('/games/game-1');

      expect(res.status).toBe(404);
      expect(mocked.deleteGameForSquad).not.toHaveBeenCalled();
    });
  });

  describe('after a successful delete', () => {
    it('returns 200 and cleans up storage and aggregates', async () => {
      const res = await request(app).delete('/games/game-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mocked.deleteImage).toHaveBeenCalledWith('obj/path.jpg');
      expect(mocked.recomputeSquadAggregates).toHaveBeenCalledWith('squad-1');
    });

    it('skips storage cleanup when the game had no screenshot', async () => {
      mocked.deleteGameForSquad.mockResolvedValue({ outcome: 'deleted', screenshotUrl: null });

      const res = await request(app).delete('/games/game-1');

      expect(res.status).toBe(200);
      expect(mocked.deleteImage).not.toHaveBeenCalled();
      expect(mocked.recomputeSquadAggregates).toHaveBeenCalled();
    });

    it('still returns 200 when storage cleanup fails — the row is already gone', async () => {
      // Reporting failure would be false and would invite a retry that 404s. The cost is an
      // unreferenced object in the bucket.
      mocked.deleteImage.mockRejectedValue(new Error('storage down'));

      const res = await request(app).delete('/games/game-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Must not abort the rebuild either.
      expect(mocked.recomputeSquadAggregates).toHaveBeenCalled();
    });

    it('still returns 200 when the aggregate rebuild fails', async () => {
      // Totals briefly include a deleted game; the squad's next write repairs them.
      mocked.recomputeSquadAggregates.mockRejectedValue(new Error('totals down'));

      const res = await request(app).delete('/games/game-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  it('returns 500 when the delete itself fails', async () => {
    mocked.deleteGameForSquad.mockRejectedValue(new Error('DB down'));

    const res = await request(app).delete('/games/game-1');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
