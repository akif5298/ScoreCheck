import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/supabase';
import dotenv from 'dotenv';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { randomUUID } from 'node:crypto';
import logger from '@/utils/logger';
import { hammingDistance, DUPLICATE_HAMMING_THRESHOLD } from '@/utils/imageHash';

// Minimal shape shared by pg.Pool and a checked-out pg.PoolClient, so CRUD
// helpers can run either on the pool (default) or inside a transaction's
// dedicated client when one is passed in.
export interface Queryable {
  query<R extends QueryResultRow = any>(
    text: string,
    values?: any[],
  ): Promise<QueryResult<R>>;
}

// Raised when a save is aborted because the squad already holds a perceptually
// identical screenshot. Carries the winning game's id so the caller can return it
// instead of an error — from the user's point of view the game is present, which is
// what they wanted. Distinguishable from a genuine failure by `instanceof`, so the
// route does not report a 500 for what is a successful no-op.
export class DuplicateGameError extends Error {
  constructor(public readonly existingGameId: string) {
    super(`Game already exists in this squad (${existingGameId})`);
    this.name = 'DuplicateGameError';
  }
}

// Arbitrary but fixed first key for squad-save advisory locks. Two-key form so these
// locks share no space with any other advisory lock added later.
//
// Exported because moving games between squads runs the same duplicate check against the
// target squad and must serialise against concurrent saves into it. Both paths have to
// take the lock in the SAME namespace or they would not exclude each other at all.
export const SQUAD_SAVE_LOCK_NAMESPACE = 0x5343;

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
// Support both old and new key names for backward compatibility
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey);

// Create a service role client for admin operations (bypasses RLS)
const supabaseServiceRole = createClient<Database>(supabaseUrl, supabaseSecretKey);

// Connection pool for all database operations. A pool (vs a single Client)
// survives dropped connections and serves concurrent requests without
// serializing them on one socket. Transactions check out a dedicated client
// via pgPool.connect(); everything else uses pgPool.query() directly.
export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.PG_POOL_MAX || '10', 10),
});

// Surface background pool errors (e.g. a backend terminating an idle client)
// instead of crashing the process.
pgPool.on('error', (err) => logger.error({ err }, 'Unexpected PostgreSQL pool error'));

// Rebuilds player_totals for one squad directly from its per-game `players` rows.
// Adapted from RECOMPUTE_TOTALS_SQL in scripts/import-labeled-data.ts, re-scoped from
// userId to squadId. That SQL was verified against production: rebuilding with it
// reproduced the stored totals for all 8 tracked players exactly.
const RECOMPUTE_TOTALS_SQL = `
  INSERT INTO player_totals (
    id, player_id, player_name, team, total_games,
    total_points, total_rebounds, total_assists, total_steals, total_blocks,
    total_fouls, total_turnovers,
    total_fgm, total_fga, total_3pm, total_3pa, total_ftm, total_fta,
    fg_percentage, three_percentage, ft_percentage,
    squadid, createdat, updatedat
  )
  SELECT
    gen_random_uuid()::text, gen_random_uuid()::text, p.name, MAX(p.team),
    COUNT(DISTINCT p."gameId"),
    SUM(p.points), SUM(p.rebounds), SUM(p.assists), SUM(p.steals), SUM(p.blocks),
    SUM(p.fouls), SUM(p.turnovers),
    SUM(p."fgMade"), SUM(p."fgAttempted"), SUM(p."threeMade"), SUM(p."threeAttempted"),
    SUM(p."ftMade"), SUM(p."ftAttempted"),
    CASE WHEN SUM(p."fgAttempted") > 0
      THEN ROUND(SUM(p."fgMade")::numeric / SUM(p."fgAttempted") * 100, 2) ELSE 0 END,
    CASE WHEN SUM(p."threeAttempted") > 0
      THEN ROUND(SUM(p."threeMade")::numeric / SUM(p."threeAttempted") * 100, 2) ELSE 0 END,
    CASE WHEN SUM(p."ftAttempted") > 0
      THEN ROUND(SUM(p."ftMade")::numeric / SUM(p."ftAttempted") * 100, 2) ELSE 0 END,
    $1, NOW(), NOW()
  FROM players p
  WHERE p."squadId" = $1
    AND p.name IN (SELECT DISTINCT "displayName" FROM player_mappings WHERE "squadId" = $1)
  GROUP BY p.name
`;

const SCREENSHOT_BUCKET = 'screenshots';
// Signed-URL lifetime when serving a screenshot for viewing. Minted fresh on
// every read, so short is fine — this is not what's persisted in the DB.
const SIGNED_URL_TTL_SECONDS = 3600;

export class SupabaseService {
  // File Storage Methods
  //
  // Screenshots live in Supabase Storage. We persist the object PATH (e.g.
  // "<userId>-1-boxscore.jpg") in games.screenshotUrl — never a signed URL,
  // which would expire — and mint a fresh signed URL at read time via
  // getSignedUrl().
  async uploadImage(file: Buffer, fileName: string, bucket: string = SCREENSHOT_BUCKET): Promise<string> {
    try {
      // Detect MIME type from file extension
      const fileExtension = fileName.split('.').pop()?.toLowerCase();
      let contentType = 'image/jpeg'; // default

      if (fileExtension === 'png') {
        contentType = 'image/png';
      } else if (fileExtension === 'gif') {
        contentType = 'image/gif';
      } else if (fileExtension === 'jpg' || fileExtension === 'jpeg') {
        contentType = 'image/jpeg';
      }

      // Service-role client bypasses RLS
      const { error } = await supabaseServiceRole.storage
        .from(bucket)
        .upload(fileName, file, {
          contentType,
          upsert: true,
        });

      if (error) {
        logger.error({ err: error }, 'Supabase storage upload failed');
        throw error;
      }

      // Return the object path; the caller persists this, not a signed URL.
      return fileName;
    } catch (error) {
      logger.error({ err: error }, 'Supabase storage upload failed');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to upload image to Supabase: ${errorMessage}`);
    }
  }

  // Mints a short-lived signed URL for a stored object path. Returns null when
  // the path is empty or Supabase can't sign it (e.g. object was deleted).
  async getSignedUrl(
    objectPath: string,
    bucket: string = SCREENSHOT_BUCKET,
    expiresIn: number = SIGNED_URL_TTL_SECONDS,
  ): Promise<string | null> {
    if (!objectPath) return null;
    // Legacy rows may still hold a full URL or a base64 data URI; pass those
    // through unchanged rather than trying to sign them.
    if (objectPath.startsWith('http') || objectPath.startsWith('data:')) {
      return objectPath;
    }
    try {
      const { data, error } = await supabaseServiceRole.storage
        .from(bucket)
        .createSignedUrl(objectPath, expiresIn);
      if (error || !data) {
        logger.error({ err: error, objectPath }, 'Failed to generate signed URL');
        return null;
      }
      return data.signedUrl;
    } catch (error) {
      logger.error({ err: error, objectPath }, 'Failed to generate signed URL');
      return null;
    }
  }

  async deleteImage(fileName: string, bucket: string = 'screenshots'): Promise<void> {
    try {
      // Try Supabase storage with service role (bypasses RLS)
      const { error } = await supabaseServiceRole.storage
        .from(bucket)
        .remove([fileName]);

      if (error) {
        logger.error({ err: error }, 'Supabase storage delete failed');
        throw error;
      }
    } catch (error) {
      logger.error({ err: error }, 'Supabase storage delete failed');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to delete image from Supabase: ${errorMessage}`);
    }
  }

  // Database Methods using direct PostgreSQL connection
  // Accepts a transaction client so signup can create the user and their personal squad
  // atomically — a user without a personal squad has no resolvable scope.
  async createLocalUser(
    userData: { email: string; name: string | null; passwordHash: string },
    db: Queryable = pgPool,
  ) {
    const query = `
      INSERT INTO users (id, email, name, role, "passwordHash", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, LOWER($1), $2, 'USER', $3, NOW(), NOW())
      RETURNING *
    `;
    const result = await db.query(query, [userData.email, userData.name, userData.passwordHash]);
    return result.rows[0];
  }

  async findUserByEmail(email: string) {
    const result = await pgPool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    return result.rows[0] || null;
  }

  async findUserById(userId: string) {
    const result = await pgPool.query('SELECT * FROM users WHERE id = $1', [userId]);
    return result.rows[0] || null;
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await pgPool.query(
      'UPDATE users SET "passwordHash" = $2, "updatedAt" = NOW() WHERE id = $1',
      [userId, passwordHash],
    );
  }

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

  // Player Totals Methods
  async updatePlayerStatsFromTotals(squadId: string, allowedNames: string[], db: Queryable = pgPool) {
    if (allowedNames.length === 0) return { rowCount: 0 };
    try {
      const query = `
        INSERT INTO public.player_stats (
          id,
          "playerName",
          team,
          "gamesPlayed",
          "avgPoints",
          "avgRebounds",
          "avgAssists",
          "avgSteals",
          "avgBlocks",
          "avgTurnovers",
          "avgFouls",
          "avgFgPercentage",
          "avgThreePercentage",
          "avgFtPercentage",
          "avgPlusMinus",
          "totalPoints",
          "totalRebounds",
          "totalAssists",
          "totalSteals",
          "totalBlocks",
          "totalTurnovers",
          "totalFouls",
          "createdAt",
          "updatedAt",
          "squadId",
          "totalfgmade",
          "totalfgattempted",
          "totalthreemade",
          "totalthreeattempted",
          "totalftmade",
          "totalftattempted"
        )
        SELECT 
          gen_random_uuid()::text as id,
          pt.player_name as "playerName",
          pt.team,
          pt.total_games as "gamesPlayed",
          CASE 
            WHEN pt.total_games > 0 THEN 
              ROUND((pt.total_points::numeric / pt.total_games), 2)
            ELSE 0.00 
          END as "avgPoints",
          CASE 
            WHEN pt.total_games > 0 THEN 
              ROUND((pt.total_rebounds::numeric / pt.total_games), 2)
            ELSE 0.00 
          END as "avgRebounds",
          CASE 
            WHEN pt.total_games > 0 THEN 
              ROUND((pt.total_assists::numeric / pt.total_games), 2)
            ELSE 0.00 
          END as "avgAssists",
          CASE 
            WHEN pt.total_games > 0 THEN 
              ROUND((pt.total_steals::numeric / pt.total_games), 2)
            ELSE 0.00 
          END as "avgSteals",
          CASE 
            WHEN pt.total_games > 0 THEN 
              ROUND((pt.total_blocks::numeric / pt.total_games), 2)
            ELSE 0.00 
          END as "avgBlocks",
          CASE 
            WHEN pt.total_games > 0 THEN 
              ROUND((pt.total_turnovers::numeric / pt.total_games), 2)
            ELSE 0.00 
          END as "avgTurnovers",
          CASE 
            WHEN pt.total_games > 0 THEN 
              ROUND((pt.total_fouls::numeric / pt.total_games), 2)
            ELSE 0.00 
          END as "avgFouls",
          pt.fg_percentage as "avgFgPercentage",
          pt.three_percentage as "avgThreePercentage",
          pt.ft_percentage as "avgFtPercentage",
          0.00 as "avgPlusMinus",
          pt.total_points as "totalPoints",
          pt.total_rebounds as "totalRebounds",
          pt.total_assists as "totalAssists",
          pt.total_steals as "totalSteals",
          pt.total_blocks as "totalBlocks",
          pt.total_turnovers as "totalTurnovers",
          pt.total_fouls as "totalFouls",
          CURRENT_TIMESTAMP as "createdAt",
          CURRENT_TIMESTAMP as "updatedAt",
          pt.squadid as "squadId",
          pt.total_fgm as "totalfgmade",
          pt.total_fga as "totalfgattempted",
          pt.total_3pm as "totalthreemade",
          pt.total_3pa as "totalthreeattempted",
          pt.total_ftm as "totalftmade",
          pt.total_fta as "totalftattempted"
        FROM public.player_totals pt
        WHERE pt.player_name = ANY($2)
        AND pt.squadid = $1
        ON CONFLICT ("playerName", "squadId")
        DO UPDATE SET
          team = EXCLUDED.team,
          "gamesPlayed" = EXCLUDED."gamesPlayed",
          "avgPoints" = EXCLUDED."avgPoints",
          "avgRebounds" = EXCLUDED."avgRebounds",
          "avgAssists" = EXCLUDED."avgAssists",
          "avgSteals" = EXCLUDED."avgSteals",
          "avgBlocks" = EXCLUDED."avgBlocks",
          "avgTurnovers" = EXCLUDED."avgTurnovers",
          "avgFouls" = EXCLUDED."avgFouls",
          "avgFgPercentage" = EXCLUDED."avgFgPercentage",
          "avgThreePercentage" = EXCLUDED."avgThreePercentage",
          "avgFtPercentage" = EXCLUDED."avgFtPercentage",
          "totalPoints" = EXCLUDED."totalPoints",
          "totalRebounds" = EXCLUDED."totalRebounds",
          "totalAssists" = EXCLUDED."totalAssists",
          "totalSteals" = EXCLUDED."totalSteals",
          "totalBlocks" = EXCLUDED."totalBlocks",
          "totalTurnovers" = EXCLUDED."totalTurnovers",
          "totalFouls" = EXCLUDED."totalFouls",
          "totalfgmade" = EXCLUDED."totalfgmade",
          "totalfgattempted" = EXCLUDED."totalfgattempted",
          "totalthreemade" = EXCLUDED."totalthreemade",
          "totalthreeattempted" = EXCLUDED."totalthreeattempted",
          "totalftmade" = EXCLUDED."totalftmade",
          "totalftattempted" = EXCLUDED."totalftattempted",
          "updatedAt" = CURRENT_TIMESTAMP
      `;

      const result = await db.query(query, [squadId, allowedNames]);
      return result;
    } catch (error) {
      logger.error({ err: error }, 'Error running bulk update of player_stats from player_totals');
      throw error;
    }
  }

  /**
   * Rebuilds a squad's aggregates from its per-game `players` rows.
   *
   * Replaces the previous incremental delta logic, which only ever ADDED: there was no
   * decrement path, so moving or deleting a game left that scope's totals overstated.
   * The old `startGameEdit` (removed with this change) subtracted a game's stats up front
   * with no way to restore them if the edit was abandoned, and double-subtracted when the
   * edit did complete. A full rebuild is idempotent and provably matches the source rows —
   * verified against production, where rebuilding reproduced the stored totals for all
   * 8 tracked players exactly.
   *
   * Scoped to ONE squad. NOTE: scripts/import-labeled-data.ts deletes these tables with no
   * WHERE clause; that is only safe for a single-user import and must never be copied here.
   */
  async recomputeSquadAggregates(squadId: string, db: Queryable = pgPool) {
    await db.query('DELETE FROM player_stats WHERE "squadId" = $1', [squadId]);
    await db.query('DELETE FROM player_totals WHERE squadid = $1', [squadId]);
    await db.query(RECOMPUTE_TOTALS_SQL, [squadId]);

    // Only mapped display names accrue stats (see mappingService.getAllowedNamesForSquad).
    const allowed = await db.query<{ displayName: string }>(
      'SELECT DISTINCT "displayName" FROM player_mappings WHERE "squadId" = $1',
      [squadId],
    );
    const allowedNames = allowed.rows.map((r) => r.displayName);
    if (allowedNames.length > 0) {
      await this.updatePlayerStatsFromTotals(squadId, allowedNames, db);
    }
    return { players: allowedNames.length };
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

export default new SupabaseService();
