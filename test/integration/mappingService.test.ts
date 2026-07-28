/**
 * Integration tests for mappingService — the gamertag → display-name roster.
 *
 * This module decides which names accrue totals at all (getAllowedNamesForSquad replaced a
 * hardcoded ALLOWED_PLAYER_NAMES list), so a silent mistake here does not throw: it just
 * makes a player's stats quietly stop existing. That is why these run against real SQL
 * rather than a mocked client — most of the behaviour worth checking IS the SQL, including
 * squad scoping, the ORDER BY, and a unique-constraint conflict path that only a real
 * index can trigger.
 */
import { randomUUID } from 'node:crypto';
import { pgPool } from '@/services/supabase';
import {
  getMappingsForSquad,
  getAllowedNamesForSquad,
  getAllowedNamesArray,
  listMappingsForSquad,
  createMapping,
  updateMapping,
  getMappingById,
  deleteMapping,
  applyRetroactiveMapping,
  applyMapping,
} from '@/services/mappingService';
import { makeUser, makeSquad, makeMapping } from './factories';

/** A squad plus its owner — the common setup for every scoping test. */
async function squadFixture() {
  const user = await makeUser();
  const squad = await makeSquad(user.id);
  return { user, squad };
}

async function seedGame(squadId: string, uploadedByUserId: string): Promise<string> {
  const id = randomUUID();
  await pgPool.query(
    `INSERT INTO games (id, date, "homeTeam", "awayTeam", "homeScore", "awayScore",
                        "squadId", "uploadedByUserId", "createdAt", "updatedAt")
     VALUES ($1, NOW(), 'Home', 'Away', 100, 90, $2, $3, NOW(), NOW())`,
    [id, squadId, uploadedByUserId],
  );
  return id;
}

async function seedPlayer(squadId: string, gameId: string, name: string, team = 'Home') {
  await pgPool.query(
    `INSERT INTO players (id, name, team, "gameIdFromFile", "playerId", position,
                          "gameId", "squadId", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, '0001', $3, 'PG', $4, $5, NOW(), NOW())`,
    [name, team, randomUUID(), gameId, squadId],
  );
}

async function seedPlayerStats(squadId: string, playerName: string, team = 'Home') {
  await pgPool.query(
    `INSERT INTO player_stats (id, "playerName", team, "squadId", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, NOW(), NOW())`,
    [playerName, team, squadId],
  );
}

async function playerNames(squadId: string): Promise<string[]> {
  const { rows } = await pgPool.query<{ name: string }>(
    'SELECT name FROM players WHERE "squadId" = $1 ORDER BY name',
    [squadId],
  );
  return rows.map((r) => r.name);
}

async function statsNames(squadId: string): Promise<string[]> {
  const { rows } = await pgPool.query<{ playerName: string }>(
    'SELECT "playerName" FROM player_stats WHERE "squadId" = $1 ORDER BY "playerName"',
    [squadId],
  );
  return rows.map((r) => r.playerName);
}

describe('getMappingsForSquad', () => {
  it('keys the map on a lowercased, trimmed gamertag but leaves the display name verbatim', async () => {
    const { squad } = await squadFixture();
    await makeMapping(squad.id, '  XxAkifxX  ', 'Akif');

    const map = await getMappingsForSquad(squad.id);

    // The key is normalised so applyMapping can match raw OCR output case-insensitively;
    // the value is not, because it is what gets written into players.name.
    expect(map.get('xxakifxx')).toBe('Akif');
    expect(map.has('  XxAkifxX  ')).toBe(false);
  });

  it('returns an empty map for a squad with no roster', async () => {
    const { squad } = await squadFixture();
    expect((await getMappingsForSquad(squad.id)).size).toBe(0);
  });

  it("never returns another squad's mappings", async () => {
    const a = await squadFixture();
    const b = await squadFixture();
    await makeMapping(a.squad.id, 'tag-a', 'Alice');
    await makeMapping(b.squad.id, 'tag-b', 'Bob');

    const map = await getMappingsForSquad(a.squad.id);

    expect(map.get('tag-a')).toBe('Alice');
    expect(map.has('tag-b')).toBe(false);
  });
});

describe('getAllowedNamesForSquad / getAllowedNamesArray', () => {
  it('collapses several gamertags pointing at one person into a single name', async () => {
    const { squad } = await squadFixture();
    await makeMapping(squad.id, 'akif-main', 'Akif');
    await makeMapping(squad.id, 'akif-smurf', 'Akif');

    // SELECT DISTINCT — two gamertags, one tracked person.
    expect(await getAllowedNamesForSquad(squad.id)).toEqual(new Set(['Akif']));
  });

  it('returns an empty set when nothing is mapped, so no player accrues totals', async () => {
    const { squad } = await squadFixture();
    expect((await getAllowedNamesForSquad(squad.id)).size).toBe(0);
  });

  it('exposes the same data as an array', async () => {
    const { squad } = await squadFixture();
    await makeMapping(squad.id, 'tag', 'Akif');
    expect(await getAllowedNamesArray(squad.id)).toEqual(['Akif']);
  });

  it('is squad-scoped', async () => {
    const a = await squadFixture();
    const b = await squadFixture();
    await makeMapping(a.squad.id, 'tag-a', 'Alice');
    await makeMapping(b.squad.id, 'tag-b', 'Bob');

    expect(await getAllowedNamesArray(a.squad.id)).toEqual(['Alice']);
  });
});

describe('listMappingsForSquad', () => {
  it('orders by gamertag ascending', async () => {
    const { squad } = await squadFixture();
    await makeMapping(squad.id, 'zeta', 'Zed');
    await makeMapping(squad.id, 'alpha', 'Al');
    await makeMapping(squad.id, 'mid', 'Em');

    expect((await listMappingsForSquad(squad.id)).map((m) => m.gamertag)).toEqual([
      'alpha',
      'mid',
      'zeta',
    ]);
  });

  it('returns an empty list, not null, for an empty roster', async () => {
    const { squad } = await squadFixture();
    expect(await listMappingsForSquad(squad.id)).toEqual([]);
  });

  it('is squad-scoped', async () => {
    const a = await squadFixture();
    const b = await squadFixture();
    await makeMapping(a.squad.id, 'tag-a', 'Alice');
    await makeMapping(b.squad.id, 'tag-b', 'Bob');

    const rows = await listMappingsForSquad(a.squad.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.gamertag).toBe('tag-a');
  });
});

describe('createMapping', () => {
  it('returns the persisted row', async () => {
    const { squad } = await squadFixture();

    const created = await createMapping(squad.id, 'newtag', 'New Person');

    expect(created).toMatchObject({
      squadId: squad.id,
      gamertag: 'newtag',
      displayName: 'New Person',
    });
    expect(created.id).toEqual(expect.any(String));
  });

  it('stores the gamertag exactly as given, without normalising it', async () => {
    const { squad } = await squadFixture();

    // Normalisation happens on read (getMappingsForSquad), not on write — so the roster
    // page shows the user what they actually typed.
    const created = await createMapping(squad.id, '  MiXeD Case  ', 'Person');
    expect(created.gamertag).toBe('  MiXeD Case  ');
  });

  it('rejects a duplicate gamertag within one squad', async () => {
    const { squad } = await squadFixture();
    await createMapping(squad.id, 'dupe', 'First');

    await expect(createMapping(squad.id, 'dupe', 'Second')).rejects.toThrow();
  });

  it('allows the same gamertag in two different squads', async () => {
    const a = await squadFixture();
    const b = await squadFixture();

    await createMapping(a.squad.id, 'shared-tag', 'In A');
    await expect(createMapping(b.squad.id, 'shared-tag', 'In B')).resolves.toMatchObject({
      displayName: 'In B',
    });
  });
});

describe('updateMapping', () => {
  it('updates both fields and returns the new row', async () => {
    const { squad } = await squadFixture();
    const id = await makeMapping(squad.id, 'old', 'Old Name');

    const updated = await updateMapping(id, squad.id, 'new', 'New Name');

    expect(updated).toMatchObject({ gamertag: 'new', displayName: 'New Name' });
  });

  it('throws a 404-tagged error for an unknown id', async () => {
    const { squad } = await squadFixture();

    await expect(updateMapping(randomUUID(), squad.id, 'x', 'Y')).rejects.toMatchObject({
      message: 'Mapping not found',
      status: 404,
    });
  });

  it("refuses to update another squad's mapping, and leaves it untouched", async () => {
    const a = await squadFixture();
    const b = await squadFixture();
    const idInA = await makeMapping(a.squad.id, 'tag-a', 'Alice');

    // squadId is in the WHERE clause, not just checked beforehand — so this cannot race.
    await expect(updateMapping(idInA, b.squad.id, 'hijacked', 'Mallory')).rejects.toMatchObject({
      status: 404,
    });

    const still = await getMappingById(idInA, a.squad.id);
    expect(still).toMatchObject({ gamertag: 'tag-a', displayName: 'Alice' });
  });
});

describe('getMappingById', () => {
  it('returns the row when the squad matches', async () => {
    const { squad } = await squadFixture();
    const id = await makeMapping(squad.id, 'tag', 'Person');

    expect(await getMappingById(id, squad.id)).toMatchObject({ id, gamertag: 'tag' });
  });

  it('returns null rather than throwing when the id is unknown', async () => {
    const { squad } = await squadFixture();
    expect(await getMappingById(randomUUID(), squad.id)).toBeNull();
  });

  it("returns null for another squad's mapping", async () => {
    const a = await squadFixture();
    const b = await squadFixture();
    const idInA = await makeMapping(a.squad.id, 'tag-a', 'Alice');

    expect(await getMappingById(idInA, b.squad.id)).toBeNull();
  });
});

describe('deleteMapping', () => {
  it('removes the row', async () => {
    const { squad } = await squadFixture();
    const id = await makeMapping(squad.id, 'tag', 'Person');

    await deleteMapping(id, squad.id);

    expect(await getMappingById(id, squad.id)).toBeNull();
  });

  it('throws a 404-tagged error for an unknown id', async () => {
    const { squad } = await squadFixture();

    await expect(deleteMapping(randomUUID(), squad.id)).rejects.toMatchObject({
      message: 'Mapping not found',
      status: 404,
    });
  });

  it("refuses to delete another squad's mapping, and leaves it in place", async () => {
    const a = await squadFixture();
    const b = await squadFixture();
    const idInA = await makeMapping(a.squad.id, 'tag-a', 'Alice');

    await expect(deleteMapping(idInA, b.squad.id)).rejects.toMatchObject({ status: 404 });
    expect(await getMappingById(idInA, a.squad.id)).not.toBeNull();
  });
});

describe('applyRetroactiveMapping', () => {
  it('renames existing per-game rows that still carry the raw gamertag', async () => {
    const { user, squad } = await squadFixture();
    const gameId = await seedGame(squad.id, user.id);
    await seedPlayer(squad.id, gameId, 'xXAkifXx');

    const renamed = await applyRetroactiveMapping(squad.id, 'xXAkifXx', 'Akif');

    expect(renamed).toBe(1);
    expect(await playerNames(squad.id)).toEqual(['Akif']);
  });

  it('matches case-insensitively', async () => {
    const { user, squad } = await squadFixture();
    const gameId = await seedGame(squad.id, user.id);
    await seedPlayer(squad.id, gameId, 'XXAKIFXX');

    expect(await applyRetroactiveMapping(squad.id, 'xxakifxx', 'Akif')).toBe(1);
  });

  it("does not touch another squad's rows", async () => {
    const a = await squadFixture();
    const b = await squadFixture();
    const gameB = await seedGame(b.squad.id, b.user.id);
    await seedPlayer(b.squad.id, gameB, 'sharedtag');

    expect(await applyRetroactiveMapping(a.squad.id, 'sharedtag', 'Renamed')).toBe(0);
    expect(await playerNames(b.squad.id)).toEqual(['sharedtag']);
  });

  it('also renames rows still under a previous display name when one is supplied', async () => {
    const { user, squad } = await squadFixture();
    const gameId = await seedGame(squad.id, user.id);
    await seedPlayer(squad.id, gameId, 'rawtag', 'Home');
    await seedPlayer(squad.id, gameId, 'Old Name', 'Away');

    // Two passes: gamertag → new, and old display name → new.
    const renamed = await applyRetroactiveMapping(squad.id, 'rawtag', 'New Name', 'Old Name');

    expect(renamed).toBe(2);
    expect(await playerNames(squad.id)).toEqual(['New Name', 'New Name']);
  });

  it('skips the second pass when the display name has not actually changed', async () => {
    const { user, squad } = await squadFixture();
    const gameId = await seedGame(squad.id, user.id);
    await seedPlayer(squad.id, gameId, 'rawtag');

    // oldDisplayName differs only by case, so the guard treats it as unchanged.
    const renamed = await applyRetroactiveMapping(squad.id, 'rawtag', 'Akif', 'akif');

    expect(renamed).toBe(1);
  });

  it('returns 0 when the gamertag and display name are the same name', async () => {
    const { user, squad } = await squadFixture();
    const gameId = await seedGame(squad.id, user.id);
    await seedPlayer(squad.id, gameId, 'Akif');

    // renameInDb short-circuits before touching the database at all.
    expect(await applyRetroactiveMapping(squad.id, 'Akif', 'akif')).toBe(0);
  });

  it('renames the aggregated player_stats row alongside the per-game rows', async () => {
    const { user, squad } = await squadFixture();
    const gameId = await seedGame(squad.id, user.id);
    await seedPlayer(squad.id, gameId, 'rawtag');
    await seedPlayerStats(squad.id, 'rawtag');

    await applyRetroactiveMapping(squad.id, 'rawtag', 'Akif');

    expect(await statsNames(squad.id)).toEqual(['Akif']);
  });

  it('still renames player_stats when no per-game row matched', async () => {
    const { squad } = await squadFixture();
    await seedPlayerStats(squad.id, 'rawtag');

    // The aggregate can carry a name the per-game rows no longer do. Returning early on a
    // zero player rowCount used to strand it under the gamertag forever, even though a
    // mapping for that gamertag now exists. The count is still 0 — no PLAYER rows moved —
    // but the aggregate is reconciled.
    expect(await applyRetroactiveMapping(squad.id, 'rawtag', 'Akif')).toBe(0);
    expect(await statsNames(squad.id)).toEqual(['Akif']);
  });

  it('propagates a transient stats failure and rolls the whole rename back', async () => {
    const { user, squad } = await squadFixture();
    const gameId = await seedGame(squad.id, user.id);
    await seedPlayer(squad.id, gameId, 'rawtag');
    await seedPlayerStats(squad.id, 'rawtag');
    // No conflicting 'Akif' row exists — there is nothing here to reconcile.

    // Hand back a real pooled client whose stats UPDATE fails, so BEGIN, the players
    // UPDATE and ROLLBACK all genuinely execute against Postgres. Both spies are undone
    // by restoreAllMocks, which matters: the client returns to the pool on release.
    const realConnect = pgPool.connect.bind(pgPool);
    jest.spyOn(pgPool, 'connect').mockImplementation(async () => {
      const client = await realConnect();
      const realQuery = client.query.bind(client);
      jest.spyOn(client, 'query').mockImplementation(((sql: unknown, params: unknown) => {
        if (typeof sql === 'string' && /UPDATE player_stats/.test(sql)) {
          return Promise.reject(new Error('connection terminated unexpectedly'));
        }
        return realQuery(sql as never, params as never);
      }) as never);
      return client;
    });

    await expect(applyRetroactiveMapping(squad.id, 'rawtag', 'Akif')).rejects.toThrow(
      'connection terminated unexpectedly',
    );
    jest.restoreAllMocks();

    // The aggregate must survive: a retryable error is not a reason to destroy stats.
    expect(await statsNames(squad.id)).toEqual(['rawtag']);
    // And the per-game rename must be undone, so players and stats stay in agreement
    // rather than half-renamed.
    expect(await playerNames(squad.id)).toEqual(['rawtag']);
  });

  it('drops the stale stats row when the target name already has one', async () => {
    const { user, squad } = await squadFixture();
    const gameId = await seedGame(squad.id, user.id);
    await seedPlayer(squad.id, gameId, 'rawtag');
    await seedPlayerStats(squad.id, 'rawtag');
    await seedPlayerStats(squad.id, 'Akif', 'Away');

    // The UPDATE violates player_stats_player_name_squadid_unique, so the catch deletes the
    // gamertag row instead: the display-name row was built from uploads that already had
    // the mapping active and is the more current of the two.
    await applyRetroactiveMapping(squad.id, 'rawtag', 'Akif');

    expect(await statsNames(squad.id)).toEqual(['Akif']);
  });
});

describe('a null rowCount is treated as "nothing happened"', () => {
  /**
   * node-postgres reports a number for rowCount on UPDATE and DELETE, so these `?? 0`
   * guards cannot fire against a real driver — reaching them needs a stub. Covered rather
   * than deleted because the fallback is what stops an unexpected null from being read as
   * a successful write.
   */
  afterEach(() => jest.restoreAllMocks());

  it('applyRetroactiveMapping reports 0 renames rather than throwing', async () => {
    // Must stub the checked-out client, not pgPool.query: the rename runs inside a
    // transaction, so pool-level queries are never involved. Stubbing the wrong one made
    // this test pass for the wrong reason — it took the ordinary "nothing matched" path
    // and never reached the `?? 0` guard at all.
    const client = {
      query: jest.fn().mockResolvedValue({ rowCount: null, rows: [] }),
      release: jest.fn(),
    };
    jest.spyOn(pgPool, 'connect').mockResolvedValue(client as never);

    expect(await applyRetroactiveMapping(randomUUID(), 'from', 'to')).toBe(0);
    expect(client.release).toHaveBeenCalled();
  });

  it('still surfaces the original error when the ROLLBACK also fails', async () => {
    // A lost connection fails the write and then fails the rollback too. The caller must
    // see the cause, not the rollback's own error, or the real failure is masked.
    const client = {
      query: jest.fn().mockImplementation((sql: string) => {
        if (/^BEGIN/.test(sql)) return Promise.resolve({ rowCount: 0, rows: [] });
        if (/^ROLLBACK/.test(sql)) return Promise.reject(new Error('connection already gone'));
        return Promise.reject(new Error('original failure'));
      }),
      release: jest.fn(),
    };
    jest.spyOn(pgPool, 'connect').mockResolvedValue(client as never);

    await expect(applyRetroactiveMapping(randomUUID(), 'from', 'to')).rejects.toThrow(
      'original failure',
    );
    // The client goes back to the pool either way.
    expect(client.release).toHaveBeenCalled();
  });

  it('deleteMapping treats it as not-found rather than as a successful delete', async () => {
    jest
      .spyOn(pgPool, 'query')
      .mockResolvedValueOnce({ rowCount: null, rows: [] } as never);

    await expect(deleteMapping(randomUUID(), randomUUID())).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('applyMapping (pure)', () => {
  const mappings = new Map([
    ['xxakifxx', 'Akif'],
    ['nillan99', 'Nillan'],
  ]);

  it('resolves an exact gamertag regardless of case or surrounding space', () => {
    expect(applyMapping('  XxAkifXx  ', mappings)).toBe('Akif');
  });

  it('resolves when the raw name contains the mapped gamertag', () => {
    expect(applyMapping('xxakifxx_ps5', mappings)).toBe('Akif');
  });

  it('resolves when the mapped gamertag contains the raw name', () => {
    // Deliberately bidirectional: OCR truncates long gamertags.
    expect(applyMapping('nillan', mappings)).toBe('Nillan');
  });

  it('returns the original name when nothing matches', () => {
    expect(applyMapping('SomeoneElse', mappings)).toBe('SomeoneElse');
  });

  it('returns an empty string unchanged without scanning the map', () => {
    expect(applyMapping('', mappings)).toBe('');
  });

  it('returns the raw name unchanged when the roster is empty', () => {
    expect(applyMapping('Akif', new Map())).toBe('Akif');
  });

  it('takes the longest matching gamertag, not the first one in the map', () => {
    const overlapping = new Map([
      ['akif', 'Short'],
      ['akifrahman', 'Long'],
    ]);
    // "akifrahman99" contains both keys; the longer one is the better evidence.
    expect(applyMapping('akifrahman99', overlapping)).toBe('Long');
  });

  it('gives the same answer regardless of roster insertion order', () => {
    const forward = new Map([
      ['akif', 'Short'],
      ['akifrahman', 'Long'],
    ]);
    const reversed = new Map([
      ['akifrahman', 'Long'],
      ['akif', 'Short'],
    ]);
    // Order-dependence here meant two squads with identical rosters entered in a different
    // order could resolve the same gamertag to different people.
    expect(applyMapping('akifrahman99', forward)).toBe(
      applyMapping('akifrahman99', reversed),
    );
  });

  it('will not let a very short gamertag swallow longer names by substring', () => {
    // "ak" matching "akira", "akash" and "akif" is how two real people silently merge.
    const tiny = new Map([['ak', 'Ay Kay']]);
    expect(applyMapping('akira', tiny)).toBe('akira');
  });

  it('still resolves a very short gamertag on an exact match', () => {
    const tiny = new Map([['ak', 'Ay Kay']]);
    expect(applyMapping('AK', tiny)).toBe('Ay Kay');
  });

  it('leaves a very short OCR result alone when nothing matches it exactly', () => {
    // The symmetric guard: a two-character read is too little to go substring-hunting with.
    expect(applyMapping('zz', new Map([['akifrahman', 'Akif']]))).toBe('zz');
  });

  it('still handles a truncated gamertag once it is long enough to trust', () => {
    const mappings = new Map([['nillan99', 'Nillan']]);
    expect(applyMapping('nillan', mappings)).toBe('Nillan');
  });
});
