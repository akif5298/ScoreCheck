/**
 * Games, players, teams — the write path for a saved box score, and every read over it.
 *
 * Final link in the composition chain, so it can reach every earlier one through `this`.
 * See the note in storage.ts for why the chain is `extends` rather than plain imports:
 * updateGame calls this.recomputeSquadAggregates (aggregates) and this.getGameById (here),
 * and saveGameWithStats calls this.createGame / this.createPlayer / this.createTeam. Those
 * have to keep dispatching through the instance so test spies still intercept them.
 */
import { randomUUID } from 'node:crypto';
import {
  pgPool,
  DuplicateGameError,
  SQUAD_SAVE_LOCK_NAMESPACE,
  type Queryable,
} from './client';
import { AggregatesService } from './aggregates';
import logger from '@/utils/logger';
import { hammingDistance, DUPLICATE_HAMMING_THRESHOLD } from '@/utils/imageHash';

export class GamesService extends AggregatesService {
  // Squad-scoped: every member's uploads share one hash pool, so the same screenshot
  // uploaded by a second member is recognised as a duplicate.
  async getGameHashesBySquadId(squadId: string): Promise<string[]> {
    const result = await pgPool.query(
      `SELECT "imageHash" FROM games WHERE "squadId" = $1 AND "imageHash" IS NOT NULL`,
      [squadId],
    );
    return result.rows.map((row: any) => row.imageHash as string);
  }

  async createGame(gameData: any, db: Queryable = pgPool) {
    try {
      const query = `
        INSERT INTO games (id, date, "homeTeam", "awayTeam", "homeScore", "awayScore", "screenshotUrl", "imageHash", processed, "createdAt", "updatedAt", "squadId", "uploadedByUserId")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW(), $10, $11)
        RETURNING *
      `;
      const values = [
        gameData.id || `game_${randomUUID()}`,
        gameData.date,
        gameData.homeTeam,
        gameData.awayTeam,
        gameData.homeScore,
        gameData.awayScore,
        gameData.screenshotUrl || null,
        gameData.imageHash || null,
        gameData.processed || false,
        gameData.squadId,
        gameData.uploadedByUserId
      ];

      const result = await db.query(query, values);
      return result.rows[0];
    } catch (error) {
      logger.error({ err: error }, 'Error creating game');
      throw error;
    }
  }

  async createPlayer(playerData: any, db: Queryable = pgPool) {
    try {
      const query = `
        INSERT INTO players (
          id, "gameId", name, team, position, points, rebounds, assists, steals, blocks,
          turnovers, fouls, "fgMade", "fgAttempted", "threeMade", "threeAttempted",
          "ftMade", "ftAttempted", "fg_percentage", "three_percentage", "ft_percentage",
          "teammateGrade", "playerId", "gameIdFromFile", "createdAt", "updatedAt", "squadId"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, NOW(), NOW(), $25)
        RETURNING *
      `;
      const values = [
        playerData.id || `player_${randomUUID()}`,
        playerData.gameId,
        playerData.name || playerData.playerName,
        playerData.team,
        playerData.position || null,
        playerData.points || 0,
        playerData.rebounds || 0,
        playerData.assists || 0,
        playerData.steals || 0,
        playerData.blocks || 0,
        playerData.turnovers || 0,
        playerData.fouls || 0,
        playerData.fgMade || 0,
        playerData.fgAttempted || 0,
        playerData.threeMade || 0,
        playerData.threeAttempted || 0,
        playerData.ftMade || 0,
        playerData.ftAttempted || 0,
        playerData.fg_percentage || 0.00,
        playerData.three_percentage || 0.00,
        playerData.ft_percentage || 0.00,
        playerData.teammateGrade || null,
        playerData.playerId || null,
        playerData.gameIdFromFile || null,
        playerData.squadId
      ];

      const result = await db.query(query, values);
      return result.rows[0];
    } catch (error) {
      logger.error({ err: error }, 'Error creating player');
      throw error;
    }
  }

  async createTeam(teamData: any, db: Queryable = pgPool) {
    try {
      const query = `
        INSERT INTO teams (
          id, "gameId", name, "isHome", points, rebounds, assists, steals, blocks,
          turnovers, fouls, "fgMade", "fgAttempted", "threeMade", "threeAttempted",
          "ftMade", "ftAttempted", "fg_percentage", "three_percentage", "ft_percentage", "createdAt", "updatedAt", "squadId"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW(), NOW(), $21)
        RETURNING *
      `;
      const values = [
        teamData.id || `team_${randomUUID()}`,
        teamData.gameId,
        teamData.name,
        teamData.isHome,
        teamData.points || 0,
        teamData.rebounds || 0,
        teamData.assists || 0,
        teamData.steals || 0,
        teamData.blocks || 0,
        teamData.turnovers || 0,
        teamData.fouls || 0,
        teamData.fgMade || 0,
        teamData.fgAttempted || 0,
        teamData.threeMade || 0,
        teamData.threeAttempted || 0,
        teamData.ftMade || 0,
        teamData.ftAttempted || 0,
        teamData.fg_percentage || 0.00,
        teamData.three_percentage || 0.00,
        teamData.ft_percentage || 0.00,
        teamData.squadId
      ];

      const result = await db.query(query, values);
      return result.rows[0];
    } catch (error) {
      logger.error({ err: error }, 'Error creating team');
      throw error;
    }
    }

  // Serialises concurrent saves within one squad, then re-runs the perceptual-hash
  // duplicate check against committed rows. Must be called inside a transaction.
  //
  // Why this exists: the upload route already rejects duplicates, but that check runs
  // ~22s before the row is written (the gap is bridged by the in-memory `pendingHashes`
  // map). Two members uploading the same screenshot at the same time therefore both pass
  // it — neither game is in the table yet — and both reach the save. A unique index
  // cannot close this: the match is fuzzy (hamming distance), not equality.
  //
  // pg_advisory_xact_lock is released automatically at COMMIT or ROLLBACK, so no failure
  // path below can strand it. Holding it in the database rather than in process memory
  // means this stays correct if the API is ever run on more than one instance — unlike
  // `pendingHashes` and the extraction quota counters, which do not.
  private async assertNotDuplicateInSquad(gameData: any, client: Queryable): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
      SQUAD_SAVE_LOCK_NAMESPACE,
      gameData.squadId,
    ]);

    // No hash means this game did not come through the upload route (or hashing failed),
    // so there is nothing to compare and the save proceeds. Such a game is invisible to
    // duplicate detection from then on, which is why the hash is preserved across a
    // failed save rather than consumed before the commit.
    if (!gameData.imageHash) return;

    const { rows } = await client.query(
      `SELECT id, "imageHash" FROM games WHERE "squadId" = $1 AND "imageHash" IS NOT NULL`,
      [gameData.squadId],
    );

    const match = rows.find((row: any) => {
      // hammingDistance throws on a length mismatch. Every stored hash is 60 chars today,
      // but a stray legacy value must not turn a save into a 500 — treat it as no match.
      if (row.imageHash.length !== gameData.imageHash.length) return false;
      return hammingDistance(gameData.imageHash, row.imageHash) <= DUPLICATE_HAMMING_THRESHOLD;
    });

    if (match) {
      // Thrown, not returned: the caller's transaction must not commit. The catch in
      // saveGameWithStats issues the ROLLBACK, which also drops the advisory lock.
      throw new DuplicateGameError(match.id);
    }
  }

  // Atomically creates a game, its players, and both team records in a single
  // pgPool transaction. Rolls back all writes if any step fails.
  //
  // Throws DuplicateGameError if the squad already holds a perceptually identical
  // screenshot — see the check below.
  async saveGameWithStats(
    gameData: any,
    playersData: any[],
    homeTeamData: any,
    awayTeamData: any,
  ): Promise<{ game: any; players: any[] }> {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await this.assertNotDuplicateInSquad(gameData, client);
      const game = await this.createGame(gameData, client);
      const players = await Promise.all(playersData.map(p => this.createPlayer(p, client)));
      await Promise.all([
        this.createTeam(homeTeamData, client),
        this.createTeam(awayTeamData, client),
      ]);
      await client.query('COMMIT');
      return { game, players };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error({ err: rollbackErr }, 'Transaction rollback failed after game save error');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async getPlayerStats(squadId: string) {
    try {
      const query = `
        SELECT * FROM player_stats
        WHERE "squadId" = $1
        ORDER BY "totalPoints" DESC
      `;

      const result = await pgPool.query(query, [squadId]);
      return result.rows;
    } catch (error) {
      logger.error({ err: error }, 'Error getting player stats');
      throw error;
    }
  }

  async getGamesBySquadId(squadId: string) {
    try {
      // FILTER + COALESCE, not a bare json_agg: over a LEFT JOIN with no matching rows an
      // unfiltered json_agg produces [null], which every consumer then has to remember to
      // strip. analytics.ts did not, and read `p.team` off that null — a 500 for the whole
      // dashboard whenever a game had no players. Absence is reported as [] instead.
      const query = `
        SELECT g.*,
               COALESCE(json_agg(DISTINCT p.*) FILTER (WHERE p.id IS NOT NULL), '[]') as players,
               COALESCE(json_agg(DISTINCT t.*) FILTER (WHERE t.id IS NOT NULL), '[]') as teams
        FROM games g
        LEFT JOIN players p ON g.id = p."gameId"
        LEFT JOIN teams t ON g.id = t."gameId"
        WHERE g."squadId" = $1
        GROUP BY g.id
      `;

      const result = await pgPool.query(query, [squadId]);
      return result.rows;
    } catch (error) {
      logger.error({ err: error }, 'Error getting games by user ID');
      throw error;
    }
  }

  async getDistinctPlayerCount(squadId: string): Promise<number> {
    try {
      // Count distinct players by their name column (normalized to handle case/whitespace differences)
      const query = `
        SELECT COUNT(DISTINCT LOWER(TRIM(name))) as distinct_players
        FROM players
        WHERE "squadId" = $1
          AND name IS NOT NULL
          AND TRIM(name) != ''
      `;

      const result = await pgPool.query(query, [squadId]);
      const count = parseInt(result.rows[0]?.distinct_players || '0', 10);
      return count;
    } catch (error) {
      logger.error({ err: error }, 'Error getting distinct player count');
      throw error;
    }
  }

  async getGameByScreenshotUrl(screenshotUrl: string, squadId: string) {
    try {
      const query = `
        SELECT * FROM games
        WHERE "screenshotUrl" = $1 AND "squadId" = $2
        ORDER BY "createdAt" DESC
        LIMIT 1
      `;

      const result = await pgPool.query(query, [screenshotUrl, squadId]);
      return result.rows[0] || null;
    } catch (error) {
      // Must NOT return null here: the caller reads null as "no existing game" and saves a
      // duplicate. A failed lookup has to fail the request, not masquerade as absence.
      logger.error({ err: error }, 'Error getting game by screenshot URL');
      throw error;
    }
  }

  async updateGame(gameId: string, squadId: string, updateData: any) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');

      // Scope check: a game belonging to another squad is invisible (404 at the route).
      const currentGameResult = await client.query(
        `SELECT g.* FROM games g WHERE g.id = $1 AND g."squadId" = $2`,
        [gameId, squadId],
      );
      if (currentGameResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      // Scope the WRITE as well as the read. The previous version updated `WHERE id = $6`
      // with no guard of its own, relying entirely on the SELECT above.
      // uploadedByUserId is deliberately never touched here: an edit by another member
      // must not reassign authorship of the game.
      const gameResult = await client.query(
        `UPDATE games
         SET "homeTeam" = $1, "awayTeam" = $2, "homeScore" = $3, "awayScore" = $4,
             "date" = $5, "updatedAt" = NOW()
         WHERE id = $6 AND "squadId" = $7
         RETURNING *`,
        [
          updateData.homeTeam,
          updateData.awayTeam,
          updateData.homeScore,
          updateData.awayScore,
          updateData.date,
          gameId,
          squadId,
        ],
      );
      if (gameResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      // Replace this game's rows wholesale, then rebuild aggregates from them.
      await client.query('DELETE FROM players WHERE "gameId" = $1', [gameId]);
      await client.query('DELETE FROM teams WHERE "gameId" = $1', [gameId]);

      // 2 dp, matching the save path. The old edit path used Math.round(x*1000)/10 (1 dp),
      // so editing a game silently changed the precision of its stored percentages.
      const pct = (made: number, att: number) =>
        att > 0 ? Math.round((made / att) * 100 * 100) / 100 : 0;

      for (const player of updateData.players as any[]) {
        await client.query(
          `INSERT INTO players (
             id, "gameId", name, team, "teammateGrade", points, rebounds, assists,
             steals, blocks, fouls, turnovers, "fgMade", "fgAttempted", "threeMade",
             "threeAttempted", "ftMade", "ftAttempted", "gameIdFromFile", "playerId",
             "position", "squadId", "fg_percentage", "three_percentage", "ft_percentage",
             "createdAt", "updatedAt"
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,NOW(),NOW())`,
          [
            player.id || `player_${randomUUID()}`,
            gameId,
            player.name,
            player.team,
            player.teammateGrade || '',
            player.points || 0,
            player.rebounds || 0,
            player.assists || 0,
            player.steals || 0,
            player.blocks || 0,
            player.fouls || 0,
            player.turnovers || 0,
            player.fgMade || 0,
            player.fgAttempted || 0,
            player.threeMade || 0,
            player.threeAttempted || 0,
            player.ftMade || 0,
            player.ftAttempted || 0,
            player.gameIdFromFile || gameId,
            player.playerId || `${gameId}-${randomUUID().slice(0, 3)}`,
            player.position || 'Unknown',
            squadId,
            pct(player.fgMade || 0, player.fgAttempted || 0),
            pct(player.threeMade || 0, player.threeAttempted || 0),
            pct(player.ftMade || 0, player.ftAttempted || 0),
          ],
        );
      }

      // Both team rows are rebuilt unconditionally. The previous version inserted a side
      // only `if (homePlayers.length > 0)`, matching players to the team by exact string
      // equality — so an edit that changed team naming DELETEd both rows and inserted
      // neither, silently losing the game's team records.
      const sides: Array<{ name: string; isHome: boolean; score: number }> = [
        { name: updateData.homeTeam, isHome: true, score: updateData.homeScore },
        { name: updateData.awayTeam, isHome: false, score: updateData.awayScore },
      ];
      for (const side of sides) {
        const members = (updateData.players as any[]).filter((p) => p.team === side.name);
        const sum = (k: string) => members.reduce((acc: number, p: any) => acc + (p[k] || 0), 0);
        const fgm = sum('fgMade');
        const fga = sum('fgAttempted');
        const tpm = sum('threeMade');
        const tpa = sum('threeAttempted');
        const ftm = sum('ftMade');
        const fta = sum('ftAttempted');
        await client.query(
          `INSERT INTO teams (
             id, name, "isHome", points, rebounds, assists, steals, blocks,
             turnovers, fouls, "fgMade", "fgAttempted", "threeMade", "threeAttempted",
             "ftMade", "ftAttempted", "fg_percentage", "three_percentage", "ft_percentage",
             "createdAt", "updatedAt", "gameId", "squadId"
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW(),NOW(),$20,$21)`,
          [
            `team_${randomUUID()}_${side.isHome ? 'home' : 'away'}`,
            side.name,
            side.isHome,
            side.score,
            sum('rebounds'),
            sum('assists'),
            sum('steals'),
            sum('blocks'),
            sum('turnovers'),
            sum('fouls'),
            fgm,
            fga,
            tpm,
            tpa,
            ftm,
            fta,
            pct(fgm, fga),
            pct(tpm, tpa),
            pct(ftm, fta),
            gameId,
            squadId,
          ],
        );
      }

      // Single aggregate path: rebuild from the rows just written, on this transaction
      // client so it participates in the same transaction.
      await this.recomputeSquadAggregates(squadId, client);

      await client.query('COMMIT');

      // Post-commit read on the pool.
      return await this.getGameById(gameId, squadId);
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error({ err: rollbackErr }, 'Rollback failed after game update error');
      }
      logger.error({ err: error }, 'Error updating game');
      throw error;
    } finally {
      client.release();
    }
  }

  async getGameById(gameId: string, squadId: string) {
    try {
      // Same FILTER + COALESCE as getGamesBySquadId — see the note there. The two must
      // agree: callers switch between them freely and would otherwise get [] from one and
      // [null] from the other for the same game.
      const query = `
        SELECT g.*,
               COALESCE(json_agg(DISTINCT p.*) FILTER (WHERE p.id IS NOT NULL), '[]') as players,
               COALESCE(json_agg(DISTINCT t.*) FILTER (WHERE t.id IS NOT NULL), '[]') as teams
        FROM games g
        LEFT JOIN players p ON g.id = p."gameId"
        LEFT JOIN teams t ON g.id = t."gameId"
        WHERE g.id = $1 AND g."squadId" = $2
        GROUP BY g.id
      `;

      const result = await pgPool.query(query, [gameId, squadId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error({ err: error }, 'Error getting game by ID');
      throw error;
    }
  }

  /**
   * Deletes a game from one squad, enforcing the delete rule in the same transaction that
   * performs the delete.
   *
   * Outcomes are distinguished deliberately:
   *   - `not_found`  — no such game *in this squad*. A game in another squad reports the
   *                    same thing, so membership of other squads is never disclosed.
   *   - `forbidden`  — it exists and the caller may see it, but is neither its uploader
   *                    nor the squad owner.
   *   - `deleted`    — gone, along with its players and teams (both cascade on gameId,
   *                    verified against the live schema).
   *
   * The row is locked with FOR UPDATE between the check and the delete so two concurrent
   * deletes cannot both pass the permission check against a row one of them is removing.
   *
   * Storage cleanup and aggregate rebuild are the caller's job: neither is transactional,
   * so both belong after the commit.
   */
  async deleteGameForSquad(
    gameId: string,
    squadId: string,
    actor: { userId: string; isOwner: boolean },
  ): Promise<
    | { outcome: 'deleted'; screenshotUrl: string | null }
    | { outcome: 'not_found' }
    | { outcome: 'forbidden' }
  > {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');

      const found = await client.query<{ uploadedByUserId: string; screenshotUrl: string | null }>(
        `SELECT "uploadedByUserId", "screenshotUrl" FROM games
         WHERE id = $1 AND "squadId" = $2 FOR UPDATE`,
        [gameId, squadId],
      );
      const game = found.rows[0];
      if (!game) {
        await client.query('ROLLBACK');
        return { outcome: 'not_found' };
      }

      // Uploader or squad owner. A plain member may edit any of the squad's games but may
      // not remove another member's upload from the group's shared history.
      if (game.uploadedByUserId !== actor.userId && !actor.isOwner) {
        await client.query('ROLLBACK');
        return { outcome: 'forbidden' };
      }

      await client.query(`DELETE FROM games WHERE id = $1 AND "squadId" = $2`, [gameId, squadId]);
      await client.query('COMMIT');
      return { outcome: 'deleted', screenshotUrl: game.screenshotUrl };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error({ err: rollbackErr }, 'Rollback failed after game delete error');
      }
      logger.error({ err: error, gameId, squadId }, 'Error deleting game');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Unrestricted game delete for the admin route. No squad scoping and no uploader/owner
   * check — `requireAdmin` already gates the caller, and an admin acts across all squads.
   * Mirrors deleteGameForSquad's transactional shape (FOR UPDATE, cascade delete) and returns
   * the game's squadId so the caller can rebuild that squad's aggregates and remove the
   * screenshot, exactly as the member delete path does.
   */
  async deleteGameById(
    gameId: string,
  ): Promise<
    | { outcome: 'deleted'; squadId: string; screenshotUrl: string | null }
    | { outcome: 'not_found' }
  > {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');

      const found = await client.query<{ squadId: string; screenshotUrl: string | null }>(
        `SELECT "squadId", "screenshotUrl" FROM games WHERE id = $1 FOR UPDATE`,
        [gameId],
      );
      const game = found.rows[0];
      if (!game) {
        await client.query('ROLLBACK');
        return { outcome: 'not_found' };
      }

      await client.query(`DELETE FROM games WHERE id = $1`, [gameId]);
      await client.query('COMMIT');
      return { outcome: 'deleted', squadId: game.squadId, screenshotUrl: game.screenshotUrl };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error({ err: rollbackErr }, 'Rollback failed after admin game delete error');
      }
      logger.error({ err: error, gameId }, 'Error deleting game (admin)');
      throw error;
    } finally {
      client.release();
    }
  }
}
