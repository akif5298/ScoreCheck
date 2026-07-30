/**
 * Squad aggregate rebuilds — player_totals and player_stats.
 *
 * Third link in the composition chain. Sits BELOW games deliberately: updateGame calls
 * this.recomputeSquadAggregates, so aggregates has to be in place before games extends it.
 * See the note in storage.ts for why the chain is `extends`.
 *
 * These two rebuild both tables in bulk from the per-game `players` rows. They replaced
 * the old incremental delta helpers wholesale, which is why full recomputation is the only
 * write path here — there is no add-one-game shortcut to keep in step.
 */
import { pgPool, type Queryable } from './client';
import { UsersService } from './users';
import logger from '@/utils/logger';

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

export class AggregatesService extends UsersService {
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
}
