import type { Client } from 'pg';

export interface LineupEfficiency {
  players: string[];
  team: string;
  games: number;
  wins: number;
  losses: number;
  avgPointDifferential: number;
}

const DEFAULT_MIN_GAMES = 2;

const LINEUP_EFFICIENCY_SQL = `
  WITH lineup_per_game AS (
    SELECT
      g.id AS game_id,
      p.team,
      ARRAY_AGG(p.name ORDER BY p.name) AS lineup,
      CASE
        WHEN p.team = g."homeTeam" THEN g."homeScore" - g."awayScore"
        ELSE                             g."awayScore" - g."homeScore"
      END AS point_diff
    FROM players p
    JOIN games g ON g.id = p."gameId"
    WHERE g."userId" = $1
    GROUP BY g.id, p.team, g."homeTeam", g."homeScore", g."awayScore"
  )
  SELECT
    lineup                                                AS players,
    team,
    COUNT(*)::INT                                         AS games,
    SUM(CASE WHEN point_diff > 0 THEN 1 ELSE 0 END)::INT AS wins,
    SUM(CASE WHEN point_diff < 0 THEN 1 ELSE 0 END)::INT AS losses,
    ROUND(AVG(point_diff)::NUMERIC, 2)::FLOAT             AS "avgPointDifferential"
  FROM lineup_per_game
  GROUP BY lineup, team
  HAVING COUNT(*) >= $2
  ORDER BY "avgPointDifferential" DESC
`;

export async function getLineupEfficiency(
  userId: string,
  db: Pick<Client, 'query'>,
  minGames: number = DEFAULT_MIN_GAMES,
): Promise<LineupEfficiency[]> {
  const result = await db.query(LINEUP_EFFICIENCY_SQL, [userId, minGames]);
  return result.rows.map((row: any) => ({
    players: row.players as string[],
    team: row.team as string,
    games: row.games as number,
    wins: row.wins as number,
    losses: row.losses as number,
    avgPointDifferential: Number(row.avgPointDifferential),
  }));
}
