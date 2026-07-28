/**
 * Integration tests for the squad scope middleware.
 *
 * These run the real middleware over a real database rather than mocking squadService,
 * because the property worth proving is not "resolveSquad calls resolveSquadId" — it is
 * that an attacker-supplied X-Squad-Id header cannot reach another squad's data. That
 * guarantee spans the middleware, resolveSquadId and the squad_members table, so a test
 * that stubs any of them would verify the stub.
 *
 * The middleware is mounted on a throwaway Express app instead of the real server: the
 * real routers each carry their own auth and handlers, which would make a scope failure
 * indistinguishable from a route failure.
 */
import express, { Request, Response } from 'express';
import request from 'supertest';
import { pgPool } from '@/services/supabase';
import { resolveSquad, requireSquadId, SQUAD_HEADER } from '@/middleware/squad';
import type { JwtPayload } from '@/types';
import { makeUser, makeSquad } from './factories';

/**
 * Builds an app whose single route echoes the resolved scope.
 *
 * `authAs` stands in for authenticateToken. Passing null leaves req.user unset, which is
 * how a route mounted without the auth middleware would behave — the case the 401 branch
 * exists for.
 */
function appWithUser(userId: string | null) {
  const app = express();
  app.use((req, _res, next) => {
    if (userId) {
      const claims: JwtPayload = { userId, email: 'x@test.local', role: 'USER' };
      req.user = claims;
    }
    next();
  });
  app.get('/scope', resolveSquad, (req: Request, res: Response) => {
    res.json({ squadId: requireSquadId(req) });
  });
  return app;
}

async function activeSquadIdOf(userId: string): Promise<string | null> {
  const { rows } = await pgPool.query<{ activeSquadId: string | null }>(
    'SELECT "activeSquadId" FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]?.activeSquadId ?? null;
}

async function setActiveSquadColumn(userId: string, squadId: string | null): Promise<void> {
  await pgPool.query('UPDATE users SET "activeSquadId" = $1 WHERE id = $2', [squadId, userId]);
}

describe('resolveSquad — authentication precondition', () => {
  it('401s when authenticateToken has not populated req.user', async () => {
    const res = await request(appWithUser(null)).get('/scope');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, error: 'User not authenticated' });
  });
});

describe('resolveSquad — falling back to the stored active squad', () => {
  it('uses users.activeSquadId when no header is sent', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id, { isPersonal: true });
    await setActiveSquadColumn(user.id, squad.id);

    const res = await request(appWithUser(user.id)).get('/scope');

    expect(res.status).toBe(200);
    expect(res.body.squadId).toBe(squad.id);
  });

  it('treats an empty header as absent rather than as a squad id', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id, { isPersonal: true });
    await setActiveSquadColumn(user.id, squad.id);

    // `requested || undefined` in the middleware is what makes this fall through to the
    // stored pointer. Without it the empty string would reach assertMember and 404.
    const res = await request(appWithUser(user.id)).get('/scope').set(SQUAD_HEADER, '');

    expect(res.status).toBe(200);
    expect(res.body.squadId).toBe(squad.id);
  });
});

describe('resolveSquad — the X-Squad-Id header', () => {
  it('honours the header for a squad the user belongs to', async () => {
    const user = await makeUser();
    const personal = await makeSquad(user.id, { isPersonal: true });
    const shared = await makeSquad(user.id, { name: 'Shared' });
    await setActiveSquadColumn(user.id, personal.id);

    const res = await request(appWithUser(user.id)).get('/scope').set(SQUAD_HEADER, shared.id);

    expect(res.status).toBe(200);
    expect(res.body.squadId).toBe(shared.id);
  });

  it('does NOT rewrite users.activeSquadId — the header scopes one request only', async () => {
    const user = await makeUser();
    const personal = await makeSquad(user.id, { isPersonal: true });
    const shared = await makeSquad(user.id, { name: 'Shared' });
    await setActiveSquadColumn(user.id, personal.id);

    await request(appWithUser(user.id)).get('/scope').set(SQUAD_HEADER, shared.id);

    expect(await activeSquadIdOf(user.id)).toBe(personal.id);
  });

  it('refuses a doubled header rather than picking one of the two squads', async () => {
    const user = await makeUser();
    const personal = await makeSquad(user.id, { isPersonal: true });
    const shared = await makeSquad(user.id, { name: 'Shared' });
    await setActiveSquadColumn(user.id, personal.id);

    // Node does NOT expose duplicates of an arbitrary header as an array — it joins them
    // with ", " into one string (verified: two x-squad-id lines arrive as
    // "squad-AAA, squad-BBB"). Only set-cookie is ever an array. So the joined value
    // reaches assertMember, matches no squad, and 404s. That is the safe outcome: a
    // second header cannot be smuggled in to widen or switch the scope.
    const res = await request(appWithUser(user.id))
      .get('/scope')
      .set(SQUAD_HEADER, [shared.id, personal.id] as unknown as string);

    expect(res.status).toBe(404);
  });

  it('takes the first entry if req.headers ever yields an array', async () => {
    const user = await makeUser();
    const personal = await makeSquad(user.id, { isPersonal: true });
    const shared = await makeSquad(user.id, { name: 'Shared' });
    await setActiveSquadColumn(user.id, personal.id);

    // The Array.isArray branch in the middleware is defensive: per the test above, an
    // HTTP request cannot produce it for this header. Reaching it at all means invoking
    // the middleware directly with a hand-built request. Covered rather than deleted
    // because upstream middleware is free to rewrite req.headers.
    const req = {
      user: { userId: user.id, email: 'x@test.local', role: 'USER' } as JwtPayload,
      headers: { [SQUAD_HEADER]: [shared.id, personal.id] },
    } as unknown as Request;

    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;

    await resolveSquad(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.squadId).toBe(shared.id);
  });
});

describe('resolveSquad — the security boundary', () => {
  it("404s on another user's squad id, and does not leak that it exists", async () => {
    const outsider = await makeUser();
    await makeSquad(outsider.id, { isPersonal: true });

    const owner = await makeUser();
    const theirSquad = await makeSquad(owner.id, { name: 'Private' });

    const res = await request(appWithUser(outsider.id))
      .get('/scope')
      .set(SQUAD_HEADER, theirSquad.id);

    // 404 rather than 403: a 403 would confirm the squad exists.
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Squad not found' });
  });

  it('404s identically for a squad id that does not exist at all', async () => {
    const user = await makeUser();
    await makeSquad(user.id, { isPersonal: true });

    const res = await request(appWithUser(user.id))
      .get('/scope')
      .set(SQUAD_HEADER, 'no-such-squad');

    // Same status and body as the foreign-squad case above — the two are indistinguishable
    // to a caller probing for which squad ids are real.
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Squad not found' });
  });

  it('404s after the user is removed from a squad, without waiting for the JWT to expire', async () => {
    const user = await makeUser();
    await makeSquad(user.id, { isPersonal: true });
    const shared = await makeSquad(user.id, { name: 'Shared' });

    const before = await request(appWithUser(user.id)).get('/scope').set(SQUAD_HEADER, shared.id);
    expect(before.status).toBe(200);

    await pgPool.query('DELETE FROM squad_members WHERE "userId" = $1 AND "squadId" = $2', [
      user.id,
      shared.id,
    ]);

    // This is why membership is read from the database per request rather than baked into
    // the token: tokens are 7-day with no revocation list.
    const after = await request(appWithUser(user.id)).get('/scope').set(SQUAD_HEADER, shared.id);
    expect(after.status).toBe(404);
  });
});

describe('resolveSquad — self-healing a stale active squad', () => {
  it('falls back to the personal squad when activeSquadId points somewhere the user has left', async () => {
    const user = await makeUser();
    const personal = await makeSquad(user.id, { isPersonal: true });
    const shared = await makeSquad(user.id, { name: 'Shared' });
    await setActiveSquadColumn(user.id, shared.id);

    await pgPool.query('DELETE FROM squad_members WHERE "userId" = $1 AND "squadId" = $2', [
      user.id,
      shared.id,
    ]);

    const res = await request(appWithUser(user.id)).get('/scope');

    expect(res.status).toBe(200);
    expect(res.body.squadId).toBe(personal.id);
  });

  it('repairs the stale pointer rather than re-resolving it on every request', async () => {
    const user = await makeUser();
    const personal = await makeSquad(user.id, { isPersonal: true });
    const shared = await makeSquad(user.id, { name: 'Shared' });
    await setActiveSquadColumn(user.id, shared.id);
    await pgPool.query('DELETE FROM squad_members WHERE "userId" = $1 AND "squadId" = $2', [
      user.id,
      shared.id,
    ]);

    await request(appWithUser(user.id)).get('/scope');

    expect(await activeSquadIdOf(user.id)).toBe(personal.id);
  });

  it('falls back to the personal squad when activeSquadId is null', async () => {
    const user = await makeUser();
    const personal = await makeSquad(user.id, { isPersonal: true });
    await setActiveSquadColumn(user.id, null);

    const res = await request(appWithUser(user.id)).get('/scope');

    expect(res.status).toBe(200);
    expect(res.body.squadId).toBe(personal.id);
  });

  it('propagates SquadError status when the user has no personal squad to fall back to', async () => {
    const user = await makeUser();
    // Deliberately no personal squad — a state signup makes impossible, which is why the
    // service treats it as a 500 rather than a client error.
    const res = await request(appWithUser(user.id)).get('/scope');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'User has no personal squad' });
  });
});

describe('resolveSquad — unexpected failures', () => {
  it('returns a generic 500 when the lookup throws a non-SquadError', async () => {
    const user = await makeUser();
    await makeSquad(user.id, { isPersonal: true });

    // `as never` matches the pattern the other integration suites use: pgPool.query is
    // heavily overloaded, so TS infers the mock argument as `never`.
    const spy = jest
      .spyOn(pgPool, 'query')
      .mockRejectedValueOnce(new Error('connection reset') as never);

    const res = await request(appWithUser(user.id)).get('/scope');

    expect(res.status).toBe(500);
    // The driver's message is not echoed to the client.
    expect(res.body).toEqual({ success: false, error: 'Failed to resolve squad' });
    spy.mockRestore();
  });
});

describe('requireSquadId', () => {
  it('returns the scope once resolveSquad has run', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id, { isPersonal: true });
    await setActiveSquadColumn(user.id, squad.id);

    const res = await request(appWithUser(user.id)).get('/scope');

    expect(res.body.squadId).toBe(squad.id);
  });

  it('throws rather than returning undefined when the middleware was not mounted', () => {
    // The whole point of the helper: a route that forgets resolveSquad must fail loudly
    // instead of writing `undefined` into a squadId column.
    expect(() => requireSquadId({} as Request)).toThrow(
      'req.squadId is not set — resolveSquad middleware must run first',
    );
  });
});
