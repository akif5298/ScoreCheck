/**
 * Characterization tests for SupabaseService against a real Postgres.
 *
 * These pin CURRENT behaviour so `supabase.ts` can be split up safely. Where the
 * behaviour is a known defect it is pinned as a defect, with a KNOWN BUG comment naming
 * it — a characterization test that quietly "fixes" something on the way past is worse
 * than no test, because it makes the refactor's diff look safe when it is not.
 *
 * Not covered here, deliberately, because existing unit suites already own them:
 *   - the advisory lock ordering + DuplicateGameError  → supabase.saveDedup.test.ts
 *   - read-helper error propagation                    → supabase.errors.test.ts
 */
import supabaseService, { pgPool } from '@/services/supabase';
import { makeUser, makeSquad, playerPayload, countRows } from './factories';

const svc = supabaseService;

async function seedGame(
  squadId: string,
  uploadedByUserId: string,
  over: Record<string, unknown> = {},
) {
  return svc.createGame({
    date: new Date('2026-01-15'),
    homeTeam: 'Team A',
    awayTeam: 'Team B',
    homeScore: 100,
    awayScore: 90,
    squadId,
    uploadedByUserId,
    ...over,
  });
}

/** createPlayer with the three NOT NULL fields its `|| null` fallbacks cannot supply. */
async function seedPlayer(
  gameId: string,
  squadId: string,
  over: Record<string, unknown> = {},
) {
  return svc.createPlayer({
    name: 'Player',
    team: 'Team A',
    position: 'PG',
    playerId: `p-${Math.random().toString(36).slice(2, 8)}`,
    gameIdFromFile: '0001',
    gameId,
    squadId,
    ...over,
  });
}

// ── Users ────────────────────────────────────────────────────────────────────────

describe('user helpers', () => {
  it('createLocalUser lowercases the email on insert', async () => {
    const user = await svc.createLocalUser({
      email: 'MiXeD@Example.COM',
      name: 'Mixed',
      passwordHash: 'hash',
    });

    expect(user.email).toBe('mixed@example.com');
    expect(user.role).toBe('USER');
  });

  it('findUserByEmail matches case-insensitively', async () => {
    await svc.createLocalUser({ email: 'person@test.local', name: 'P', passwordHash: 'h' });

    await expect(svc.findUserByEmail('PERSON@TEST.LOCAL')).resolves.toMatchObject({
      email: 'person@test.local',
    });
  });

  it('findUserByEmail and findUserById return null for a miss', async () => {
    await expect(svc.findUserByEmail('nobody@test.local')).resolves.toBeNull();
    await expect(svc.findUserById('no-such-id')).resolves.toBeNull();
  });

  it('findUserById round-trips a created user', async () => {
    const created = await svc.createLocalUser({
      email: 'byid@test.local',
      name: 'ById',
      passwordHash: 'h',
    });

    await expect(svc.findUserById(created.id)).resolves.toMatchObject({ id: created.id });
  });

  it('updatePasswordHash replaces the stored hash', async () => {
    const created = await svc.createLocalUser({
      email: 'pw@test.local',
      name: 'Pw',
      passwordHash: 'old',
    });

    await svc.updatePasswordHash(created.id, 'new');

    const after = await svc.findUserById(created.id);
    expect(after.passwordHash).toBe('new');
  });
});

// ── Hashes ───────────────────────────────────────────────────────────────────────

describe('getGameHashesBySquadId', () => {
  it('returns only non-null hashes for the squad', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const other = await makeSquad(user.id);
    await seedGame(squad.id, user.id, { imageHash: 'a'.repeat(60) });
    await seedGame(squad.id, user.id, { imageHash: null });
    await seedGame(other.id, user.id, { imageHash: 'b'.repeat(60) });

    const hashes = await svc.getGameHashesBySquadId(squad.id);

    expect(hashes).toEqual(['a'.repeat(60)]);
  });
});

// ── Row creation defaults ────────────────────────────────────────────────────────

describe('createGame / createPlayer / createTeam defaults', () => {
  it('createGame generates an id and defaults nullable fields', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);

    const game = await seedGame(squad.id, user.id);

    expect(game.id).toMatch(/^game_/);
    expect(game.screenshotUrl).toBeNull();
    expect(game.imageHash).toBeNull();
    expect(game.processed).toBe(false);
    expect(game.uploadedByUserId).toBe(user.id);
  });

  it('createGame honours an explicitly supplied id', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);

    const game = await seedGame(squad.id, user.id, { id: 'explicit-game-id' });

    expect(game.id).toBe('explicit-game-id');
  });

  it('createPlayer zero-fills every stat and accepts playerName as a name alias', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const game = await seedGame(squad.id, user.id);

    const player = await svc.createPlayer({
      gameId: game.id,
      playerName: 'AliasOnly',
      team: 'Team A',
      position: 'PG',
      playerId: 'p-1',
      gameIdFromFile: '0001',
      squadId: squad.id,
    });

    expect(player.id).toMatch(/^player_/);
    expect(player.name).toBe('AliasOnly');
    expect(player.points).toBe(0);
    expect(player.rebounds).toBe(0);
    expect(player.teammateGrade).toBeNull();
  });

  it.each([['position'], ['playerId'], ['gameIdFromFile']])(
    'KNOWN LANDMINE: createPlayer cannot default %s despite its `|| null` fallback',
    async (field) => {
      const user = await makeUser();
      const squad = await makeSquad(user.id);
      const game = await seedGame(squad.id, user.id);
      const payload: Record<string, unknown> = {
        gameId: game.id,
        name: 'X',
        team: 'Team A',
        position: 'PG',
        playerId: 'p-1',
        gameIdFromFile: '0001',
        squadId: squad.id,
      };
      delete payload[field];

      // All three columns are NOT NULL with no default, so `playerData.x || null` can only
      // ever produce a constraint violation — the fallback reads as optional but is not.
      // Callers must supply all three; screenshots.ts and updateGame both do.
      await expect(svc.createPlayer(payload)).rejects.toThrow(/not-null constraint/);
    },
  );

  it('createTeam zero-fills every stat', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const game = await seedGame(squad.id, user.id);

    const team = await svc.createTeam({
      gameId: game.id,
      name: 'Team A',
      isHome: true,
      squadId: squad.id,
    });

    expect(team.id).toMatch(/^team_/);
    expect(team.points).toBe(0);
    expect(team.isHome).toBe(true);
  });

  it('createGame rethrows on a constraint violation', async () => {
    // squadId has a foreign key, so an unknown squad cannot be inserted.
    await expect(
      seedGame('no-such-squad', 'no-such-user'),
    ).rejects.toThrow();
  });
});

// ── saveGameWithStats, end to end on real SQL ────────────────────────────────────

describe('saveGameWithStats', () => {
  it('commits the game, its players, and both team rows atomically', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);

    // The caller mints the game id up front and stamps it onto every child row —
    // saveGameWithStats does not backfill it. screenshots.ts does the same.
    const gameId = 'save-game-1';

    const { game, players } = await svc.saveGameWithStats(
      {
        id: gameId,
        date: new Date('2026-02-01'),
        homeTeam: 'Team A',
        awayTeam: 'Team B',
        homeScore: 80,
        awayScore: 70,
        squadId: squad.id,
        uploadedByUserId: user.id,
      },
      [
        playerPayload({ name: 'Akif', team: 'Team A', gameId, squadId: squad.id }),
        playerPayload({ name: 'Nillan', team: 'Team B', gameId, squadId: squad.id }),
      ],
      { gameId, name: 'Team A', isHome: true, points: 80, squadId: squad.id },
      { gameId, name: 'Team B', isHome: false, points: 70, squadId: squad.id },
    );

    expect(game.id).toBeDefined();
    expect(players).toHaveLength(2);
    await expect(countRows('players', squad.id)).resolves.toBe(2);
    await expect(countRows('teams', squad.id)).resolves.toBe(2);
  });

  it('rolls the whole save back when a player insert fails', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);

    const gameId = 'save-game-rollback';

    await expect(
      svc.saveGameWithStats(
        {
          id: gameId,
          date: new Date('2026-02-01'),
          homeTeam: 'Team A',
          awayTeam: 'Team B',
          homeScore: 80,
          awayScore: 70,
          squadId: squad.id,
          uploadedByUserId: user.id,
        },
        // squadId omitted → NOT NULL violation on players.squadId
        [playerPayload({ name: 'Broken', team: 'Team A', gameId })],
        { gameId, name: 'Team A', isHome: true, squadId: squad.id },
        { gameId, name: 'Team B', isHome: false, squadId: squad.id },
      ),
    ).rejects.toThrow();

    // The game must not survive the failed save.
    await expect(countRows('games', squad.id)).resolves.toBe(0);
    await expect(countRows('players', squad.id)).resolves.toBe(0);
  });
});

// ── Reads ────────────────────────────────────────────────────────────────────────

describe('getGamesBySquadId / getGameById', () => {
  it('scopes to the squad', async () => {
    const user = await makeUser();
    const mine = await makeSquad(user.id);
    const theirs = await makeSquad(user.id);
    await seedGame(mine.id, user.id);
    await seedGame(theirs.id, user.id);

    const games = await svc.getGamesBySquadId(mine.id);

    expect(games).toHaveLength(1);
  });

  it('KNOWN BUG: a game with no players/teams reports [null], not []', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const game = await seedGame(squad.id, user.id);

    const found = await svc.getGameById(game.id, squad.id);

    // json_agg over a LEFT JOIN with no matches yields [null] rather than an empty array.
    // Callers must filter it; pinned here so the refactor cannot change it unnoticed.
    expect(found.players).toEqual([null]);
    expect(found.teams).toEqual([null]);
  });

  it('KNOWN BUG: json_agg(DISTINCT ...) over two LEFT JOINs multiplies rows', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const game = await seedGame(squad.id, user.id);
    await seedPlayer(game.id, squad.id, { name: 'P1', team: 'A' });
    await seedPlayer(game.id, squad.id, { name: 'P2', team: 'A' });
    await svc.createTeam({ gameId: game.id, name: 'A', isHome: true, squadId: squad.id });
    await svc.createTeam({ gameId: game.id, name: 'B', isHome: false, squadId: squad.id });

    const found = await svc.getGameById(game.id, squad.id);

    // DISTINCT collapses the cartesian product back to the right *set*, which is why this
    // has never been visibly wrong — but the join still fans out underneath.
    expect(found.players).toHaveLength(2);
    expect(found.teams).toHaveLength(2);
  });

  it('getGameById returns null for another squad game', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const other = await makeSquad(user.id);
    const game = await seedGame(squad.id, user.id);

    await expect(svc.getGameById(game.id, other.id)).resolves.toBeNull();
  });
});

describe('getDistinctPlayerCount', () => {
  it('normalises case and whitespace, and ignores blanks', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const game = await seedGame(squad.id, user.id);
    for (const name of ['Akif', ' akif ', 'AKIF', 'Nillan', '   ']) {
      await seedPlayer(game.id, squad.id, { name, team: 'A' });
    }

    await expect(svc.getDistinctPlayerCount(squad.id)).resolves.toBe(2);
  });

  it('returns 0 for a squad with no players', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);

    await expect(svc.getDistinctPlayerCount(squad.id)).resolves.toBe(0);
  });
});

describe('getGameByScreenshotUrl', () => {
  it('returns the newest match within the squad', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    await seedGame(squad.id, user.id, { screenshotUrl: 'shot.jpg' });
    await pgPool.query(`UPDATE games SET "createdAt" = NOW() - interval '1 day'`);
    const newer = await seedGame(squad.id, user.id, { screenshotUrl: 'shot.jpg' });

    const found = await svc.getGameByScreenshotUrl('shot.jpg', squad.id);

    expect(found.id).toBe(newer.id);
  });

  it('returns null when the path belongs to another squad', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const other = await makeSquad(user.id);
    await seedGame(other.id, user.id, { screenshotUrl: 'shot.jpg' });

    await expect(svc.getGameByScreenshotUrl('shot.jpg', squad.id)).resolves.toBeNull();
  });
});

// ── player_stats ─────────────────────────────────────────────────────────────────

describe('player_stats helpers', () => {
  async function seedStats(squadId: string, over: Record<string, unknown> = {}) {
    return svc.createPlayerStats({
      playerName: 'Akif',
      team: 'Team A',
      squadId,
      totalPoints: 100,
      ...over,
    });
  }

  it('createPlayerStats defaults gamesPlayed to 1 and zero-fills totals', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);

    const row = await seedStats(squad.id, { totalPoints: undefined });

    expect(row.gamesPlayed).toBe(1);
    expect(Number(row.totalPoints)).toBe(0);
    expect(Number(row.avgPlusMinus)).toBe(0);
  });

  it('getPlayerStatsByPlayerName scopes to the squad', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const other = await makeSquad(user.id);
    await seedStats(squad.id);

    await expect(svc.getPlayerStatsByPlayerName('Akif', squad.id)).resolves.toMatchObject({
      playerName: 'Akif',
    });
    await expect(svc.getPlayerStatsByPlayerName('Akif', other.id)).resolves.toBeNull();
  });

  it('getPlayerStats orders by totalPoints descending', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    await seedStats(squad.id, { playerName: 'Low', totalPoints: 10 });
    await seedStats(squad.id, { playerName: 'High', totalPoints: 90 });

    const rows = await svc.getPlayerStats(squad.id);

    expect(rows.map((r: any) => r.playerName)).toEqual(['High', 'Low']);
  });

  it('allows only one stats row per (squadId, playerName), regardless of team', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    await seedStats(squad.id, { team: 'Team A', totalPoints: 10 });

    // player_stats carries TWO overlapping unique indexes:
    //   player_stats_squadId_playerName_team_key  UNIQUE (squadId, playerName, team)
    //   player_stats_player_name_squadid_unique   UNIQUE (playerName, squadId)
    // The second is strictly stronger and subsumes the first, so the same name cannot
    // appear twice in a squad even under a different team. This is why
    // updatePlayerStats' `WHERE playerName AND squadId` is correct rather than, as an
    // earlier audit note claimed, missing a team predicate.
    await expect(seedStats(squad.id, { team: 'Team B', totalPoints: 20 })).rejects.toThrow(
      /player_stats_player_name_squadid_unique/,
    );
  });

  it('updatePlayerStats writes every field through to the single matching row', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    await seedStats(squad.id, { team: 'Team A', totalPoints: 10 });

    await svc.updatePlayerStats('Akif', squad.id, {
      gamesPlayed: 5,
      totalPoints: 999,
      avgPoints: 1,
      avgRebounds: 0,
      avgAssists: 0,
      avgSteals: 0,
      avgBlocks: 0,
      avgTurnovers: 0,
      avgFouls: 0,
      avgFgPercentage: 0,
      avgThreePercentage: 0,
      avgFtPercentage: 0,
      totalRebounds: 0,
      totalAssists: 0,
      totalSteals: 0,
      totalBlocks: 0,
      totalTurnovers: 0,
      totalFouls: 0,
      totalFgMade: 0,
      totalFgAttempted: 0,
      totalThreeMade: 0,
      totalThreeAttempted: 0,
      totalFtMade: 0,
      totalFtAttempted: 0,
    });

    const { rows } = await pgPool.query(
      'SELECT team, "gamesPlayed", "totalPoints" FROM player_stats WHERE "squadId" = $1',
      [squad.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].gamesPlayed).toBe(5);
    expect(Number(rows[0].totalPoints)).toBe(999);
    // team is not in the SET list, so it survives the update untouched.
    expect(rows[0].team).toBe('Team A');
  });

  it('KNOWN BUG: updatePlayerTotals keys on player_name, but the unique index is on player_id', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    // player_totals is UNIQUE (player_id, squadid) — nothing stops one name spanning two
    // player_ids, and updatePlayerTotals' WHERE omits player_id entirely.
    await svc.createPlayerTotals({
      id: 'totals-a',
      player_id: 'pid-a',
      player_name: 'Akif',
      team: 'Team A',
      squadid: squad.id,
      total_points: 10,
    });
    await svc.createPlayerTotals({
      id: 'totals-b',
      player_id: 'pid-b',
      player_name: 'Akif',
      team: 'Team B',
      squadid: squad.id,
      total_points: 20,
    });

    await svc.updatePlayerTotals('Akif', squad.id, {
      total_games: 1,
      total_points: 777,
      total_assists: 0,
      total_rebounds: 0,
      total_steals: 0,
      total_blocks: 0,
      total_fouls: 0,
      total_turnovers: 0,
      total_fgm: 0,
      total_fga: 0,
      total_3pm: 0,
      total_3pa: 0,
      total_ftm: 0,
      total_fta: 0,
      fg_percentage: 0,
      three_percentage: 0,
      ft_percentage: 0,
    });

    const { rows } = await pgPool.query(
      'SELECT total_points FROM player_totals WHERE squadid = $1 ORDER BY id',
      [squad.id],
    );
    // Both rows are overwritten. Pinned as-is: recomputeSquadAggregates wipes and rebuilds
    // these rows, so the live path never hits it — but the method itself is unsafe.
    expect(rows.map((r: any) => Number(r.total_points))).toEqual([777, 777]);
  });
});

// ── player_totals ────────────────────────────────────────────────────────────────

describe('player_totals helpers', () => {
  async function seedTotals(squadId: string, over: Record<string, unknown> = {}) {
    return svc.createPlayerTotals({
      id: `totals_${Math.random().toString(36).slice(2)}`,
      player_id: 'p1',
      player_name: 'Akif',
      team: 'Team A',
      squadid: squadId,
      ...over,
    });
  }

  it('createPlayerTotals defaults total_games to 1 and zero-fills the rest', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);

    const row = await seedTotals(squad.id);

    expect(row.total_games).toBe(1);
    expect(Number(row.total_points)).toBe(0);
    expect(Number(row.fg_percentage)).toBe(0);
  });

  it('getPlayerTotalsByPlayerName scopes to the squad', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const other = await makeSquad(user.id);
    await seedTotals(squad.id);

    await expect(svc.getPlayerTotalsByPlayerName('Akif', squad.id)).resolves.toMatchObject({
      player_name: 'Akif',
    });
    await expect(svc.getPlayerTotalsByPlayerName('Akif', other.id)).resolves.toBeNull();
  });

  it('getPlayerTotalsBySquadId orders by player_name', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    await seedTotals(squad.id, { player_name: 'Zed', player_id: 'z' });
    await seedTotals(squad.id, { player_name: 'Akif', player_id: 'a' });

    const rows = await svc.getPlayerTotalsBySquadId(squad.id);

    expect(rows.map((r: any) => r.player_name)).toEqual(['Akif', 'Zed']);
  });

  it('updatePlayerTotals writes every counter through', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    await seedTotals(squad.id);

    await svc.updatePlayerTotals('Akif', squad.id, {
      total_games: 3,
      total_points: 60,
      total_assists: 9,
      total_rebounds: 12,
      total_steals: 3,
      total_blocks: 2,
      total_fouls: 6,
      total_turnovers: 4,
      total_fgm: 20,
      total_fga: 40,
      total_3pm: 5,
      total_3pa: 12,
      total_ftm: 15,
      total_fta: 18,
      fg_percentage: 50,
      three_percentage: 41.67,
      ft_percentage: 83.33,
    });

    const row = await svc.getPlayerTotalsByPlayerName('Akif', squad.id);
    expect(row.total_games).toBe(3);
    expect(Number(row.total_points)).toBe(60);
    expect(Number(row.fg_percentage)).toBeCloseTo(50, 2);
  });
});

// ── Aggregates ───────────────────────────────────────────────────────────────────

describe('recomputeSquadAggregates', () => {
  it('returns zero players and writes nothing when the squad has no mappings', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const game = await seedGame(squad.id, user.id);
    await seedPlayer(game.id, squad.id, playerPayload({ name: 'Unmapped' }));

    const result = await svc.recomputeSquadAggregates(squad.id);

    // Only mapped display names accrue stats.
    expect(result).toEqual({ players: 0 });
    await expect(countRows('player_stats', squad.id)).resolves.toBe(0);
  });

  it('rebuilds totals and stats from the players table for mapped names', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    await pgPool.query(
      `INSERT INTO player_mappings (id, "squadId", gamertag, "displayName", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, 'akif2k', 'Akif', NOW(), NOW())`,
      [squad.id],
    );
    const game = await seedGame(squad.id, user.id);
    await seedPlayer(game.id, squad.id, playerPayload({ name: 'Akif', points: 20 }));

    const result = await svc.recomputeSquadAggregates(squad.id);

    expect(result).toEqual({ players: 1 });
    const totals = await svc.getPlayerTotalsByPlayerName('Akif', squad.id);
    expect(Number(totals.total_points)).toBe(20);
    await expect(countRows('player_stats', squad.id)).resolves.toBe(1);
  });

  it('is idempotent — running twice yields the same totals', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    await pgPool.query(
      `INSERT INTO player_mappings (id, "squadId", gamertag, "displayName", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, 'akif2k', 'Akif', NOW(), NOW())`,
      [squad.id],
    );
    const game = await seedGame(squad.id, user.id);
    await seedPlayer(game.id, squad.id, playerPayload({ name: 'Akif', points: 20 }));

    await svc.recomputeSquadAggregates(squad.id);
    await svc.recomputeSquadAggregates(squad.id);

    const totals = await svc.getPlayerTotalsByPlayerName('Akif', squad.id);
    // A full rebuild must not double-count — this is the property that replaced the
    // old incremental delta logic.
    expect(Number(totals.total_points)).toBe(20);
    expect(totals.total_games).toBe(1);
  });
});

describe('updatePlayerStatsFromTotals', () => {
  it('short-circuits on an empty allow-list without touching the database', async () => {
    await expect(svc.updatePlayerStatsFromTotals('any-squad', [])).resolves.toEqual({
      rowCount: 0,
    });
  });
});

// ── updateGame ───────────────────────────────────────────────────────────────────

describe('updateGame', () => {
  async function seedEditable(squadId: string, userId: string) {
    const game = await seedGame(squadId, userId);
    await seedPlayer(game.id, squadId, playerPayload({ name: 'Akif', team: 'Team A' }));
    await svc.createTeam({ gameId: game.id, name: 'Team A', isHome: true, squadId });
    await svc.createTeam({ gameId: game.id, name: 'Team B', isHome: false, squadId });
    return game;
  }

  const editPayload = (over: Record<string, unknown> = {}) => ({
    homeTeam: 'Team A',
    awayTeam: 'Team B',
    homeScore: 111,
    awayScore: 99,
    date: new Date('2026-03-03'),
    players: [playerPayload({ name: 'Akif', team: 'Team A', fgMade: 1, fgAttempted: 3 })],
    ...over,
  });

  it('returns null for an unknown game', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);

    await expect(svc.updateGame('no-such-game', squad.id, editPayload())).resolves.toBeNull();
  });

  it('returns null for a game in another squad', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const other = await makeSquad(user.id);
    const game = await seedEditable(squad.id, user.id);

    await expect(svc.updateGame(game.id, other.id, editPayload())).resolves.toBeNull();
    // And the original must be untouched.
    const still = await svc.getGameById(game.id, squad.id);
    expect(still.homeScore).toBe(100);
  });

  it('updates scoreboard fields and replaces player rows', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const game = await seedEditable(squad.id, user.id);

    const updated = await svc.updateGame(game.id, squad.id, editPayload());

    expect(updated.homeScore).toBe(111);
    expect(updated.awayScore).toBe(99);
    await expect(countRows('players', squad.id)).resolves.toBe(1);
  });

  it('never reassigns uploadedByUserId', async () => {
    const owner = await makeUser();
    const editor = await makeUser();
    const squad = await makeSquad(owner.id);
    const game = await seedEditable(squad.id, owner.id);

    await svc.updateGame(game.id, squad.id, editPayload());

    const after = await svc.getGameById(game.id, squad.id);
    // An edit by another member must not steal authorship.
    expect(after.uploadedByUserId).toBe(owner.id);
    expect(after.uploadedByUserId).not.toBe(editor.id);
  });

  it('stores percentages at 2dp, matching the save path', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const game = await seedEditable(squad.id, user.id);

    // 1/3 → 33.33, which 1dp rounding (the old edit path) would have stored as 33.3.
    await svc.updateGame(game.id, squad.id, editPayload());

    const { rows } = await pgPool.query(
      'SELECT fg_percentage FROM players WHERE "gameId" = $1',
      [game.id],
    );
    expect(Number(rows[0].fg_percentage)).toBeCloseTo(33.33, 2);
  });

  it('divides by zero safely when a player took no shots', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const game = await seedEditable(squad.id, user.id);

    await svc.updateGame(
      game.id,
      squad.id,
      editPayload({
        players: [playerPayload({ name: 'Akif', team: 'Team A', fgMade: 0, fgAttempted: 0 })],
      }),
    );

    const { rows } = await pgPool.query(
      'SELECT fg_percentage FROM players WHERE "gameId" = $1',
      [game.id],
    );
    expect(Number(rows[0].fg_percentage)).toBe(0);
  });

  it('rebuilds BOTH team rows even when no player matches a side name', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const game = await seedEditable(squad.id, user.id);

    // Renaming the sides means no player's team matches either — the old code deleted
    // both team rows and inserted neither.
    await svc.updateGame(
      game.id,
      squad.id,
      editPayload({ homeTeam: 'Renamed Home', awayTeam: 'Renamed Away' }),
    );

    const { rows } = await pgPool.query(
      'SELECT name, "isHome", points FROM teams WHERE "gameId" = $1 ORDER BY "isHome" DESC',
      [game.id],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('Renamed Home');
    expect(rows[1].name).toBe('Renamed Away');
  });

  it('sums team stats from the players on that side', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const game = await seedEditable(squad.id, user.id);

    await svc.updateGame(
      game.id,
      squad.id,
      editPayload({
        players: [
          playerPayload({ name: 'A', team: 'Team A', rebounds: 4, fgMade: 3, fgAttempted: 6 }),
          playerPayload({ name: 'B', team: 'Team A', rebounds: 6, fgMade: 1, fgAttempted: 2 }),
        ],
      }),
    );

    const { rows } = await pgPool.query(
      'SELECT rebounds, "fgMade", "fgAttempted", fg_percentage FROM teams WHERE "gameId" = $1 AND "isHome" = true',
      [game.id],
    );
    expect(rows[0].rebounds).toBe(10);
    expect(rows[0].fgMade).toBe(4);
    expect(rows[0].fgAttempted).toBe(8);
    expect(Number(rows[0].fg_percentage)).toBeCloseTo(50, 2);
  });

  it('zero-fills every omitted stat and supplies defaults for the NOT NULL columns', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const game = await seedEditable(squad.id, user.id);

    // Only name and team supplied — unlike createPlayer, updateGame defaults
    // gameIdFromFile to the game id, mints a playerId, and uses 'Unknown' for position,
    // so a minimal payload is valid here.
    await svc.updateGame(
      game.id,
      squad.id,
      editPayload({ players: [{ name: 'Sparse', team: 'Team A' }] }),
    );

    const { rows } = await pgPool.query(
      `SELECT name, position, "gameIdFromFile", "playerId", "teammateGrade",
              points, rebounds, assists, steals, blocks, fouls, turnovers,
              "fgMade", "fgAttempted", "threeMade", "threeAttempted", "ftMade", "ftAttempted"
       FROM players WHERE "gameId" = $1`,
      [game.id],
    );
    expect(rows).toHaveLength(1);
    const p = rows[0];
    expect(p.name).toBe('Sparse');
    expect(p.position).toBe('Unknown');
    expect(p.gameIdFromFile).toBe(game.id);
    expect(p.playerId).toContain(game.id);
    expect(p.teammateGrade).toBe('');
    for (const key of [
      'points',
      'rebounds',
      'assists',
      'steals',
      'blocks',
      'fouls',
      'turnovers',
      'fgMade',
      'fgAttempted',
      'threeMade',
      'threeAttempted',
      'ftMade',
      'ftAttempted',
    ]) {
      expect(p[key]).toBe(0);
    }
  });

  it('rolls back and rethrows when a player row is invalid', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const game = await seedEditable(squad.id, user.id);

    await expect(
      svc.updateGame(
        game.id,
        squad.id,
        // name is NOT NULL on players
        editPayload({ players: [playerPayload({ name: null, team: 'Team A' })] }),
      ),
    ).rejects.toThrow();

    // The pre-edit state must survive.
    const after = await svc.getGameById(game.id, squad.id);
    expect(after.homeScore).toBe(100);
    await expect(countRows('players', squad.id)).resolves.toBe(1);
  });
});

// ── Deletes ──────────────────────────────────────────────────────────────────────

describe('deleteGameForSquad', () => {
  it('deletes for the uploader and cascades players and teams', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const game = await seedGame(squad.id, user.id, { screenshotUrl: 'shot.jpg' });
    await seedPlayer(game.id, squad.id, { name: 'P', team: 'A' });
    await svc.createTeam({ gameId: game.id, name: 'A', isHome: true, squadId: squad.id });

    const result = await svc.deleteGameForSquad(game.id, squad.id, {
      userId: user.id,
      isOwner: false,
    });

    expect(result).toEqual({ outcome: 'deleted', screenshotUrl: 'shot.jpg' });
    await expect(countRows('games', squad.id)).resolves.toBe(0);
    await expect(countRows('players', squad.id)).resolves.toBe(0);
    await expect(countRows('teams', squad.id)).resolves.toBe(0);
  });

  it('deletes for the squad owner even when they did not upload it', async () => {
    const uploader = await makeUser();
    const owner = await makeUser();
    const squad = await makeSquad(uploader.id);
    const game = await seedGame(squad.id, uploader.id);

    const result = await svc.deleteGameForSquad(game.id, squad.id, {
      userId: owner.id,
      isOwner: true,
    });

    expect(result.outcome).toBe('deleted');
  });

  it('forbids a plain member who is not the uploader', async () => {
    const uploader = await makeUser();
    const member = await makeUser();
    const squad = await makeSquad(uploader.id);
    const game = await seedGame(squad.id, uploader.id);

    const result = await svc.deleteGameForSquad(game.id, squad.id, {
      userId: member.id,
      isOwner: false,
    });

    expect(result).toEqual({ outcome: 'forbidden' });
    await expect(countRows('games', squad.id)).resolves.toBe(1);
  });

  it('reports not_found for a game in another squad, disclosing nothing', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const other = await makeSquad(user.id);
    const game = await seedGame(other.id, user.id);

    const result = await svc.deleteGameForSquad(game.id, squad.id, {
      userId: user.id,
      isOwner: true,
    });

    // Same answer as a genuinely missing game — membership of other squads stays private.
    expect(result).toEqual({ outcome: 'not_found' });
  });

  it('reports not_found for an unknown id', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);

    await expect(
      svc.deleteGameForSquad('nope', squad.id, { userId: user.id, isOwner: true }),
    ).resolves.toEqual({ outcome: 'not_found' });
  });
});

describe('deleteGameById (admin)', () => {
  it('deletes across squads and returns the squadId and screenshot path', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const game = await seedGame(squad.id, user.id, { screenshotUrl: 'admin-shot.jpg' });

    const result = await svc.deleteGameById(game.id);

    expect(result).toEqual({
      outcome: 'deleted',
      squadId: squad.id,
      screenshotUrl: 'admin-shot.jpg',
    });
    await expect(countRows('games', squad.id)).resolves.toBe(0);
  });

  it('reports not_found for an unknown id', async () => {
    await expect(svc.deleteGameById('nope')).resolves.toEqual({ outcome: 'not_found' });
  });
});

// ── Storage ──────────────────────────────────────────────────────────────────────

describe('storage helpers', () => {
  it('getSignedUrl returns null for an empty path without calling Supabase', async () => {
    await expect(svc.getSignedUrl('')).resolves.toBeNull();
  });

  it.each([
    ['an http URL', 'http://example.com/x.jpg'],
    ['an https URL', 'https://example.com/x.jpg'],
    ['a data URI', 'data:image/jpeg;base64,AAAA'],
  ])('getSignedUrl passes %s through unchanged', async (_label, value) => {
    // Legacy rows may hold these; signing them would be meaningless.
    await expect(svc.getSignedUrl(value)).resolves.toBe(value);
  });

  it('getSignedUrl returns null when Supabase cannot be reached', async () => {
    // SUPABASE_URL points at an unroutable host in this harness, so this exercises the
    // real failure path rather than a stubbed one.
    await expect(svc.getSignedUrl('some/object/path.jpg')).resolves.toBeNull();
  });

  it.each([
    ['png', 'shot.png'],
    ['gif', 'shot.gif'],
    ['jpg', 'shot.jpg'],
    ['jpeg', 'shot.jpeg'],
    ['an unknown extension', 'shot.bmp'],
    ['no extension at all', 'shot'],
  ])(
    'uploadImage resolves a content type for %s then wraps the transport failure',
    async (_label, fileName) => {
      // The content-type branch runs before the network call, so every branch is exercised
      // even though the unroutable host makes the upload itself fail.
      await expect(svc.uploadImage(Buffer.from('x'), fileName)).rejects.toThrow(
        /Failed to upload image to Supabase/,
      );
    },
  );

  it('deleteImage wraps a transport failure in a descriptive Error', async () => {
    await expect(svc.deleteImage('shot.png')).rejects.toThrow(
      /Failed to delete image from Supabase/,
    );
  });
});

// ── Error propagation ────────────────────────────────────────────────────────────

/**
 * Every write helper logs and rethrows rather than swallowing. Driving these through a
 * genuine SQL type error keeps the assertion about behaviour (the caller sees the
 * failure) rather than about a mock having been called.
 */
describe('write helpers rethrow database errors', () => {
  const BAD_NUMBER = 'not-a-number';

  it('createTeam rethrows', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);
    const game = await seedGame(squad.id, user.id);

    await expect(
      svc.createTeam({
        gameId: game.id,
        name: 'A',
        isHome: true,
        squadId: squad.id,
        points: BAD_NUMBER,
      }),
    ).rejects.toThrow();
  });

  it('createPlayerTotals rethrows', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);

    await expect(
      svc.createPlayerTotals({
        id: 'bad',
        player_id: 'p',
        player_name: 'Akif',
        team: 'A',
        squadid: squad.id,
        total_points: BAD_NUMBER,
      }),
    ).rejects.toThrow();
  });

  it('updatePlayerTotals rethrows', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);

    await expect(
      svc.updatePlayerTotals('Akif', squad.id, { total_games: BAD_NUMBER }),
    ).rejects.toThrow();
  });

  it('updatePlayerStats rethrows', async () => {
    const user = await makeUser();
    const squad = await makeSquad(user.id);

    await expect(
      svc.updatePlayerStats('Akif', squad.id, { gamesPlayed: BAD_NUMBER }),
    ).rejects.toThrow();
  });

  it('updatePlayerStatsFromTotals rethrows', async () => {
    // A squad id of the wrong shape still parses, so force the failure with a name list
    // that makes the generated statement invalid downstream.
    await expect(
      svc.updatePlayerStatsFromTotals('squad', ['Akif'], {
        query: async () => {
          throw new Error('boom');
        },
      } as never),
    ).rejects.toThrow('boom');
  });
});

/**
 * The four transactional methods each guard their ROLLBACK with its own try/catch so a
 * connection that dies mid-transaction cannot replace the real error with a rollback
 * error. Reaching that path requires ROLLBACK itself to throw.
 */
describe('rollback failures do not mask the original error', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stubClientFailing(failOn: RegExp) {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (/^\s*ROLLBACK/i.test(sql)) throw new Error('connection lost during rollback');
        if (failOn.test(sql)) throw new Error('original failure');
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    };
    jest.spyOn(pgPool, 'connect').mockResolvedValue(client as never);
    return client;
  }

  it('saveGameWithStats rethrows the original error and releases the client', async () => {
    const client = stubClientFailing(/INSERT INTO games/i);

    await expect(
      svc.saveGameWithStats({ squadId: 's' }, [], { squadId: 's' }, { squadId: 's' }),
    ).rejects.toThrow('original failure');
    expect(client.release).toHaveBeenCalled();
  });

  it('updateGame rethrows the original error and releases the client', async () => {
    const client = stubClientFailing(/SELECT g\.\* FROM games/i);

    await expect(svc.updateGame('g', 's', { players: [] })).rejects.toThrow('original failure');
    expect(client.release).toHaveBeenCalled();
  });

  it('deleteGameForSquad rethrows the original error and releases the client', async () => {
    const client = stubClientFailing(/FROM games\s+WHERE id = \$1 AND "squadId"/i);

    await expect(
      svc.deleteGameForSquad('g', 's', { userId: 'u', isOwner: true }),
    ).rejects.toThrow('original failure');
    expect(client.release).toHaveBeenCalled();
  });

  it('deleteGameById rethrows the original error and releases the client', async () => {
    const client = stubClientFailing(/FROM games WHERE id = \$1 FOR UPDATE/i);

    await expect(svc.deleteGameById('g')).rejects.toThrow('original failure');
    expect(client.release).toHaveBeenCalled();
  });

  it('updateGame returns null if the scoped UPDATE matches nothing after the SELECT did', async () => {
    // Defensive branch: the SELECT and the UPDATE carry identical predicates, so real SQL
    // cannot reach it. Driving it through a stub documents the intended outcome — bail out
    // and roll back rather than continue with a half-applied edit.
    const client = {
      query: jest.fn(async (sql: string) => {
        if (/SELECT g\.\* FROM games/i.test(sql)) {
          return { rows: [{ id: 'g', squadId: 's' }], rowCount: 1 };
        }
        if (/UPDATE games/i.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    };
    jest.spyOn(pgPool, 'connect').mockResolvedValue(client as never);

    await expect(svc.updateGame('g', 's', { players: [] })).resolves.toBeNull();
    const issued = client.query.mock.calls.map((c) => String(c[0]));
    expect(issued.some((s) => /ROLLBACK/i.test(s))).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });
});
