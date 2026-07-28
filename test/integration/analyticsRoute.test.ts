/**
 * Integration tests for /api/analytics.
 *
 * The existing unit suite (src/routes/__tests__/analytics.test.ts) mocks the service layer,
 * so it pins the response shape but never exercises the aggregation. These run the real
 * thing against real rows: the allowed-names filter that decides whose stats exist at all,
 * the win/loss and shooting-percentage arithmetic, and the on-the-fly fallback that only
 * became reachable when the read helpers started throwing instead of returning [].
 */
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import supabaseService, { pgPool } from '@/services/supabase';
import authService from '@/services/authService';
import analyticsRouter from '@/routes/analytics';
import { makeUser, makeSquad, makeMapping } from './factories';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/analytics', analyticsRouter);
  return a;
}

async function actor() {
  const user = await makeUser();
  const squad = await makeSquad(user.id);
  await pgPool.query('UPDATE users SET "activeSquadId" = $1 WHERE id = $2', [squad.id, user.id]);
  return {
    user,
    squad,
    auth: `Bearer ${authService.generateToken({ id: user.id, email: user.email, role: 'USER' })}`,
  };
}

interface PlayerSpec {
  name: string;
  team: 'home' | 'away';
  points?: number;
  rebounds?: number;
  assists?: number;
  steals?: number;
  blocks?: number;
  threeMade?: number;
  fgMade?: number;
  fgAttempted?: number;
  ftMade?: number;
  ftAttempted?: number;
  threeAttempted?: number;
}

async function seedGame(
  squadId: string,
  uploaderId: string,
  opts: {
    homeTeam?: string;
    awayTeam?: string;
    homeScore?: number;
    awayScore?: number;
    players?: PlayerSpec[];
  } = {},
): Promise<string> {
  const gameId = randomUUID();
  const homeTeam = opts.homeTeam ?? 'Team A';
  const awayTeam = opts.awayTeam ?? 'Team B';

  await pgPool.query(
    `INSERT INTO games (id, date, "homeTeam", "awayTeam", "homeScore", "awayScore",
                        "squadId", "uploadedByUserId", "createdAt", "updatedAt")
     VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
    [gameId, homeTeam, awayTeam, opts.homeScore ?? 100, opts.awayScore ?? 90, squadId, uploaderId],
  );

  // Default to one player: json_agg over the LEFT JOIN yields [null] for a game with no
  // player rows, which calculateTeamStats dereferences and dies on. Tests that mean to
  // exercise the aggregation must not trip over that; the crash is covered separately.
  const players: PlayerSpec[] = opts.players ?? [{ name: 'Filler', team: 'home' }];
  for (const [i, p] of players.entries()) {
    await pgPool.query(
      `INSERT INTO players (id, name, team, "gameIdFromFile", "playerId", position,
                            "gameId", "squadId", points, rebounds, assists, steals, blocks,
                            "threeMade", "threeAttempted", "fgMade", "fgAttempted",
                            "ftMade", "ftAttempted", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 'PG', $5, $6,
               $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())`,
      [
        p.name,
        p.team === 'home' ? homeTeam : awayTeam,
        String(i),
        randomUUID(),
        gameId,
        squadId,
        p.points ?? 0,
        p.rebounds ?? 0,
        p.assists ?? 0,
        p.steals ?? 0,
        p.blocks ?? 0,
        p.threeMade ?? 0,
        p.threeAttempted ?? 0,
        p.fgMade ?? 0,
        p.fgAttempted ?? 0,
        p.ftMade ?? 0,
        p.ftAttempted ?? 0,
      ],
    );
  }

  for (const [name, isHome] of [
    [homeTeam, true],
    [awayTeam, false],
  ] as const) {
    await pgPool.query(
      `INSERT INTO teams (id, name, "isHome", "gameId", "squadId", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, NOW(), NOW())`,
      [name, isHome, gameId, squadId],
    );
  }

  return gameId;
}

afterEach(() => jest.restoreAllMocks());

describe('authentication', () => {
  it.each(['/players', '/teams', '/dashboard', '/lineups'])('%s requires a token', async (path) => {
    const res = await request(app()).get(`/api/analytics${path}`);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/analytics/players', () => {
  it('returns only players whose names are on the squad roster', async () => {
    const me = await actor();
    await makeMapping(me.squad.id, 'tag-akif', 'Akif');
    await seedGame(me.squad.id, me.user.id, {
      players: [
        { name: 'Akif', team: 'home', points: 20 },
        { name: 'RandomOpponent', team: 'away', points: 30 },
      ],
    });

    const res = await request(app()).get('/api/analytics/players').set('Authorization', me.auth);

    expect(res.status).toBe(200);
    // Unmapped names accrue nothing — this is the whole point of the roster.
    expect(res.body.data.players.map((p: { name: string }) => p.name)).toEqual(['Akif']);
  });

  it('returns empty collections for a squad with no games', async () => {
    const me = await actor();

    const res = await request(app()).get('/api/analytics/players').set('Authorization', me.auth);

    expect(res.body.data.players).toEqual([]);
    expect(res.body.data.stats).toEqual([]);
  });

  it("never includes another squad's players", async () => {
    const me = await actor();
    const other = await actor();
    await makeMapping(other.squad.id, 'tag', 'Akif');
    await seedGame(other.squad.id, other.user.id, {
      players: [{ name: 'Akif', team: 'home', points: 20 }],
    });

    const res = await request(app()).get('/api/analytics/players').set('Authorization', me.auth);

    expect(res.body.data.players).toEqual([]);
  });

  it('500s when the underlying read fails', async () => {
    const me = await actor();
    jest
      .spyOn(supabaseService, 'getGamesBySquadId')
      .mockRejectedValue(new Error('db down') as never);

    const res = await request(app()).get('/api/analytics/players').set('Authorization', me.auth);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to fetch player statistics' });
  });
});

describe('calculatePlayerStats — on-the-fly fallback', () => {
  /**
   * getPlayerStats reads the denormalised player_stats table. It used to swallow errors and
   * return [], which made this fallback unreachable dead code; since the read helpers were
   * changed to rethrow, it is live for the first time.
   */
  function breakPlayerStatsTable() {
    jest
      .spyOn(supabaseService, 'getPlayerStats')
      .mockRejectedValue(new Error('player_stats unavailable') as never);
  }

  it('recomputes averages from the per-game rows', async () => {
    const me = await actor();
    await makeMapping(me.squad.id, 'tag-akif', 'Akif');
    await seedGame(me.squad.id, me.user.id, {
      players: [{ name: 'Akif', team: 'home', points: 10, rebounds: 4, assists: 2 }],
    });
    await seedGame(me.squad.id, me.user.id, {
      players: [{ name: 'Akif', team: 'home', points: 20, rebounds: 8, assists: 6 }],
    });
    breakPlayerStatsTable();

    const res = await request(app()).get('/api/analytics/players').set('Authorization', me.auth);

    expect(res.status).toBe(200);
    const akif = res.body.data.stats.find((s: { playerName: string }) => s.playerName === 'Akif');
    expect(akif).toMatchObject({ gamesPlayed: 2, avgPoints: 15, avgRebounds: 6, avgAssists: 4 });
  });

  it('skips unmapped names in the fallback too', async () => {
    const me = await actor();
    await makeMapping(me.squad.id, 'tag-akif', 'Akif');
    await seedGame(me.squad.id, me.user.id, {
      players: [
        { name: 'Akif', team: 'home', points: 10 },
        { name: 'Stranger', team: 'away', points: 40 },
      ],
    });
    breakPlayerStatsTable();

    const res = await request(app()).get('/api/analytics/players').set('Authorization', me.auth);

    expect(res.body.data.stats.map((s: { playerName: string }) => s.playerName)).toEqual(['Akif']);
  });

  it('joins the team names when a player appears under more than one lineup', async () => {
    const me = await actor();
    await makeMapping(me.squad.id, 'tag-akif', 'Akif');
    await seedGame(me.squad.id, me.user.id, {
      homeTeam: 'Lineup One',
      players: [{ name: 'Akif', team: 'home', points: 10 }],
    });
    await seedGame(me.squad.id, me.user.id, {
      homeTeam: 'Lineup Two',
      players: [{ name: 'Akif', team: 'home', points: 20 }],
    });
    breakPlayerStatsTable();

    const res = await request(app()).get('/api/analytics/players').set('Authorization', me.auth);

    const akif = res.body.data.stats.find((s: { playerName: string }) => s.playerName === 'Akif');
    expect(akif.team).toContain(',');
    // The internal Set used to collect them must not leak into the response.
    expect(akif.teams).toBeUndefined();
  });

  it('keeps a single team name unjoined', async () => {
    const me = await actor();
    await makeMapping(me.squad.id, 'tag-akif', 'Akif');
    await seedGame(me.squad.id, me.user.id, {
      homeTeam: 'Only Lineup',
      players: [{ name: 'Akif', team: 'home', points: 10 }],
    });
    breakPlayerStatsTable();

    const res = await request(app()).get('/api/analytics/players').set('Authorization', me.auth);

    const akif = res.body.data.stats.find((s: { playerName: string }) => s.playerName === 'Akif');
    expect(akif.team).toBe('Only Lineup');
  });
});

describe('GET /api/analytics/teams', () => {
  it('counts a win for the higher score and a loss for the lower', async () => {
    const me = await actor();
    await seedGame(me.squad.id, me.user.id, { homeScore: 110, awayScore: 90 });

    const res = await request(app()).get('/api/analytics/teams').set('Authorization', me.auth);

    expect(res.status).toBe(200);
    const stats = res.body.data.stats as Array<{ name: string; wins: number; losses: number }>;
    expect(stats.find((t) => t.name === 'Team A')).toMatchObject({ wins: 1, losses: 0 });
    expect(stats.find((t) => t.name === 'Team B')).toMatchObject({ wins: 0, losses: 1 });
  });

  it('records the home team losing when it is outscored', async () => {
    const me = await actor();
    await seedGame(me.squad.id, me.user.id, { homeScore: 80, awayScore: 95 });

    const res = await request(app()).get('/api/analytics/teams').set('Authorization', me.auth);

    const stats = res.body.data.stats as Array<{ name: string; wins: number; losses: number }>;
    expect(stats.find((t) => t.name === 'Team A')).toMatchObject({ wins: 0, losses: 1 });
    expect(stats.find((t) => t.name === 'Team B')).toMatchObject({ wins: 1, losses: 0 });
  });

  it('aggregates player box-score lines into team totals', async () => {
    const me = await actor();
    await seedGame(me.squad.id, me.user.id, {
      players: [
        { name: 'A', team: 'home', rebounds: 5, assists: 3, steals: 1, blocks: 2 },
        { name: 'B', team: 'home', rebounds: 4, assists: 2, steals: 1, blocks: 0 },
      ],
    });

    const res = await request(app()).get('/api/analytics/teams').set('Authorization', me.auth);

    // Team totals deliberately include unmapped players — they are the real team's numbers.
    const teamA = (res.body.data.stats as Array<{ name: string; totalRebounds: number }>).find(
      (t) => t.name === 'Team A',
    );
    expect(teamA).toMatchObject({ totalRebounds: 9, totalAssists: 5, totalSteals: 2, totalBlocks: 2 });
  });

  it('computes shooting percentages to two decimal places', async () => {
    const me = await actor();
    await seedGame(me.squad.id, me.user.id, {
      players: [
        { name: 'A', team: 'home', fgMade: 1, fgAttempted: 3, threeMade: 1, threeAttempted: 3, ftMade: 1, ftAttempted: 3 },
      ],
    });

    const res = await request(app()).get('/api/analytics/teams').set('Authorization', me.auth);

    const teamA = (res.body.data.stats as Array<{ name: string; fg_percentage: number }>).find(
      (t) => t.name === 'Team A',
    );
    expect(teamA!.fg_percentage).toBe(33.33);
  });

  it('reports zero percentages rather than dividing by zero', async () => {
    const me = await actor();
    await seedGame(me.squad.id, me.user.id, {
      players: [{ name: 'A', team: 'home', fgMade: 0, fgAttempted: 0 }],
    });

    const res = await request(app()).get('/api/analytics/teams').set('Authorization', me.auth);

    const teamA = (res.body.data.stats as Array<{ name: string; fg_percentage: number }>).find(
      (t) => t.name === 'Team A',
    );
    expect(teamA).toMatchObject({ fg_percentage: 0, three_percentage: 0, ft_percentage: 0 });
  });

  it('survives a game that has no player rows at all', async () => {
    const me = await actor();
    await seedGame(me.squad.id, me.user.id, { players: [], homeScore: 100, awayScore: 90 });

    const res = await request(app()).get('/api/analytics/teams').set('Authorization', me.auth);

    // Regression guard. json_agg over the LEFT JOIN used to return [null] here, and
    // calculateTeamStats read `p.team` off that null — the entire endpoint 500'd because
    // one game was missing its players.
    expect(res.status).toBe(200);
    const stats = res.body.data.stats as Array<{ name: string; totalRebounds: number }>;
    expect(stats.find((t) => t.name === 'Team A')).toMatchObject({
      gamesPlayed: 1,
      totalRebounds: 0,
    });
  });

  it('500s when the read fails', async () => {
    const me = await actor();
    jest
      .spyOn(supabaseService, 'getGamesBySquadId')
      .mockRejectedValue(new Error('db down') as never);

    const res = await request(app()).get('/api/analytics/teams').set('Authorization', me.auth);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to fetch team statistics' });
  });
});

describe('GET /api/analytics/dashboard', () => {
  it('averages Team A and Team B when both are present', async () => {
    const me = await actor();
    await seedGame(me.squad.id, me.user.id, { homeScore: 100, awayScore: 80 });

    const res = await request(app()).get('/api/analytics/dashboard').set('Authorization', me.auth);

    expect(res.status).toBe(200);
    expect(res.body.data.avgPointsTeamAAndB).toBe(90);
  });

  it('falls back to Team A alone when Team B is absent', async () => {
    const me = await actor();
    await seedGame(me.squad.id, me.user.id, { awayTeam: 'Some Lineup', homeScore: 100 });

    const res = await request(app()).get('/api/analytics/dashboard').set('Authorization', me.auth);

    expect(res.body.data.avgPointsTeamAAndB).toBe(100);
  });

  it('falls back to Team B alone when Team A is absent', async () => {
    const me = await actor();
    await seedGame(me.squad.id, me.user.id, { homeTeam: 'Some Lineup', awayScore: 70 });

    const res = await request(app()).get('/api/analytics/dashboard').set('Authorization', me.auth);

    expect(res.body.data.avgPointsTeamAAndB).toBe(70);
  });

  it('reports zero when neither Team A nor Team B appears', async () => {
    const me = await actor();
    await seedGame(me.squad.id, me.user.id, { homeTeam: 'Lineup One', awayTeam: 'Lineup Two' });

    const res = await request(app()).get('/api/analytics/dashboard').set('Authorization', me.auth);

    expect(res.body.data.avgPointsTeamAAndB).toBe(0);
  });

  it('counts games, distinct players and unique team names', async () => {
    const me = await actor();
    await makeMapping(me.squad.id, 'tag-akif', 'Akif');
    await seedGame(me.squad.id, me.user.id, {
      players: [
        { name: 'Akif', team: 'home', points: 10 },
        { name: 'Other', team: 'away', points: 5 },
      ],
    });

    const res = await request(app()).get('/api/analytics/dashboard').set('Authorization', me.auth);

    expect(res.body.data.totalGames).toBe(1);
    expect(res.body.data.totalPlayers).toBe(2);
    expect(res.body.data.totalTeams).toBe(2);
  });

  it('caps recentGames at ten', async () => {
    const me = await actor();
    for (let i = 0; i < 12; i++) await seedGame(me.squad.id, me.user.id);

    const res = await request(app()).get('/api/analytics/dashboard').set('Authorization', me.auth);

    expect(res.body.data.totalGames).toBe(12);
    expect(res.body.data.recentGames).toHaveLength(10);
  });

  it('ranks top performers and game highs, capped at five each', async () => {
    const me = await actor();
    const names = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
    for (const n of names) await makeMapping(me.squad.id, `tag-${n}`, n);
    await seedGame(me.squad.id, me.user.id, {
      players: names.map((n, i) => ({
        name: n,
        team: 'home' as const,
        points: (i + 1) * 10,
        rebounds: (i + 1) * 2,
        assists: i + 1,
        steals: i,
        blocks: i,
        threeMade: i,
      })),
    });

    // topPerformers reads the denormalised player_stats table, which seeding rows directly
    // bypasses. Rebuild it the way the application does, so this exercises the primary
    // path rather than the on-the-fly fallback.
    await supabaseService.recomputeSquadAggregates(me.squad.id);

    const res = await request(app()).get('/api/analytics/dashboard').set('Authorization', me.auth);

    const { topPerformers, gameHighs } = res.body.data;
    expect(topPerformers.points).toHaveLength(5);
    // Six mapped players, five slots — the lowest scorer must be the one dropped.
    expect(topPerformers.points[0].playerName).toBe('P6');
    for (const key of ['points', 'rebounds', 'assists', 'steals', 'blocks', 'threeMade']) {
      expect(gameHighs[key]).toHaveLength(5);
    }
    expect(gameHighs.points[0]).toMatchObject({ playerName: 'P6', value: 60 });
    expect(gameHighs.threeMade[0]).toMatchObject({ playerName: 'P6', value: 5 });
  });

  it('500s when the read fails', async () => {
    const me = await actor();
    jest
      .spyOn(supabaseService, 'getGamesBySquadId')
      .mockRejectedValue(new Error('db down') as never);

    const res = await request(app()).get('/api/analytics/dashboard').set('Authorization', me.auth);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to fetch analytics dashboard' });
  });
});

describe('GET /api/analytics/lineups', () => {
  it('returns lineup rows for a squad with games', async () => {
    const me = await actor();
    await makeMapping(me.squad.id, 'tag-akif', 'Akif');
    await seedGame(me.squad.id, me.user.id, {
      homeTeam: 'Akif (PG) + AI (SG)',
      players: [{ name: 'Akif', team: 'home', points: 10 }],
    });

    const res = await request(app()).get('/api/analytics/lineups').set('Authorization', me.auth);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.lineups)).toBe(true);
  });

  it('returns an empty list for a squad with no games', async () => {
    const me = await actor();

    const res = await request(app()).get('/api/analytics/lineups').set('Authorization', me.auth);

    expect(res.body.data.lineups).toEqual([]);
  });

  it('500s when the query fails', async () => {
    const me = await actor();
    const real = pgPool.query.bind(pgPool);
    jest.spyOn(pgPool, 'query').mockImplementation(((sql: unknown, params: unknown) => {
      if (typeof sql === 'string' && /lineup_per_game/.test(sql)) {
        return Promise.reject(new Error('db down'));
      }
      return real(sql as never, params as never);
    }) as never);

    const res = await request(app()).get('/api/analytics/lineups').set('Authorization', me.auth);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to fetch lineup efficiency' });
  });
});
