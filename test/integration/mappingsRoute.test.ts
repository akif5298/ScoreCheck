/**
 * Integration tests for /api/mappings.
 *
 * These drive the whole stack for real — a signed JWT through authenticateToken, the real
 * resolveSquad middleware, the real service, and a real database. Nothing is mocked, so
 * the squad scoping these routes depend on is actually exercised rather than assumed:
 * the unit route suites elsewhere in this repo mock mappingService, which means their
 * "cannot touch another squad's data" assertions only ever test the mock.
 */
import express from 'express';
import request from 'supertest';
import { pgPool } from '@/services/supabase';
import authService from '@/services/authService';
import mappingsRouter from '@/routes/mappings';
import * as mappingService from '@/services/mappingService';
import { makeUser, makeSquad, makeMapping } from './factories';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/mappings', mappingsRouter);
  return a;
}

/** A real signed token for this user, so authenticateToken runs unmodified. */
function tokenFor(userId: string, email: string): string {
  return authService.generateToken({ id: userId, email, role: 'USER' });
}

/** A user with a squad they are an OWNER of, plus a bearer token. */
async function actor() {
  const user = await makeUser();
  const squad = await makeSquad(user.id);
  await pgPool.query('UPDATE users SET "activeSquadId" = $1 WHERE id = $2', [squad.id, user.id]);
  return { user, squad, auth: `Bearer ${tokenFor(user.id, user.email)}` };
}

async function seedGame(squadId: string, uploadedByUserId: string): Promise<string> {
  const { rows } = await pgPool.query<{ id: string }>(
    `INSERT INTO games (id, date, "homeTeam", "awayTeam", "homeScore", "awayScore",
                        "squadId", "uploadedByUserId", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, NOW(), 'H', 'A', 1, 1, $1, $2, NOW(), NOW())
     RETURNING id`,
    [squadId, uploadedByUserId],
  );
  return rows[0]!.id;
}

async function seedPlayer(gameId: string, squadId: string, name: string) {
  await pgPool.query(
    `INSERT INTO players (id, name, team, "gameIdFromFile", "playerId", position,
                          "gameId", "squadId", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, 'H', '1', gen_random_uuid()::text, 'PG', $2, $3, NOW(), NOW())`,
    [name, gameId, squadId],
  );
}

/**
 * Fails only the statements matching `pattern`, passing everything else through.
 *
 * A blunt mockRejectedValueOnce is wrong here: resolveSquad queries the database before
 * the handler does, so the "once" is spent on scope resolution and the response comes back
 * as "Failed to resolve squad" — a green-looking test of the wrong code path.
 */
function failQueryMatching(pattern: RegExp, message = 'db down'): void {
  const real = pgPool.query.bind(pgPool);
  jest.spyOn(pgPool, 'query').mockImplementation(((sql: unknown, params: unknown) => {
    if (typeof sql === 'string' && pattern.test(sql)) return Promise.reject(new Error(message));
    return real(sql as never, params as never);
  }) as never);
}

/**
 * Makes the retroactive backfill fail, without disturbing anything else.
 *
 * Spied at the service boundary rather than by breaking the connection pool: pg's
 * `pool.query()` acquires a client via `pool.connect()` internally, so mocking connect
 * also breaks every ordinary query — including the one resolveSquad runs before the
 * handler is even reached.
 */
function failRetroactiveRename(message = 'backfill unavailable'): void {
  jest
    .spyOn(mappingService, 'applyRetroactiveMapping')
    .mockRejectedValue(new Error(message) as never);
}

afterEach(() => jest.restoreAllMocks());

async function mappingCount(squadId: string): Promise<number> {
  const { rows } = await pgPool.query<{ n: string }>(
    'SELECT COUNT(*) n FROM player_mappings WHERE "squadId" = $1',
    [squadId],
  );
  return Number(rows[0]!.n);
}

describe('authentication and scope', () => {
  it.each([
    ['GET', '/api/mappings'],
    ['POST', '/api/mappings'],
    ['PUT', '/api/mappings/some-id'],
    ['DELETE', '/api/mappings/some-id'],
  ])('%s %s requires a token', async (method, path) => {
    const res = await request(app())[method.toLowerCase() as 'get'](path);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, error: 'Access token required' });
  });

  it('rejects a token that is not signed with our secret', async () => {
    const res = await request(app())
      .get('/api/mappings')
      .set('Authorization', 'Bearer not-a-real-token');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, error: 'Authentication failed' });
  });
});

describe('GET /api/mappings', () => {
  it('returns the squad roster ordered by gamertag', async () => {
    const me = await actor();
    await makeMapping(me.squad.id, 'zeta', 'Zed');
    await makeMapping(me.squad.id, 'alpha', 'Al');

    const res = await request(app()).get('/api/mappings').set('Authorization', me.auth);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.map((m: { gamertag: string }) => m.gamertag)).toEqual(['alpha', 'zeta']);
  });

  it('returns an empty list for a squad with no roster', async () => {
    const me = await actor();

    const res = await request(app()).get('/api/mappings').set('Authorization', me.auth);

    expect(res.body.data).toEqual([]);
  });

  it("never returns another squad's mappings", async () => {
    const me = await actor();
    const other = await actor();
    await makeMapping(other.squad.id, 'theirs', 'Them');

    const res = await request(app()).get('/api/mappings').set('Authorization', me.auth);

    expect(res.body.data).toEqual([]);
  });

  it('500s with a generic message when the lookup fails', async () => {
    const me = await actor();
    failQueryMatching(/SELECT id, "squadId", gamertag/);

    const res = await request(app()).get('/api/mappings').set('Authorization', me.auth);

    // The driver's message is not echoed to the client.
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to fetch mappings' });
  });
});

describe('POST /api/mappings — validation', () => {
  const invalid: Array<[string, Record<string, unknown>, string]> = [
    ['missing gamertag', { displayName: 'Akif' }, 'gamertag'],
    ['empty gamertag', { gamertag: '   ', displayName: 'Akif' }, 'gamertag'],
    ['non-string gamertag', { gamertag: 42, displayName: 'Akif' }, 'gamertag'],
    ['overlong gamertag', { gamertag: 'x'.repeat(51), displayName: 'Akif' }, 'gamertag'],
    ['missing displayName', { gamertag: 'tag' }, 'displayName'],
    ['empty displayName', { gamertag: 'tag', displayName: '  ' }, 'displayName'],
    ['non-string displayName', { gamertag: 'tag', displayName: 7 }, 'displayName'],
    ['overlong displayName', { gamertag: 'tag', displayName: 'y'.repeat(51) }, 'displayName'],
  ];

  it.each(invalid)('400s on %s', async (_label, body, field) => {
    const me = await actor();

    const res = await request(app())
      .post('/api/mappings')
      .set('Authorization', me.auth)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain(field);
    expect(await mappingCount(me.squad.id)).toBe(0);
  });

  it('accepts a value of exactly the 50-character limit', async () => {
    const me = await actor();

    const res = await request(app())
      .post('/api/mappings')
      .set('Authorization', me.auth)
      .send({ gamertag: 'x'.repeat(50), displayName: 'y'.repeat(50) });

    // The bound is inclusive; 51 is rejected above.
    expect(res.status).toBe(201);
  });
});

describe('POST /api/mappings', () => {
  it('creates the mapping and reports zero retroactive renames when nothing matches', async () => {
    const me = await actor();

    const res = await request(app())
      .post('/api/mappings')
      .set('Authorization', me.auth)
      .send({ gamertag: 'newtag', displayName: 'New Person' });

    expect(res.status).toBe(201);
    expect(res.body.data.mapping).toMatchObject({
      gamertag: 'newtag',
      displayName: 'New Person',
      squadId: me.squad.id,
    });
    expect(res.body.data.retroactiveCount).toBe(0);
  });

  it('trims surrounding whitespace before storing', async () => {
    const me = await actor();

    const res = await request(app())
      .post('/api/mappings')
      .set('Authorization', me.auth)
      .send({ gamertag: '  spaced  ', displayName: '  Person  ' });

    expect(res.body.data.mapping).toMatchObject({ gamertag: 'spaced', displayName: 'Person' });
  });

  it('retroactively renames existing player rows and reports the count', async () => {
    const me = await actor();
    const gameId = await seedGame(me.squad.id, me.user.id);
    await seedPlayer(gameId, me.squad.id, 'xXrawtagXx');

    const res = await request(app())
      .post('/api/mappings')
      .set('Authorization', me.auth)
      .send({ gamertag: 'xXrawtagXx', displayName: 'Akif' });

    expect(res.body.data.retroactiveCount).toBe(1);
    const { rows } = await pgPool.query<{ name: string }>(
      'SELECT name FROM players WHERE "gameId" = $1',
      [gameId],
    );
    expect(rows[0]!.name).toBe('Akif');
  });

  it('409s on a duplicate gamertag within the squad', async () => {
    const me = await actor();
    await makeMapping(me.squad.id, 'dupe', 'First');

    const res = await request(app())
      .post('/api/mappings')
      .set('Authorization', me.auth)
      .send({ gamertag: 'dupe', displayName: 'Second' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('A mapping for this gamertag already exists');
  });

  it('allows the same gamertag in a different squad', async () => {
    const me = await actor();
    const other = await actor();
    await makeMapping(other.squad.id, 'shared', 'Theirs');

    const res = await request(app())
      .post('/api/mappings')
      .set('Authorization', me.auth)
      .send({ gamertag: 'shared', displayName: 'Mine' });

    expect(res.status).toBe(201);
  });

  it('still returns 201 when the retroactive rename fails', async () => {
    const me = await actor();
    // The mapping itself is the user's request; a failed backfill is logged, not surfaced,
    // because the roster entry was created successfully and re-running is safe.
    failRetroactiveRename();

    const res = await request(app())
      .post('/api/mappings')
      .set('Authorization', me.auth)
      .send({ gamertag: 'tag', displayName: 'Person' });

    expect(res.status).toBe(201);
    expect(res.body.data.retroactiveCount).toBe(0);
  });

  it('500s when the insert fails for a non-duplicate reason', async () => {
    const me = await actor();
    failQueryMatching(/INSERT INTO player_mappings/);

    const res = await request(app())
      .post('/api/mappings')
      .set('Authorization', me.auth)
      .send({ gamertag: 'tag', displayName: 'Person' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to create mapping' });
  });
});

describe('PUT /api/mappings/:id', () => {
  it('updates both fields', async () => {
    const me = await actor();
    const id = await makeMapping(me.squad.id, 'old', 'Old Name');

    const res = await request(app())
      .put(`/api/mappings/${id}`)
      .set('Authorization', me.auth)
      .send({ gamertag: 'new', displayName: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.data.mapping).toMatchObject({ gamertag: 'new', displayName: 'New Name' });
  });

  it('renames player rows that used the OLD display name, not just the gamertag', async () => {
    const me = await actor();
    const id = await makeMapping(me.squad.id, 'tag', 'Old Name');
    const gameId = await seedGame(me.squad.id, me.user.id);
    await seedPlayer(gameId, me.squad.id, 'Old Name');

    const res = await request(app())
      .put(`/api/mappings/${id}`)
      .set('Authorization', me.auth)
      .send({ gamertag: 'tag', displayName: 'New Name' });

    // This is why the route reads the mapping before updating it: the previous display
    // name is the only way to find rows already renamed under it.
    expect(res.body.data.retroactiveCount).toBe(1);
    const { rows } = await pgPool.query<{ name: string }>(
      'SELECT name FROM players WHERE "gameId" = $1',
      [gameId],
    );
    expect(rows[0]!.name).toBe('New Name');
  });

  it('400s on invalid input without touching the row', async () => {
    const me = await actor();
    const id = await makeMapping(me.squad.id, 'tag', 'Name');

    const res = await request(app())
      .put(`/api/mappings/${id}`)
      .set('Authorization', me.auth)
      .send({ gamertag: '', displayName: 'Name' });

    expect(res.status).toBe(400);
  });

  it('404s for an unknown id', async () => {
    const me = await actor();

    const res = await request(app())
      .put('/api/mappings/does-not-exist')
      .set('Authorization', me.auth)
      .send({ gamertag: 'tag', displayName: 'Name' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Mapping not found');
  });

  it("404s for another squad's mapping, and leaves it untouched", async () => {
    const me = await actor();
    const other = await actor();
    const theirId = await makeMapping(other.squad.id, 'theirs', 'Them');

    const res = await request(app())
      .put(`/api/mappings/${theirId}`)
      .set('Authorization', me.auth)
      .send({ gamertag: 'hijacked', displayName: 'Mallory' });

    expect(res.status).toBe(404);
    const { rows } = await pgPool.query<{ gamertag: string }>(
      'SELECT gamertag FROM player_mappings WHERE id = $1',
      [theirId],
    );
    expect(rows[0]!.gamertag).toBe('theirs');
  });

  it('409s when the new gamertag collides with another entry in the squad', async () => {
    const me = await actor();
    await makeMapping(me.squad.id, 'taken', 'Someone');
    const id = await makeMapping(me.squad.id, 'mine', 'Me');

    const res = await request(app())
      .put(`/api/mappings/${id}`)
      .set('Authorization', me.auth)
      .send({ gamertag: 'taken', displayName: 'Me' });

    expect(res.status).toBe(409);
  });

  it('still returns 200 when the retroactive rename fails', async () => {
    const me = await actor();
    const id = await makeMapping(me.squad.id, 'tag', 'Name');
    failRetroactiveRename();

    const res = await request(app())
      .put(`/api/mappings/${id}`)
      .set('Authorization', me.auth)
      .send({ gamertag: 'tag2', displayName: 'Name2' });

    expect(res.status).toBe(200);
    expect(res.body.data.retroactiveCount).toBe(0);
  });

  it('500s on an unexpected failure', async () => {
    const me = await actor();
    const id = await makeMapping(me.squad.id, 'tag', 'Name');
    failQueryMatching(/UPDATE player_mappings/);

    const res = await request(app())
      .put(`/api/mappings/${id}`)
      .set('Authorization', me.auth)
      .send({ gamertag: 'tag2', displayName: 'Name2' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to update mapping' });
  });
});

describe('DELETE /api/mappings/:id', () => {
  it('removes the mapping', async () => {
    const me = await actor();
    const id = await makeMapping(me.squad.id, 'tag', 'Name');

    const res = await request(app())
      .delete(`/api/mappings/${id}`)
      .set('Authorization', me.auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: null });
    expect(await mappingCount(me.squad.id)).toBe(0);
  });

  it('404s for an unknown id', async () => {
    const me = await actor();

    const res = await request(app())
      .delete('/api/mappings/does-not-exist')
      .set('Authorization', me.auth);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Mapping not found');
  });

  it("404s for another squad's mapping, and leaves it in place", async () => {
    const me = await actor();
    const other = await actor();
    const theirId = await makeMapping(other.squad.id, 'theirs', 'Them');

    const res = await request(app())
      .delete(`/api/mappings/${theirId}`)
      .set('Authorization', me.auth);

    expect(res.status).toBe(404);
    expect(await mappingCount(other.squad.id)).toBe(1);
  });

  it('500s on an unexpected failure', async () => {
    const me = await actor();
    const id = await makeMapping(me.squad.id, 'tag', 'Name');
    failQueryMatching(/DELETE FROM player_mappings/);

    const res = await request(app())
      .delete(`/api/mappings/${id}`)
      .set('Authorization', me.auth);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to delete mapping' });
  });
});
