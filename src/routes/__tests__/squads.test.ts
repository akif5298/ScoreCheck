/**
 * Wiring tests for /api/squads: status codes, parameter plumbing, and error translation.
 *
 * squadService is mocked here, so the authorization RULES themselves are not under test —
 * those live in scripts/squad-integration-check.ts, which exercises the real SQL against a
 * real Postgres. What this file pins is that each route calls the right service function
 * with the caller's own id (never a client-supplied one) and maps SquadError to its status.
 */

jest.mock('@/services/squadService', () => {
  class SquadError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
      this.name = 'SquadError';
    }
  }
  return {
    __esModule: true,
    SquadError,
    createSquad: jest.fn(),
    listSquadsForUser: jest.fn(),
    setActiveSquad: jest.fn(),
    listMembers: jest.fn(),
    createInvite: jest.fn(),
    revokeInvite: jest.fn(),
    listInvites: jest.fn(),
    getInvitePreview: jest.fn(),
    acceptInvite: jest.fn(),
    listRoster: jest.fn(),
    claimRosterEntry: jest.fn(),
  };
});

jest.mock('@/services/gameMoveService', () => ({
  __esModule: true,
  moveGamesToSquad: jest.fn(),
}));

jest.mock('@/middleware/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-me', email: 'me@example.com', role: 'USER' };
    next();
  },
}));

import request from 'supertest';
import express from 'express';
import squadsRouter from '@/routes/squads';

const svc = jest.requireMock('@/services/squadService');
const { SquadError } = svc;
const move = jest.requireMock('@/services/gameMoveService').moveGamesToSquad as jest.Mock;

const app = express();
app.use(express.json());
app.use('/', squadsRouter);

beforeEach(() => jest.clearAllMocks());

describe('GET / (list squads)', () => {
  it('lists squads for the authenticated caller', async () => {
    svc.listSquadsForUser.mockResolvedValue([{ id: 's1', name: 'Personal', isPersonal: true }]);

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(svc.listSquadsForUser).toHaveBeenCalledWith('user-me');
  });
});

describe('POST / (create squad)', () => {
  it('creates a squad and returns 201', async () => {
    svc.createSquad.mockResolvedValue({ id: 's2', name: 'Tuesday Run', isPersonal: false });

    const res = await request(app).post('/').send({ name: 'Tuesday Run' });

    expect(res.status).toBe(201);
    expect(svc.createSquad).toHaveBeenCalledWith('user-me', 'Tuesday Run');
  });

  it('trims the name before storing it', async () => {
    svc.createSquad.mockResolvedValue({ id: 's2' });

    await request(app).post('/').send({ name: '  Tuesday Run  ' });

    expect(svc.createSquad).toHaveBeenCalledWith('user-me', 'Tuesday Run');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace only', '   '],
    ['not a string', 42],
  ])('returns 400 for a %s name', async (_label, name) => {
    const res = await request(app).post('/').send({ name });

    expect(res.status).toBe(400);
    expect(svc.createSquad).not.toHaveBeenCalled();
  });

  it('returns 400 for a name over 60 characters', async () => {
    const res = await request(app).post('/').send({ name: 'x'.repeat(61) });

    expect(res.status).toBe(400);
    expect(svc.createSquad).not.toHaveBeenCalled();
  });
});

describe('POST /:squadId/activate', () => {
  it('switches the active squad', async () => {
    svc.setActiveSquad.mockResolvedValue(undefined);

    const res = await request(app).post('/s2/activate');

    expect(res.status).toBe(200);
    expect(svc.setActiveSquad).toHaveBeenCalledWith('user-me', 's2');
  });

  it('surfaces the service 404 for a squad the caller is not in', async () => {
    svc.setActiveSquad.mockRejectedValue(new SquadError(404, 'Squad not found'));

    const res = await request(app).post('/not-mine/activate');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Squad not found');
  });
});

describe('invites', () => {
  it('creates an invite with the caller as creator', async () => {
    svc.createInvite.mockResolvedValue({ id: 'i1', token: 'tok' });

    const res = await request(app).post('/s2/invites').send({ expiresInDays: 3, maxUses: 5 });

    expect(res.status).toBe(201);
    expect(svc.createInvite).toHaveBeenCalledWith('user-me', 's2', {
      expiresInDays: 3,
      maxUses: 5,
    });
  });

  it('translates the owner-only refusal to 403', async () => {
    svc.createInvite.mockRejectedValue(new SquadError(403, 'Only the squad owner can do that'));

    const res = await request(app).post('/s2/invites').send({});

    expect(res.status).toBe(403);
  });

  it('lists invites', async () => {
    svc.listInvites.mockResolvedValue([]);

    const res = await request(app).get('/s2/invites');

    expect(res.status).toBe(200);
    expect(svc.listInvites).toHaveBeenCalledWith('user-me', 's2');
  });

  it('revokes an invite', async () => {
    svc.revokeInvite.mockResolvedValue(undefined);

    const res = await request(app).delete('/s2/invites/i1');

    expect(res.status).toBe(200);
    expect(svc.revokeInvite).toHaveBeenCalledWith('user-me', 's2', 'i1');
  });
});

describe('GET /invites/:token (public preview)', () => {
  it('returns the squad preview for a usable token', async () => {
    svc.getInvitePreview.mockResolvedValue({
      squadId: 's2',
      squadName: 'Tuesday Run',
      invitedByName: 'Akif',
      memberCount: 3,
      gameCount: 12,
    });

    const res = await request(app).get('/invites/sometoken');

    expect(res.status).toBe(200);
    expect(res.body.data.squadName).toBe('Tuesday Run');
  });

  it('returns 404 for an unusable token', async () => {
    // Unknown, revoked, expired and exhausted all land here, so the response cannot be
    // used to tell them apart.
    svc.getInvitePreview.mockResolvedValue(null);

    const res = await request(app).get('/invites/sometoken');

    expect(res.status).toBe(404);
  });

  it('does not route a squad-scoped invite list into the public preview', async () => {
    // Guards the ordering of '/:squadId/invites' vs '/invites/:token'.
    svc.listInvites.mockResolvedValue([]);

    await request(app).get('/s2/invites');

    expect(svc.getInvitePreview).not.toHaveBeenCalled();
    expect(svc.listInvites).toHaveBeenCalled();
  });
});

describe('POST /join/:token', () => {
  it('joins and reports the squad name', async () => {
    svc.acceptInvite.mockResolvedValue({ squadId: 's2', squadName: 'Tuesday Run', joined: true });

    const res = await request(app).post('/join/tok');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Joined Tuesday Run/);
    expect(svc.acceptInvite).toHaveBeenCalledWith('user-me', 'tok');
  });

  it('reports an already-member re-join as success, not an error', async () => {
    // Re-opening the link is the realistic cause, so this is idempotent by design.
    svc.acceptInvite.mockResolvedValue({ squadId: 's2', squadName: 'Tuesday Run', joined: false });

    const res = await request(app).post('/join/tok');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/already a member/i);
  });

  it('surfaces 410 for a spent or expired invite', async () => {
    svc.acceptInvite.mockRejectedValue(new SquadError(410, 'This invite link has expired'));

    const res = await request(app).post('/join/tok');

    expect(res.status).toBe(410);
  });
});

describe('roster identity', () => {
  it('lists the roster', async () => {
    svc.listRoster.mockResolvedValue([]);

    const res = await request(app).get('/s2/roster');

    expect(res.status).toBe(200);
    expect(svc.listRoster).toHaveBeenCalledWith('user-me', 's2');
  });

  it('claims an existing entry by mappingId', async () => {
    svc.claimRosterEntry.mockResolvedValue({ id: 'm1', gamertag: 'akif2k', isYou: true });

    const res = await request(app).post('/s2/roster/claim').send({ mappingId: 'm1' });

    expect(res.status).toBe(200);
    expect(svc.claimRosterEntry).toHaveBeenCalledWith('user-me', 's2', {
      mappingId: 'm1',
      gamertag: undefined,
      displayName: undefined,
    });
  });

  it('creates a new entry from a gamertag', async () => {
    svc.claimRosterEntry.mockResolvedValue({ id: 'm2', gamertag: 'newguy', isYou: true });

    const res = await request(app)
      .post('/s2/roster/claim')
      .send({ gamertag: 'newguy', displayName: 'New Guy' });

    expect(res.status).toBe(200);
    expect(svc.claimRosterEntry).toHaveBeenCalledWith('user-me', 's2', {
      mappingId: undefined,
      gamertag: 'newguy',
      displayName: 'New Guy',
    });
  });

  it('surfaces 409 when the entry is already claimed by someone else', async () => {
    svc.claimRosterEntry.mockRejectedValue(
      new SquadError(409, 'That roster entry is already claimed by another member'),
    );

    const res = await request(app).post('/s2/roster/claim').send({ mappingId: 'm1' });

    expect(res.status).toBe(409);
  });
});

describe('POST /:squadId/games/move', () => {
  const emptyResult = {
    moved: [],
    alreadyThere: [],
    duplicates: [],
    renamed: [],
    conflicts: [],
    unmapped: [],
    lineupRewriteSkipped: [],
  };

  it('moves games into the squad named in the path', async () => {
    move.mockResolvedValue({ ...emptyResult, moved: ['g1', 'g2'] });

    const res = await request(app).post('/s2/games/move').send({ gameIds: ['g1', 'g2'] });

    expect(res.status).toBe(200);
    // The target is the path squad and the actor is the caller's own id — neither is
    // taken from the body, so a client cannot move games on someone else's behalf.
    expect(move).toHaveBeenCalledWith('user-me', 's2', ['g1', 'g2']);
  });

  it('deduplicates repeated game ids before calling the service', async () => {
    move.mockResolvedValue({ ...emptyResult, moved: ['g1'] });

    await request(app).post('/s2/games/move').send({ gameIds: ['g1', 'g1', 'g1'] });

    expect(move).toHaveBeenCalledWith('user-me', 's2', ['g1']);
  });

  it.each([
    ['missing', undefined],
    ['empty array', []],
    ['not an array', 'g1'],
    ['containing a non-string', ['g1', 42]],
    ['containing an empty string', ['g1', '  ']],
  ])('returns 400 for gameIds %s without opening a transaction', async (_label, gameIds) => {
    const res = await request(app).post('/s2/games/move').send({ gameIds });

    expect(res.status).toBe(400);
    expect(move).not.toHaveBeenCalled();
  });

  it('returns 400 for a batch over the cap', async () => {
    const gameIds = Array.from({ length: 501 }, (_, i) => `g${i}`);

    const res = await request(app).post('/s2/games/move').send({ gameIds });

    expect(res.status).toBe(400);
    expect(move).not.toHaveBeenCalled();
  });

  it('surfaces the 403 for moving another member\'s game', async () => {
    move.mockRejectedValue(
      new SquadError(403, 'You can only move games you uploaded, unless you own the squad'),
    );

    const res = await request(app).post('/s2/games/move').send({ gameIds: ['g1'] });

    expect(res.status).toBe(403);
  });

  it('surfaces 404 for a squad the caller is not in', async () => {
    move.mockRejectedValue(new SquadError(404, 'Squad not found'));

    const res = await request(app).post('/s2/games/move').send({ gameIds: ['g1'] });

    expect(res.status).toBe(404);
  });

  it('surfaces 409 when the move would merge two players', async () => {
    move.mockRejectedValue(
      new SquadError(409, 'Moving these games would merge two different players into Nil.'),
    );

    const res = await request(app).post('/s2/games/move').send({ gameIds: ['g1'] });

    expect(res.status).toBe(409);
  });

  it('reports duplicates and unmapped names in the message', async () => {
    // The user needs the real outcome, not a bare success — unmapped names accrue no
    // stats until they are put on the roster.
    move.mockResolvedValue({
      ...emptyResult,
      moved: ['g1', 'g2'],
      duplicates: [{ gameId: 'g3', existingGameId: 'g9' }],
      unmapped: ['GRIM_AR15'],
    });

    const res = await request(app).post('/s2/games/move').send({ gameIds: ['g1', 'g2', 'g3'] });

    expect(res.body.message).toMatch(/Moved 2 games/);
    expect(res.body.message).toMatch(/1 were already in the squad/);
    expect(res.body.message).toMatch(/1 name\(s\) are not on this squad's roster/);
    expect(res.body.data.duplicates).toHaveLength(1);
  });

  it('returns the full per-game breakdown, not just a count', async () => {
    move.mockResolvedValue({
      ...emptyResult,
      moved: ['g1'],
      renamed: [{ from: 'Nillan', to: 'Nil' }],
      conflicts: ['Dylan'],
      lineupRewriteSkipped: ['g7'],
    });

    const res = await request(app).post('/s2/games/move').send({ gameIds: ['g1'] });

    expect(res.body.data.renamed).toEqual([{ from: 'Nillan', to: 'Nil' }]);
    expect(res.body.data.conflicts).toEqual(['Dylan']);
    expect(res.body.data.lineupRewriteSkipped).toEqual(['g7']);
  });
});

describe('error handling', () => {
  it('does not leak an internal error message to the client', async () => {
    svc.listSquadsForUser.mockRejectedValue(new Error('connection string is postgres://secret'));

    const res = await request(app).get('/');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to list squads');
    expect(JSON.stringify(res.body)).not.toMatch(/secret/);
  });
});
