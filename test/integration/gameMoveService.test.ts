/**
 * Integration tests for moveGamesToSquad.
 *
 * Four things must happen together or the target squad's analytics go quietly wrong:
 * rows re-scope, names reconcile through the roster, lineup strings rewrite alongside the
 * names, and aggregates recompute for the target AND every source. None of those failures
 * throws — they just produce wrong numbers — so the assertions here check the database
 * afterwards rather than the return value alone.
 *
 * Everything runs against real SQL because the parts most likely to break are the parts a
 * mock would paper over: the FOR UPDATE select, the advisory locks, the uniqueness
 * constraint the merge guard exists to protect, and the recompute.
 */
import { randomUUID } from 'node:crypto';
import { pgPool } from '@/services/supabase';
import { moveGamesToSquad } from '@/services/gameMoveService';
import { makeUser, makeSquad, makeMapping } from './factories';

/** A 60-char hex hash, matching computePerceptualHash's output width. */
const HASH_A = 'a1'.repeat(30);
const HASH_B = '5c'.repeat(30);

/** Valid composite lineup strings — "Name (POS) + Name (POS)". */
const HOME_LINEUP = 'Nillan (PG) + AI (SG)';
const AWAY_LINEUP = 'Rival (PG) + AI (SG)';

async function addMember(squadId: string, userId: string, role: 'OWNER' | 'MEMBER') {
  await pgPool.query(
    `INSERT INTO squad_members (id, "squadId", "userId", role, "joinedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, NOW())`,
    [squadId, userId, role],
  );
}

async function seedGame(
  squadId: string,
  uploadedByUserId: string,
  opts: { homeTeam?: string; awayTeam?: string; imageHash?: string | null } = {},
): Promise<string> {
  const id = randomUUID();
  await pgPool.query(
    `INSERT INTO games (id, date, "homeTeam", "awayTeam", "homeScore", "awayScore",
                        "squadId", "uploadedByUserId", "imageHash", "createdAt", "updatedAt")
     VALUES ($1, NOW(), $2, $3, 100, 90, $4, $5, $6, NOW(), NOW())`,
    [
      id,
      opts.homeTeam ?? HOME_LINEUP,
      opts.awayTeam ?? AWAY_LINEUP,
      squadId,
      uploadedByUserId,
      opts.imageHash === undefined ? HASH_A : opts.imageHash,
    ],
  );
  return id;
}

async function seedPlayer(gameId: string, squadId: string, name: string, team: string) {
  await pgPool.query(
    `INSERT INTO players (id, name, team, "gameIdFromFile", "playerId", position,
                          "gameId", "squadId", points, "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, '0001', $3, 'PG', $4, $5, 10, NOW(), NOW())`,
    [name, team, randomUUID(), gameId, squadId],
  );
}

async function seedTeam(gameId: string, squadId: string, name: string, isHome: boolean) {
  await pgPool.query(
    `INSERT INTO teams (id, name, "isHome", "gameId", "squadId", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, NOW(), NOW())`,
    [name, isHome, gameId, squadId],
  );
}

/** A game whose every lineup-bearing column is a parseable composite name. */
async function seedFullGame(
  squadId: string,
  uploaderId: string,
  opts: { imageHash?: string | null; awayTeam?: string; playerName?: string } = {},
): Promise<string> {
  // Built conditionally rather than passing `undefined` through: exactOptionalPropertyTypes
  // treats an explicit undefined as a distinct type from an absent key.
  const gameId = await seedGame(squadId, uploaderId, {
    ...(opts.imageHash !== undefined ? { imageHash: opts.imageHash } : {}),
    ...(opts.awayTeam !== undefined ? { awayTeam: opts.awayTeam } : {}),
  });
  await seedPlayer(gameId, squadId, opts.playerName ?? 'Nillan', HOME_LINEUP);
  await seedTeam(gameId, squadId, HOME_LINEUP, true);
  return gameId;
}

async function squadIdOfGame(gameId: string): Promise<string> {
  const { rows } = await pgPool.query<{ squadId: string }>(
    'SELECT "squadId" FROM games WHERE id = $1',
    [gameId],
  );
  return rows[0]!.squadId;
}

async function scopeOf(gameId: string) {
  const [players, teams] = await Promise.all([
    pgPool.query<{ squadId: string; name: string; team: string }>(
      'SELECT "squadId", name, team FROM players WHERE "gameId" = $1',
      [gameId],
    ),
    pgPool.query<{ squadId: string; name: string }>(
      'SELECT "squadId", name FROM teams WHERE "gameId" = $1',
      [gameId],
    ),
  ]);
  return { players: players.rows, teams: teams.rows };
}

async function gameLineups(gameId: string) {
  const { rows } = await pgPool.query<{ homeTeam: string; awayTeam: string }>(
    'SELECT "homeTeam", "awayTeam" FROM games WHERE id = $1',
    [gameId],
  );
  return rows[0]!;
}

async function countTotals(squadId: string): Promise<number> {
  const { rows } = await pgPool.query<{ n: string }>(
    'SELECT COUNT(*) n FROM player_totals WHERE squadid = $1',
    [squadId],
  );
  return Number(rows[0]!.n);
}

/** Owner of a brand-new squad, ready to move games in or out. */
async function ownerWithSquad() {
  const user = await makeUser();
  const squad = await makeSquad(user.id);
  return { user, squad };
}

describe('moveGamesToSquad — guards', () => {
  it('rejects an empty selection', async () => {
    const { user, squad } = await ownerWithSquad();

    await expect(moveGamesToSquad(user.id, squad.id, [])).rejects.toMatchObject({
      status: 400,
      message: 'No games selected',
    });
  });

  it('404s when the caller is not a member of the target squad', async () => {
    const outsider = await makeUser();
    const target = await ownerWithSquad();
    const gameId = await seedFullGame(target.squad.id, target.user.id);

    // 404 rather than 403 — membership of a squad you are not in is not disclosed.
    await expect(moveGamesToSquad(outsider.id, target.squad.id, [gameId])).rejects.toMatchObject({
      status: 404,
    });
  });

  it('404s when any requested game id does not exist', async () => {
    const { user, squad } = await ownerWithSquad();
    const real = await seedFullGame(squad.id, user.id);

    await expect(
      moveGamesToSquad(user.id, squad.id, [real, randomUUID()]),
    ).rejects.toMatchObject({ status: 404, message: 'One or more games were not found' });
  });

  it('404s when the caller is not a member of the source squad', async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    const gameId = await seedFullGame(source.squad.id, source.user.id);

    // target.user can reach their own squad but has no membership of source.
    await expect(
      moveGamesToSquad(target.user.id, target.squad.id, [gameId]),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('moveGamesToSquad — who may move what', () => {
  it("403s when a plain member tries to move someone else's game out", async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    const member = await makeUser();
    await addMember(source.squad.id, member.id, 'MEMBER');
    await addMember(target.squad.id, member.id, 'MEMBER');

    // Uploaded by the owner, not by the member doing the moving.
    const gameId = await seedFullGame(source.squad.id, source.user.id);

    await expect(
      moveGamesToSquad(member.id, target.squad.id, [gameId]),
    ).rejects.toMatchObject({
      status: 403,
      message: 'You can only move games you uploaded, unless you own the squad',
    });

    // Moving out is a deletion from the source's view, so nothing may have changed.
    expect(await squadIdOfGame(gameId)).toBe(source.squad.id);
  });

  it('lets a plain member move a game they uploaded themselves', async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    const member = await makeUser();
    await addMember(source.squad.id, member.id, 'MEMBER');
    await addMember(target.squad.id, member.id, 'MEMBER');

    const gameId = await seedFullGame(source.squad.id, member.id);

    const result = await moveGamesToSquad(member.id, target.squad.id, [gameId]);

    expect(result.moved).toEqual([gameId]);
    expect(await squadIdOfGame(gameId)).toBe(target.squad.id);
  });

  it("lets the source squad's OWNER move a game someone else uploaded", async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    const uploader = await makeUser();
    await addMember(source.squad.id, uploader.id, 'MEMBER');
    await addMember(target.squad.id, source.user.id, 'MEMBER');

    const gameId = await seedFullGame(source.squad.id, uploader.id);

    const result = await moveGamesToSquad(source.user.id, target.squad.id, [gameId]);

    expect(result.moved).toEqual([gameId]);
  });
});

describe('moveGamesToSquad — games that need no move', () => {
  it('reports a game already in the target as alreadyThere, not as moved', async () => {
    const { user, squad } = await ownerWithSquad();
    const gameId = await seedFullGame(squad.id, user.id);

    const result = await moveGamesToSquad(user.id, squad.id, [gameId]);

    // A no-op rather than an error, so re-running a move is safe.
    expect(result.alreadyThere).toEqual([gameId]);
    expect(result.moved).toEqual([]);
  });

  it('reports a perceptually identical game in the target as a duplicate', async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    await addMember(target.squad.id, source.user.id, 'MEMBER');
    await addMember(source.squad.id, target.user.id, 'MEMBER');

    const existing = await seedFullGame(target.squad.id, target.user.id, { imageHash: HASH_A });
    const incoming = await seedFullGame(source.squad.id, source.user.id, { imageHash: HASH_A });

    const result = await moveGamesToSquad(source.user.id, target.squad.id, [incoming]);

    expect(result.duplicates).toEqual([{ gameId: incoming, existingGameId: existing }]);
    expect(result.moved).toEqual([]);
    expect(await squadIdOfGame(incoming)).toBe(source.squad.id);
  });

  it('moves a game whose hash is far enough from everything in the target', async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    await addMember(target.squad.id, source.user.id, 'MEMBER');

    await seedFullGame(target.squad.id, target.user.id, { imageHash: HASH_A });
    const incoming = await seedFullGame(source.squad.id, source.user.id, { imageHash: HASH_B });

    const result = await moveGamesToSquad(source.user.id, target.squad.id, [incoming]);

    expect(result.duplicates).toEqual([]);
    expect(result.moved).toEqual([incoming]);
  });

  it('moves a game with no hash at all rather than treating it as a duplicate', async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    await addMember(target.squad.id, source.user.id, 'MEMBER');

    await seedFullGame(target.squad.id, target.user.id, { imageHash: HASH_A });
    const incoming = await seedFullGame(source.squad.id, source.user.id, { imageHash: null });

    const result = await moveGamesToSquad(source.user.id, target.squad.id, [incoming]);

    expect(result.moved).toEqual([incoming]);
  });
});

describe('moveGamesToSquad — re-scoping', () => {
  it('re-scopes the game, its players and its teams together', async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    await addMember(target.squad.id, source.user.id, 'MEMBER');

    const gameId = await seedFullGame(source.squad.id, source.user.id);

    await moveGamesToSquad(source.user.id, target.squad.id, [gameId]);

    // Any row left behind would keep contributing to the source squad's stats.
    expect(await squadIdOfGame(gameId)).toBe(target.squad.id);
    const { players, teams } = await scopeOf(gameId);
    expect(players.every((p) => p.squadId === target.squad.id)).toBe(true);
    expect(teams.every((t) => t.squadId === target.squad.id)).toBe(true);
  });

  it('recomputes aggregates for the source as well as the target', async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    await addMember(target.squad.id, source.user.id, 'MEMBER');
    await makeMapping(source.squad.id, 'tag1', 'Nillan');
    await makeMapping(target.squad.id, 'tag1', 'Nillan');

    const gameId = await seedFullGame(source.squad.id, source.user.id);
    await moveGamesToSquad(source.user.id, target.squad.id, [gameId]);

    // player_totals is add-only, so without an explicit source recompute the source would
    // keep counting a game it no longer holds.
    expect(await countTotals(source.squad.id)).toBe(0);
    expect(await countTotals(target.squad.id)).toBeGreaterThan(0);
  });
});

describe('moveGamesToSquad — name reconciliation', () => {
  it('renames a player to the target squad\'s spelling via the shared gamertag', async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    await addMember(target.squad.id, source.user.id, 'MEMBER');

    // The gamertag is the identity; the display name is not.
    await makeMapping(source.squad.id, 'grim_bulletz', 'Nillan');
    await makeMapping(target.squad.id, 'grim_bulletz', 'Nil');

    const gameId = await seedFullGame(source.squad.id, source.user.id);

    const result = await moveGamesToSquad(source.user.id, target.squad.id, [gameId]);

    expect(result.renamed).toEqual([{ from: 'Nillan', to: 'Nil' }]);
    const { players } = await scopeOf(gameId);
    expect(players[0]!.name).toBe('Nil');
  });

  it('rewrites the lineup strings on games, players and teams in step', async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    await addMember(target.squad.id, source.user.id, 'MEMBER');
    await makeMapping(source.squad.id, 'grim_bulletz', 'Nillan');
    await makeMapping(target.squad.id, 'grim_bulletz', 'Nil');

    const gameId = await seedFullGame(source.squad.id, source.user.id);

    await moveGamesToSquad(source.user.id, target.squad.id, [gameId]);

    // lineupEfficiency joins on p.team = g."homeTeam"; if these drift the join silently
    // returns nothing, so they must agree exactly.
    const { homeTeam } = await gameLineups(gameId);
    const { players, teams } = await scopeOf(gameId);
    expect(homeTeam).toBe('Nil (PG) + AI (SG)');
    expect(players[0]!.team).toBe(homeTeam);
    expect(teams[0]!.name).toBe(homeTeam);
  });

  it('reports a name the target squad has never heard of as unmapped', async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    await addMember(target.squad.id, source.user.id, 'MEMBER');

    const gameId = await seedFullGame(source.squad.id, source.user.id, { playerName: 'Ghost' });

    const result = await moveGamesToSquad(source.user.id, target.squad.id, [gameId]);

    // Moved, but accrues no stats until someone maps it on the roster page.
    expect(result.unmapped).toContain('Ghost');
    expect(result.moved).toEqual([gameId]);
  });

  it('reports a conflict instead of guessing when one name resolves to two people', async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    await addMember(target.squad.id, source.user.id, 'MEMBER');

    // One source display name behind two gamertags...
    await makeMapping(source.squad.id, 'tag-main', 'Nillan');
    await makeMapping(source.squad.id, 'tag-alt', 'Nillan');
    // ...which the target squad believes are two different people.
    await makeMapping(target.squad.id, 'tag-main', 'Nil');
    await makeMapping(target.squad.id, 'tag-alt', 'Someone Else');

    const gameId = await seedFullGame(source.squad.id, source.user.id);

    const result = await moveGamesToSquad(source.user.id, target.squad.id, [gameId]);

    expect(result.conflicts).toContain('Nillan');
    expect(result.renamed).toEqual([]);
    // Left untouched rather than merged onto a guess.
    const { players } = await scopeOf(gameId);
    expect(players[0]!.name).toBe('Nillan');
  });

  it('refuses the whole move when two players would merge into one', async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    await addMember(target.squad.id, source.user.id, 'MEMBER');

    // Two distinct people in the source both resolve to "Nil" in the target.
    await makeMapping(source.squad.id, 'tag-a', 'Nillan');
    await makeMapping(source.squad.id, 'tag-b', 'Nilesh');
    await makeMapping(target.squad.id, 'tag-a', 'Nil');
    await makeMapping(target.squad.id, 'tag-b', 'Nil');

    const gameId = await seedGame(source.squad.id, source.user.id);
    await seedPlayer(gameId, source.squad.id, 'Nillan', HOME_LINEUP);
    await seedPlayer(gameId, source.squad.id, 'Nilesh', HOME_LINEUP);
    await seedTeam(gameId, source.squad.id, HOME_LINEUP, true);

    await expect(
      moveGamesToSquad(source.user.id, target.squad.id, [gameId]),
    ).rejects.toMatchObject({ status: 409 });

    // 409 rather than a raw uniqueness error, and the transaction rolls back entirely —
    // silently summing two people's stat lines would be far worse than refusing.
    expect(await squadIdOfGame(gameId)).toBe(source.squad.id);
  });

  it('moves without renaming when a lineup string is composite but malformed', async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    await addMember(target.squad.id, source.user.id, 'MEMBER');
    await makeMapping(source.squad.id, 'grim_bulletz', 'Nillan');
    await makeMapping(target.squad.id, 'grim_bulletz', 'Nil');

    // Carries the " + " separator, so it is a lineup — but the second token has no
    // position and will not parse.
    const gameId = await seedFullGame(source.squad.id, source.user.id, {
      awayTeam: 'Rival (PG) + AI',
    });

    const result = await moveGamesToSquad(source.user.id, target.squad.id, [gameId]);

    // All-or-nothing per game: a half-rewritten lineup would break the join silently, so
    // the game moves with its original names and is reported instead.
    expect(result.lineupRewriteSkipped).toEqual([gameId]);
    expect(result.moved).toEqual([gameId]);
    const { players } = await scopeOf(gameId);
    expect(players[0]!.name).toBe('Nillan');
  });

  it('renames normally when the opponent side is a plain "Team B" name', async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    await addMember(target.squad.id, source.user.id, 'MEMBER');
    await makeMapping(source.squad.id, 'grim_bulletz', 'Nillan');
    await makeMapping(target.squad.id, 'grim_bulletz', 'Nil');

    // The regression guard for the real bug: the opponent side is named this way by
    // convention, and it used to suppress renaming for the entire game.
    const gameId = await seedFullGame(source.squad.id, source.user.id, { awayTeam: 'Team B' });

    const result = await moveGamesToSquad(source.user.id, target.squad.id, [gameId]);

    expect(result.lineupRewriteSkipped).toEqual([]);
    expect(result.renamed).toEqual([{ from: 'Nillan', to: 'Nil' }]);
    const { homeTeam, awayTeam } = await gameLineups(gameId);
    expect(homeTeam).toBe('Nil (PG) + AI (SG)');
    // The plain name is carried through untouched, so players on that side still join.
    expect(awayTeam).toBe('Team B');
  });

  it("skips the rewrite when a PLAYER's team string cannot be parsed", async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    await addMember(target.squad.id, source.user.id, 'MEMBER');
    await makeMapping(source.squad.id, 'grim_bulletz', 'Nillan');
    await makeMapping(target.squad.id, 'grim_bulletz', 'Nil');

    // games.homeTeam/awayTeam both parse; the failure is on the player row itself, and it
    // must be a malformed COMPOSITE name — a plain one is now passed through.
    const gameId = await seedGame(source.squad.id, source.user.id);
    await seedPlayer(gameId, source.squad.id, 'Nillan', 'Nillan (PG) + AI');
    await seedTeam(gameId, source.squad.id, HOME_LINEUP, true);

    const result = await moveGamesToSquad(source.user.id, target.squad.id, [gameId]);

    expect(result.lineupRewriteSkipped).toEqual([gameId]);
    expect((await scopeOf(gameId)).players[0]!.name).toBe('Nillan');
  });

  it("skips the rewrite when a TEAM row's name cannot be parsed", async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    await addMember(target.squad.id, source.user.id, 'MEMBER');
    await makeMapping(source.squad.id, 'grim_bulletz', 'Nillan');
    await makeMapping(target.squad.id, 'grim_bulletz', 'Nil');

    const gameId = await seedGame(source.squad.id, source.user.id);
    await seedPlayer(gameId, source.squad.id, 'Nillan', HOME_LINEUP);
    await seedTeam(gameId, source.squad.id, 'Nillan (PG) + AI', true);

    const result = await moveGamesToSquad(source.user.id, target.squad.id, [gameId]);

    expect(result.lineupRewriteSkipped).toEqual([gameId]);
    expect((await scopeOf(gameId)).teams[0]!.name).toBe('Nillan (PG) + AI');
  });

  it('leaves a player with no rename entry under their original name', async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    await addMember(target.squad.id, source.user.id, 'MEMBER');
    await makeMapping(source.squad.id, 'grim_bulletz', 'Nillan');
    await makeMapping(target.squad.id, 'grim_bulletz', 'Nil');

    const gameId = await seedGame(source.squad.id, source.user.id);
    await seedPlayer(gameId, source.squad.id, 'Nillan', HOME_LINEUP);
    // "AI" is a filler teammate nobody maps; it must survive the rewrite untouched.
    await seedPlayer(gameId, source.squad.id, 'AI', HOME_LINEUP);
    await seedTeam(gameId, source.squad.id, HOME_LINEUP, true);

    await moveGamesToSquad(source.user.id, target.squad.id, [gameId]);

    const names = (await scopeOf(gameId)).players.map((p) => p.name).sort();
    expect(names).toEqual(['AI', 'Nil']);
  });

  it('returns false rather than throwing if the game vanishes mid-rewrite', async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    await addMember(target.squad.id, source.user.id, 'MEMBER');
    await makeMapping(source.squad.id, 'grim_bulletz', 'Nillan');
    await makeMapping(target.squad.id, 'grim_bulletz', 'Nil');
    const gameId = await seedFullGame(source.squad.id, source.user.id);

    // Defensive guard: the row is selected immediately after the re-scope UPDATE inside the
    // same transaction, so it cannot really be missing. Reaching it needs a stub.
    const realConnect = pgPool.connect.bind(pgPool);
    jest.spyOn(pgPool, 'connect').mockImplementation(async () => {
      const client = await realConnect();
      const realQuery = client.query.bind(client);
      jest.spyOn(client, 'query').mockImplementation(((sql: unknown, params: unknown) => {
        if (typeof sql === 'string' && /SELECT "homeTeam", "awayTeam" FROM games/.test(sql)) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return realQuery(sql as never, params as never);
      }) as never);
      return client;
    });

    const result = await moveGamesToSquad(source.user.id, target.squad.id, [gameId]);
    jest.restoreAllMocks();

    expect(result.lineupRewriteSkipped).toEqual([gameId]);
    expect(result.moved).toEqual([gameId]);
  });

  it('skips reconciliation entirely when both squads already agree on every name', async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    await addMember(target.squad.id, source.user.id, 'MEMBER');
    await makeMapping(source.squad.id, 'grim_bulletz', 'Nillan');
    await makeMapping(target.squad.id, 'grim_bulletz', 'Nillan');

    const gameId = await seedFullGame(source.squad.id, source.user.id);

    const result = await moveGamesToSquad(source.user.id, target.squad.id, [gameId]);

    expect(result.renamed).toEqual([]);
    expect(result.moved).toEqual([gameId]);
    expect(await gameLineups(gameId)).toMatchObject({ homeTeam: HOME_LINEUP });
  });
});

describe('moveGamesToSquad — multiple sources in one request', () => {
  it('reconciles each source against its own roster', async () => {
    const target = await ownerWithSquad();
    const sourceA = await ownerWithSquad();
    const sourceB = await ownerWithSquad();
    await addMember(target.squad.id, sourceA.user.id, 'MEMBER');
    await addMember(sourceB.squad.id, sourceA.user.id, 'OWNER');

    // The same display name means different people in the two source squads.
    await makeMapping(sourceA.squad.id, 'tag-a', 'Nillan');
    await makeMapping(sourceB.squad.id, 'tag-b', 'Nillan');
    await makeMapping(target.squad.id, 'tag-a', 'Nil');
    await makeMapping(target.squad.id, 'tag-b', 'Bee');

    const gameA = await seedFullGame(sourceA.squad.id, sourceA.user.id, { imageHash: HASH_A });
    const gameB = await seedFullGame(sourceB.squad.id, sourceA.user.id, { imageHash: HASH_B });

    const result = await moveGamesToSquad(sourceA.user.id, target.squad.id, [gameA, gameB]);

    expect(result.moved).toHaveLength(2);
    const namesA = (await scopeOf(gameA)).players.map((p) => p.name);
    const namesB = (await scopeOf(gameB)).players.map((p) => p.name);
    expect(namesA).toEqual(['Nil']);
    expect(namesB).toEqual(['Bee']);
  });

  it('skips a source squad whose games were all filtered out as duplicates', async () => {
    const target = await ownerWithSquad();
    const sourceA = await ownerWithSquad();
    const sourceB = await ownerWithSquad();
    await addMember(target.squad.id, sourceA.user.id, 'MEMBER');
    await addMember(sourceB.squad.id, sourceA.user.id, 'OWNER');

    // The target already holds sourceA's screenshot, so sourceA contributes nothing —
    // but it is still in sourceSquadIds and must not break the per-source loop.
    await seedFullGame(target.squad.id, target.user.id, { imageHash: HASH_A });
    const dupFromA = await seedFullGame(sourceA.squad.id, sourceA.user.id, { imageHash: HASH_A });
    const realFromB = await seedFullGame(sourceB.squad.id, sourceA.user.id, { imageHash: HASH_B });

    const result = await moveGamesToSquad(sourceA.user.id, target.squad.id, [
      dupFromA,
      realFromB,
    ]);

    expect(result.duplicates.map((d) => d.gameId)).toEqual([dupFromA]);
    expect(result.moved).toEqual([realFromB]);
  });
});

describe('moveGamesToSquad — failure handling', () => {
  it('rolls back and releases the client when the recompute fails', async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    await addMember(target.squad.id, source.user.id, 'MEMBER');
    const gameId = await seedFullGame(source.squad.id, source.user.id);

    const realConnect = pgPool.connect.bind(pgPool);
    let released = false;
    jest.spyOn(pgPool, 'connect').mockImplementation(async () => {
      const client = await realConnect();
      const realQuery = client.query.bind(client);
      const realRelease = client.release.bind(client);
      jest.spyOn(client, 'query').mockImplementation(((sql: unknown, params: unknown) => {
        if (typeof sql === 'string' && /DELETE FROM player_totals/.test(sql)) {
          return Promise.reject(new Error('recompute blew up'));
        }
        return realQuery(sql as never, params as never);
      }) as never);
      jest.spyOn(client, 'release').mockImplementation(((...args: unknown[]) => {
        released = true;
        return realRelease(...(args as []));
      }) as never);
      return client;
    });

    await expect(
      moveGamesToSquad(source.user.id, target.squad.id, [gameId]),
    ).rejects.toThrow('recompute blew up');
    jest.restoreAllMocks();

    expect(released).toBe(true);
    // The re-scope happened before the recompute, so only a real rollback undoes it.
    expect(await squadIdOfGame(gameId)).toBe(source.squad.id);
  });

  it('still surfaces the original error when the ROLLBACK also fails', async () => {
    const source = await ownerWithSquad();
    const target = await ownerWithSquad();
    await addMember(target.squad.id, source.user.id, 'MEMBER');
    const gameId = await seedFullGame(source.squad.id, source.user.id);

    // A lost connection fails the write and the rollback alike. The caller must still see
    // the cause; the rollback failure is logged separately rather than swallowed.
    const realConnect = pgPool.connect.bind(pgPool);
    jest.spyOn(pgPool, 'connect').mockImplementation(async () => {
      const client = await realConnect();
      const realQuery = client.query.bind(client);
      jest.spyOn(client, 'query').mockImplementation(((sql: unknown, params: unknown) => {
        if (typeof sql === 'string' && /DELETE FROM player_totals/.test(sql)) {
          return Promise.reject(new Error('recompute blew up'));
        }
        if (typeof sql === 'string' && /^ROLLBACK/.test(sql)) {
          return Promise.reject(new Error('connection already gone'));
        }
        return realQuery(sql as never, params as never);
      }) as never);
      return client;
    });

    await expect(moveGamesToSquad(source.user.id, target.squad.id, [gameId])).rejects.toThrow(
      'recompute blew up',
    );
    jest.restoreAllMocks();
  });
});
