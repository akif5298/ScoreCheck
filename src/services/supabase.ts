import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/supabase';
import dotenv from 'dotenv';
import { Client } from 'pg';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
// Support both old and new key names for backward compatibility
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey);

// Create a service role client for admin operations (bypasses RLS)
const supabaseServiceRole = createClient<Database>(supabaseUrl, supabaseSecretKey);

// Direct PostgreSQL connection for database operations
const pgClient = new Client({ connectionString: process.env.DATABASE_URL });

// Initialize connection
pgClient.connect().catch(console.error);

export class SupabaseService {
  // File Storage Methods
  async uploadImage(file: Buffer, fileName: string, bucket: string = 'screenshots'): Promise<string> {
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
      
      console.log(`Uploading ${fileName} with content type: ${contentType}`);
      
      // Try Supabase storage with service role (bypasses RLS)
      const { data, error } = await supabaseServiceRole.storage
        .from(bucket)
        .upload(fileName, file, {
          contentType,
          upsert: true
        });

      if (error) {
        console.error('Supabase storage upload failed:', error);
        throw error;
      }

      console.log('Supabase upload successful:', data);
      
      // For private buckets, we need to generate a signed URL
      // This creates a temporary URL that expires after 1 hour
      const { data: signedUrlData, error: signedUrlError } = await supabaseServiceRole.storage
        .from(bucket)
        .createSignedUrl(fileName, 3600); // 1 hour expiry

      if (signedUrlError) {
        console.error('Failed to generate signed URL:', signedUrlError);
        // Fallback: try to construct the URL manually
        const projectRef = process.env.SUPABASE_URL?.split('//')[1]?.split('.')[0];
        const fallbackUrl = `https://${projectRef}.supabase.co/storage/v1/object/sign/${bucket}/${fileName}`;
        console.log('🔍 Using fallback URL:', fallbackUrl);
        return fallbackUrl;
      }

      console.log('🔍 Generated signed URL:', signedUrlData.signedUrl);
      console.log('🔍 Bucket:', bucket);
      console.log('🔍 File name:', fileName);
      
      return signedUrlData.signedUrl;
    } catch (error) {
      console.error('Supabase storage upload failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to upload image to Supabase: ${errorMessage}`);
    }
  }

  async deleteImage(fileName: string, bucket: string = 'screenshots'): Promise<void> {
    try {
      // Try Supabase storage with service role (bypasses RLS)
      const { error } = await supabaseServiceRole.storage
        .from(bucket)
        .remove([fileName]);

      if (error) {
        console.error('Supabase storage delete failed:', error);
        throw error;
      }
    } catch (error) {
      console.error('Supabase storage delete failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to delete image from Supabase: ${errorMessage}`);
    }
  }

  // Database Methods using direct PostgreSQL connection
  async createUser(userData: any) {
    try {
      // First check if user with this email already exists
      const existingUserQuery = 'SELECT * FROM users WHERE email = $1';
      const existingUser = await pgClient.query(existingUserQuery, [userData.email]);
      
      if (existingUser.rows.length > 0) {
        // User exists, update their appleId if needed and return them
        const existingUserData = existingUser.rows[0];
        if (!existingUserData.appleId && userData.appleId) {
          const updateQuery = 'UPDATE users SET "appleId" = $1, "updatedAt" = NOW() WHERE id = $2 RETURNING *';
          const updateResult = await pgClient.query(updateQuery, [userData.appleId, existingUserData.id]);
          return updateResult.rows[0];
        }
        return existingUserData;
      }
      
      // Create new user
      const query = `
        INSERT INTO users (id, email, "appleId", name, role, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        RETURNING *
      `;
      const values = [userData.appleId, userData.email, userData.appleId, userData.name, userData.role || 'USER'];
      
      const result = await pgClient.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  async findUserByAppleId(appleId: string) {
    try {
      const query = 'SELECT * FROM users WHERE "appleId" = $1';
      const result = await pgClient.query(query, [appleId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error finding user by Apple ID:', error);
      return null;
    }
  }

  async updateUser(userId: string, updateData: any) {
    try {
      const fields = Object.keys(updateData).map((key, index) => `${key} = $${index + 2}`);
      const values = Object.values(updateData);
      const query = `
        UPDATE users 
        SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `;
      
      const result = await pgClient.query(query, [userId, ...values]);
      return result.rows[0];
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }

  async createGame(gameData: any) {
    try {
      const query = `
        INSERT INTO games (id, date, "homeTeam", "awayTeam", "homeScore", "awayScore", "screenshotUrl", processed, "createdAt", "updatedAt", "userId")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), $9)
        RETURNING *
      `;
      const values = [
        gameData.id || `game_${Date.now()}`,
        gameData.date,
        gameData.homeTeam,
        gameData.awayTeam,
        gameData.homeScore,
        gameData.awayScore,
        gameData.screenshotUrl || null,
        gameData.processed || false,
        gameData.userId
      ];
      
      const result = await pgClient.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating game:', error);
      throw error;
    }
  }

  async createPlayer(playerData: any) {
    try {
      const query = `
        INSERT INTO players (
          id, "gameId", name, team, position, points, rebounds, assists, steals, blocks,
          turnovers, fouls, "fgMade", "fgAttempted", "threeMade", "threeAttempted",
          "ftMade", "ftAttempted", "fg_percentage", "three_percentage", "ft_percentage",
          "teammateGrade", "playerId", "gameIdFromFile", "createdAt", "updatedAt", "userId"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, NOW(), NOW(), $25)
        RETURNING *
      `;
      const values = [
        playerData.id || `player_${Date.now()}`,
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
        playerData.userId
      ];
      
      // Debug: Log the shooting percentage data being inserted
      console.log(`🔍 Creating player ${playerData.name} with shooting percentages:`, {
        fg_percentage: playerData.fg_percentage,
        three_percentage: playerData.three_percentage,
        ft_percentage: playerData.ft_percentage,
        raw_data: {
          fgMade: playerData.fgMade,
          fgAttempted: playerData.fgAttempted,
          threeMade: playerData.threeMade,
          threeAttempted: playerData.threeAttempted,
          ftMade: playerData.ftMade,
          ftAttempted: playerData.ftAttempted
        }
      });
      
      const result = await pgClient.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating player:', error);
      throw error;
    }
  }

  async createTeam(teamData: any) {
    try {
      const query = `
        INSERT INTO teams (
          id, "gameId", name, "isHome", points, rebounds, assists, steals, blocks,
          turnovers, fouls, "fgMade", "fgAttempted", "threeMade", "threeAttempted",
          "ftMade", "ftAttempted", "fg_percentage", "three_percentage", "ft_percentage", "createdAt", "updatedAt", "userId"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW(), NOW(), $21)
        RETURNING *
      `;
      const values = [
        teamData.id || `team_${Date.now()}`,
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
        teamData.userId
      ];
      
      console.log('🔍 Creating team with data:', { id: teamData.id, name: teamData.name, gameId: teamData.gameId });
      
      const result = await pgClient.query(query, values);
      console.log('✅ Team created successfully:', result.rows[0]);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating team:', error);
      throw error;
    }
    }

  async createPlayerStats(statsData: any) {
    try {
      const query = `
        INSERT INTO player_stats (
          id, "playerName", team, "gamesPlayed", "avgPoints", "avgRebounds", "avgAssists",
          "avgSteals", "avgBlocks", "avgTurnovers", "avgFouls", "avgFgPercentage",
          "avgThreePercentage", "avgFtPercentage", "avgPlusMinus", "totalPoints",
          "totalRebounds", "totalAssists", "totalSteals", "totalBlocks", "totalTurnovers",
          "totalFouls",           "totalfgmade", "totalfgattempted", "totalthreemade", "totalthreeattempted",
          "totalftmade", "totalftattempted", "createdAt", "updatedAt", "userId"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, NOW(), NOW(), $29)
        RETURNING *
      `;
      const values = [
        statsData.id || `player_${Date.now()}`,
        statsData.name || statsData.playerName, statsData.team, 
        statsData.gamesPlayed || 1,
        statsData.avgPoints || 0, statsData.avgRebounds || 0, statsData.avgAssists || 0,
        statsData.avgSteals || 0, statsData.avgBlocks || 0, statsData.avgTurnovers || 0, 
        statsData.avgFouls || 0, 
        statsData.avgFgPercentage || 0,
        statsData.avgThreePercentage || 0,
        statsData.avgFtPercentage || 0,
        0, // avgPlusMinus
        statsData.totalPoints || 0, statsData.totalRebounds || 0, statsData.totalAssists || 0,
        statsData.totalSteals || 0, statsData.totalBlocks || 0, statsData.totalTurnovers || 0, 
        statsData.totalFouls || 0,
        statsData.fgMade || 0, statsData.fgAttempted || 0,
        statsData.threeMade || 0, statsData.threeAttempted || 0,
        statsData.ftMade || 0, statsData.ftAttempted || 0,
        statsData.userId
      ];
      
      const result = await pgClient.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating player stats:', error);
      throw error;
    }
  }

  async getPlayerStatsByPlayerName(playerName: string, userId: string) {
    try {
      const query = `
        SELECT * FROM player_stats 
        WHERE "playerName" = $1 AND "userId" = $2
      `;
      
      const result = await pgClient.query(query, [playerName, userId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting player stats by name:', error);
      return null;
    }
  }

  async updatePlayerStats(playerName: string, userId: string, updateData: any) {
    try {
      const query = `
        UPDATE player_stats 
        SET 
          "gamesPlayed" = $1,
          "avgPoints" = $2,
          "avgRebounds" = $3,
          "avgAssists" = $4,
          "avgSteals" = $5,
          "avgBlocks" = $6,
          "avgTurnovers" = $7,
          "avgFouls" = $8,
          "avgFgPercentage" = $9,
          "avgThreePercentage" = $10,
          "avgFtPercentage" = $11,
          "totalPoints" = $12,
          "totalRebounds" = $13,
          "totalAssists" = $14,
          "totalSteals" = $15,
          "totalBlocks" = $16,
          "totalTurnovers" = $17,
          "totalFouls" = $18,
          "totalfgmade" = $19,
          "totalfgattempted" = $20,
          "totalthreemade" = $21,
          "totalthreeattempted" = $22,
          "totalftmade" = $23,
          "totalftattempted" = $24,
          "updatedAt" = NOW()
        WHERE "playerName" = $25 AND "userId" = $26
        RETURNING *
      `;
      
      const values = [
        updateData.gamesPlayed,
        updateData.avgPoints,
        updateData.avgRebounds,
        updateData.avgAssists,
        updateData.avgSteals,
        updateData.avgBlocks,
        updateData.avgTurnovers,
        updateData.avgFouls,
        updateData.avgFgPercentage,
        updateData.avgThreePercentage,
        updateData.avgFtPercentage,
        updateData.totalPoints,
        updateData.totalRebounds,
        updateData.totalAssists,
        updateData.totalSteals,
        updateData.totalBlocks,
        updateData.totalTurnovers,
        updateData.totalFouls,
        updateData.totalFgMade,
        updateData.totalFgAttempted,
        updateData.totalThreeMade,
        updateData.totalThreeAttempted,
        updateData.totalFtMade,
        updateData.totalFtAttempted,
        playerName,
        userId
      ];
      
      const result = await pgClient.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('Error updating player stats:', error);
      throw error;
    }
  }

  async getPlayerStats(userId: string) {
    try {
      const query = `
        SELECT * FROM player_stats 
        WHERE "userId" = $1
        ORDER BY "totalPoints" DESC
      `;
      
      const result = await pgClient.query(query, [userId]);
      return result.rows;
    } catch (error) {
      console.error('Error getting player stats:', error);
      return [];
    }
  }

  async getGamesByUserId(userId: string) {
    try {
      const query = `
        SELECT g.*, 
               json_agg(DISTINCT p.*) as players,
               json_agg(DISTINCT t.*) as teams
        FROM games g
        LEFT JOIN players p ON g.id = p."gameId"
        LEFT JOIN teams t ON g.id = t."gameId"
        WHERE g."userId" = $1
        GROUP BY g.id
      `;
      
      const result = await pgClient.query(query, [userId]);
      return result.rows;
    } catch (error) {
      console.error('Error getting games by user ID:', error);
      return [];
    }
  }

  async getDashboardStats() {
    try {
      const query = `
        SELECT 
          COUNT(DISTINCT g.id) as total_games,
          COUNT(DISTINCT p.id) as total_players,
          COUNT(DISTINCT t.id) as total_teams
        FROM games g
        LEFT JOIN players p ON g.id = p."gameId"
        LEFT JOIN teams t ON g.id = t."gameId"
      `;
      
      const result = await pgClient.query(query);
      return result.rows[0];
    } catch (error) {
      console.error('Error getting dashboard stats:', error);
      return { total_games: 0, total_players: 0, total_teams: 0 };
    }
  }

  async getDistinctPlayerCount(userId: string): Promise<number> {
    try {
      // Count distinct players by their name column (normalized to handle case/whitespace differences)
      const query = `
        SELECT COUNT(DISTINCT LOWER(TRIM(name))) as distinct_players
        FROM players
        WHERE "userId" = $1 
          AND name IS NOT NULL 
          AND TRIM(name) != ''
      `;
      
      const result = await pgClient.query(query, [userId]);
      const count = parseInt(result.rows[0]?.distinct_players || '0', 10);
      console.log(`📊 Distinct player count for user ${userId}: ${count}`);
      return count;
    } catch (error) {
      console.error('Error getting distinct player count:', error);
      return 0;
    }
  }

  async getGameByScreenshotUrl(screenshotUrl: string, userId: string) {
    try {
      const query = `
        SELECT * FROM games 
        WHERE "screenshotUrl" = $1 AND "userId" = $2
        ORDER BY "createdAt" DESC
        LIMIT 1
      `;
      
      const result = await pgClient.query(query, [screenshotUrl, userId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting game by screenshot URL:', error);
      return null;
    }
  }

  // Player Totals Methods
  async getPlayerTotalsByPlayerName(playerName: string, userId: string) {
    try {
      const query = `
        SELECT * FROM player_totals 
        WHERE player_name = $1 AND userid = $2
      `;
      
      const result = await pgClient.query(query, [playerName, userId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting player totals by name:', error);
      return null;
    }
  }

  async getPlayerTotalsByUserId(userId: string) {
    try {
      const query = `
        SELECT * FROM player_totals 
        WHERE userid = $1
        ORDER BY player_name
      `;
      
      const result = await pgClient.query(query, [userId]);
      return result.rows;
    } catch (error) {
      console.error('Error getting player totals by user ID:', error);
      return [];
    }
  }

  async updatePlayerTotals(playerName: string, userId: string, updateData: any) {
    try {
      const query = `
        UPDATE player_totals 
        SET 
          total_games = $1,
          total_points = $2,
          total_assists = $3,
          total_rebounds = $4,
          total_steals = $5,
          total_blocks = $6,
          total_fouls = $7,
          total_turnovers = $8,
          total_fgm = $9,
          total_fga = $10,
          total_3pm = $11,
          total_3pa = $12,
          total_ftm = $13,
          total_fta = $14,
          fg_percentage = $15,
          three_percentage = $16,
          ft_percentage = $17,
          updatedat = NOW()
        WHERE player_name = $18 AND userid = $19
        RETURNING *
      `;
      
      const values = [
        updateData.total_games,
        updateData.total_points,
        updateData.total_assists,
        updateData.total_rebounds,
        updateData.total_steals,
        updateData.total_blocks,
        updateData.total_fouls,
        updateData.total_turnovers,
        updateData.total_fgm,
        updateData.total_fga,
        updateData.total_3pm,
        updateData.total_3pa,
        updateData.total_ftm,
        updateData.total_fta,
        updateData.fg_percentage,
        updateData.three_percentage,
        updateData.ft_percentage,
        playerName,
        userId
      ];
      
      const result = await pgClient.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('Error updating player totals:', error);
      throw error;
    }
  }

  async createPlayerTotals(totalsData: any) {
    try {
      const query = `
        INSERT INTO player_totals (
          id, player_id, player_name, team, total_games, total_points, total_assists,
          total_rebounds, total_steals, total_blocks, total_fouls, total_turnovers,
          total_fgm, total_fga, total_3pm, total_3pa, total_ftm, total_fta,
          fg_percentage, three_percentage, ft_percentage, createdat, updatedat, userid
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW(), NOW(), $22)
        RETURNING *
      `;
      const values = [
        totalsData.id,
        totalsData.player_id,
        totalsData.player_name,
        totalsData.team,
        totalsData.total_games || 1,
        totalsData.total_points || 0,
        totalsData.total_assists || 0,
        totalsData.total_rebounds || 0,
        totalsData.total_steals || 0,
        totalsData.total_blocks || 0,
        totalsData.total_fouls || 0,
        totalsData.total_turnovers || 0,
        totalsData.total_fgm || 0,
        totalsData.total_fga || 0,
        totalsData.total_3pm || 0,
        totalsData.total_3pa || 0,
        totalsData.total_ftm || 0,
        totalsData.total_fta || 0,
        totalsData.fg_percentage || 0.00,
        totalsData.three_percentage || 0.00,
        totalsData.ft_percentage || 0.00,
        totalsData.userid
      ];
      
      const result = await pgClient.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating player totals:', error);
      throw error;
    }
  }

  async updatePlayerStatsFromTotals(userId: string) {
    try {
      console.log('🔄 Running bulk update of player_stats with averages from player_totals for user:', userId);
      
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
          "userId",
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
          pt.userid as "userId",
          pt.total_fgm as "totalfgmade",
          pt.total_fga as "totalfgattempted",
          pt.total_3pm as "totalthreemade",
          pt.total_3pa as "totalthreeattempted",
          pt.total_ftm as "totalftmade",
          pt.total_fta as "totalftattempted"
        FROM public.player_totals pt
        WHERE pt.player_name IN ('Akif', 'Abdul', 'Anis', 'Nillan', 'Ikroop', 'Ankit', 'Dylan', 'Kashif')
        AND pt.userid = $1
        ON CONFLICT ("playerName", "userId") 
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
      
      const result = await pgClient.query(query, [userId]);
      console.log(`✅ Bulk update of player_stats completed. Rows affected: ${result.rowCount}`);
      return result;
    } catch (error) {
      console.error('Error running bulk update of player_stats from player_totals:', error);
      throw error;
    }
  }

  async startGameEdit(gameId: string) {
    try {
      // Start a transaction
      await pgClient.query('BEGIN');

      // Get the current game data
      const currentGameQuery = `
        SELECT g.*, json_agg(p.*) as players
        FROM games g
        LEFT JOIN players p ON g.id = p."gameId"
        WHERE g.id = $1
        GROUP BY g.id
      `;
      const currentGameResult = await pgClient.query(currentGameQuery, [gameId]);
      const currentGame = currentGameResult.rows[0];
      
      if (!currentGame) {
        await pgClient.query('ROLLBACK');
        return null;
      }

      // List of players we care about for totals
      const trackedPlayers = ['Akif', 'Abdul', 'Anis', 'Nillan', 'Ikroop', 'Ankit', 'Dylan', 'Kashif'];
      
      // Get current player totals for tracked players
      const currentTotalsQuery = `
        SELECT * FROM player_totals 
        WHERE player_name = ANY($1) AND userid = $2
      `;
      const currentTotalsResult = await pgClient.query(currentTotalsQuery, [trackedPlayers, currentGame.userId]);
      const currentTotals = currentTotalsResult.rows;

      // Create a map of current totals by player name
      const totalsMap = new Map();
      currentTotals.forEach((total: any) => {
        totalsMap.set(total.player_name, total);
      });

      // For each tracked player, subtract current values from totals
      const currentPlayers = currentGame.players || [];
      
      for (const playerName of trackedPlayers) {
        const currentPlayer = currentPlayers.find((p: any) => p.name === playerName);
        
        if (currentPlayer) {
          const currentTotal = totalsMap.get(playerName);
          
          if (currentTotal) {
            // Subtract current game values from totals
            const updatedTotal = {
              total_games: currentTotal.total_games - 1, // Decrease game count
              total_points: currentTotal.total_points - (currentPlayer.points || 0),
              total_rebounds: currentTotal.total_rebounds - (currentPlayer.rebounds || 0),
              total_assists: currentTotal.total_assists - (currentPlayer.assists || 0),
              total_steals: currentTotal.total_steals - (currentPlayer.steals || 0),
              total_blocks: currentTotal.total_blocks - (currentPlayer.blocks || 0),
              total_fouls: currentTotal.total_fouls - (currentPlayer.fouls || 0),
              total_turnovers: currentTotal.total_turnovers - (currentPlayer.turnovers || 0),
              total_fgm: currentTotal.total_fgm - (currentPlayer.fgMade || 0),
              total_fga: currentTotal.total_fga - (currentPlayer.fgAttempted || 0),
              total_3pm: currentTotal.total_3pm - (currentPlayer.threeMade || 0),
              total_3pa: currentTotal.total_3pa - (currentPlayer.threeAttempted || 0),
              total_ftm: currentTotal.total_ftm - (currentPlayer.ftMade || 0),
              total_fta: currentTotal.total_fta - (currentPlayer.ftAttempted || 0),
              fg_percentage: 0,
              three_percentage: 0,
              ft_percentage: 0
            } as any;

            // Recalculate percentages
            updatedTotal.fg_percentage = updatedTotal.total_fga > 0 ? 
              Math.round((updatedTotal.total_fgm / updatedTotal.total_fga) * 1000) / 10 : 0;
            updatedTotal.three_percentage = updatedTotal.total_3pa > 0 ? 
              Math.round((updatedTotal.total_3pm / updatedTotal.total_3pa) * 1000) / 10 : 0;
            updatedTotal.ft_percentage = updatedTotal.total_fta > 0 ? 
              Math.round((updatedTotal.total_ftm / updatedTotal.total_fta) * 1000) / 10 : 0;

            // Update the player totals
            const updateTotalQuery = `
              UPDATE player_totals 
              SET 
                total_games = $1,
                total_points = $2, total_rebounds = $3, total_assists = $4, total_steals = $5,
                total_blocks = $6, total_fouls = $7, total_turnovers = $8, total_fgm = $9,
                total_fga = $10, total_3pm = $11, total_3pa = $12, total_ftm = $13,
                total_fta = $14, fg_percentage = $15, three_percentage = $16, ft_percentage = $17,
                updatedat = NOW()
              WHERE player_name = $18 AND userid = $19
            `;
            
            await pgClient.query(updateTotalQuery, [
              updatedTotal.total_games,
              updatedTotal.total_points, updatedTotal.total_rebounds, updatedTotal.total_assists,
              updatedTotal.total_steals, updatedTotal.total_blocks, updatedTotal.total_fouls,
              updatedTotal.total_turnovers, updatedTotal.total_fgm, updatedTotal.total_fga,
              updatedTotal.total_3pm, updatedTotal.total_3pa, updatedTotal.total_ftm,
              updatedTotal.total_fta, updatedTotal.fg_percentage, updatedTotal.three_percentage,
              updatedTotal.ft_percentage, playerName, currentGame.userId
            ]);
          }
        }
      }

      // Commit the transaction
      await pgClient.query('COMMIT');
      
      return { success: true, message: 'Game edit started, totals subtracted' };
    } catch (error) {
      // Rollback on error
      await pgClient.query('ROLLBACK');
      console.error('Error starting game edit:', error);
      throw error;
    }
  }

  async updateGame(gameId: string, updateData: any) {
    try {
      // Start a transaction
      await pgClient.query('BEGIN');

      // First, get the current game data to see what we're replacing
      const currentGameQuery = `
        SELECT g.*, json_agg(p.*) as players
        FROM games g
        LEFT JOIN players p ON g.id = p."gameId"
        WHERE g.id = $1
        GROUP BY g.id
      `;
      const currentGameResult = await pgClient.query(currentGameQuery, [gameId]);
      const currentGame = currentGameResult.rows[0];
      
      if (!currentGame) {
        await pgClient.query('ROLLBACK');
        return null;
      }

      // List of players we care about for totals
      const trackedPlayers = ['Akif', 'Abdul', 'Anis', 'Nillan', 'Ikroop', 'Ankit', 'Dylan', 'Kashif'];
      
      // Get current player totals for tracked players
      const currentTotalsQuery = `
        SELECT * FROM player_totals 
        WHERE player_name = ANY($1) AND userid = $2
      `;
      const currentTotalsResult = await pgClient.query(currentTotalsQuery, [trackedPlayers, currentGame.userId]);
      const currentTotals = currentTotalsResult.rows;

      // Create a map of current totals by player name
      const totalsMap = new Map();
      currentTotals.forEach((total: any) => {
        totalsMap.set(total.player_name, total);
      });

      // Calculate the differences for tracked players
      const currentPlayers = currentGame.players || [];
      const newPlayers = updateData.players;
      
      // For each tracked player, subtract old values and add new values
      for (const playerName of trackedPlayers) {
        const currentPlayer = currentPlayers.find((p: any) => p.name === playerName);
        const newPlayer = newPlayers.find((p: any) => p.name === playerName);
        
        if (currentPlayer || newPlayer) {
          const currentTotal = totalsMap.get(playerName);
          
          if (currentTotal) {
            // Player exists in totals, update them
            const oldValues = currentPlayer || {
              points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0,
              fouls: 0, turnovers: 0, fgMade: 0, fgAttempted: 0,
              threeMade: 0, threeAttempted: 0, ftMade: 0, ftAttempted: 0
            };
            
            const newValues = newPlayer || {
              points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0,
              fouls: 0, turnovers: 0, fgMade: 0, fgAttempted: 0,
              threeMade: 0, threeAttempted: 0, ftMade: 0, ftAttempted: 0
            };

            // Calculate new totals: subtract old, add new
            const updatedTotal = {
              total_games: currentTotal.total_games, // Keep same game count
              total_points: currentTotal.total_points - (oldValues.points || 0) + (newValues.points || 0),
              total_rebounds: currentTotal.total_rebounds - (oldValues.rebounds || 0) + (newValues.rebounds || 0),
              total_assists: currentTotal.total_assists - (oldValues.assists || 0) + (newValues.assists || 0),
              total_steals: currentTotal.total_steals - (oldValues.steals || 0) + (newValues.steals || 0),
              total_blocks: currentTotal.total_blocks - (oldValues.blocks || 0) + (newValues.blocks || 0),
              total_fouls: currentTotal.total_fouls - (oldValues.fouls || 0) + (newValues.fouls || 0),
              total_turnovers: currentTotal.total_turnovers - (oldValues.turnovers || 0) + (newValues.turnovers || 0),
              total_fgm: currentTotal.total_fgm - (oldValues.fgMade || 0) + (newValues.fgMade || 0),
              total_fga: currentTotal.total_fga - (oldValues.fgAttempted || 0) + (newValues.fgAttempted || 0),
              total_3pm: currentTotal.total_3pm - (oldValues.threeMade || 0) + (newValues.threeMade || 0),
              total_3pa: currentTotal.total_3pa - (oldValues.threeAttempted || 0) + (newValues.threeAttempted || 0),
              total_ftm: currentTotal.total_ftm - (oldValues.ftMade || 0) + (newValues.ftMade || 0),
              total_fta: currentTotal.total_fta - (oldValues.ftAttempted || 0) + (newValues.ftAttempted || 0),
              fg_percentage: 0,
              three_percentage: 0,
              ft_percentage: 0
            } as any;

            // Calculate new percentages
            updatedTotal.fg_percentage = updatedTotal.total_fga > 0 ? 
              Math.round((updatedTotal.total_fgm / updatedTotal.total_fga) * 1000) / 10 : 0;
            updatedTotal.three_percentage = updatedTotal.total_3pa > 0 ? 
              Math.round((updatedTotal.total_3pm / updatedTotal.total_3pa) * 1000) / 10 : 0;
            updatedTotal.ft_percentage = updatedTotal.total_fta > 0 ? 
              Math.round((updatedTotal.total_ftm / updatedTotal.total_fta) * 1000) / 10 : 0;

            // Update the player totals
            const updateTotalQuery = `
              UPDATE player_totals 
              SET 
                total_points = $1, total_rebounds = $2, total_assists = $3, total_steals = $4,
                total_blocks = $5, total_fouls = $6, total_turnovers = $7, total_fgm = $8,
                total_fga = $9, total_3pm = $10, total_3pa = $11, total_ftm = $12,
                total_fta = $13, fg_percentage = $14, three_percentage = $15, ft_percentage = $16,
                updatedat = NOW()
              WHERE player_name = $17 AND userid = $18
            `;
            
            await pgClient.query(updateTotalQuery, [
              updatedTotal.total_points, updatedTotal.total_rebounds, updatedTotal.total_assists,
              updatedTotal.total_steals, updatedTotal.total_blocks, updatedTotal.total_fouls,
              updatedTotal.total_turnovers, updatedTotal.total_fgm, updatedTotal.total_fga,
              updatedTotal.total_3pm, updatedTotal.total_3pa, updatedTotal.total_ftm,
              updatedTotal.total_fta, updatedTotal.fg_percentage, updatedTotal.three_percentage,
              updatedTotal.ft_percentage, playerName, currentGame.userId
            ]);
          }
        }
      }

      // Update the game record
      const updateGameQuery = `
        UPDATE games 
        SET 
          "homeTeam" = $1,
          "awayTeam" = $2,
          "homeScore" = $3,
          "awayScore" = $4,
          "date" = $5,
          "updatedAt" = NOW()
        WHERE id = $6
        RETURNING *
      `;
      
      const gameValues = [
        updateData.homeTeam,
        updateData.awayTeam,
        updateData.homeScore,
        updateData.awayScore,
        updateData.date,
        gameId
      ];
      
      const gameResult = await pgClient.query(updateGameQuery, gameValues);
      
      if (gameResult.rows.length === 0) {
        await pgClient.query('ROLLBACK');
        return null;
      }

      // Delete existing players for this game
      await pgClient.query('DELETE FROM players WHERE "gameId" = $1', [gameId]);

      // Note: player_totals table stores cumulative totals across games, not per-game totals
      // No need to delete from player_totals when updating a game

      // Delete existing teams for this game
      await pgClient.query('DELETE FROM teams WHERE "gameId" = $1', [gameId]);

      // Insert updated players
      for (const player of updateData.players) {
        const insertPlayerQuery = `
          INSERT INTO players (
            id, "gameId", name, team, "teammateGrade", points, rebounds, assists,
            steals, blocks, fouls, turnovers, "fgMade", "fgAttempted", "threeMade",
            "threeAttempted", "ftMade", "ftAttempted", "gameIdFromFile", "playerId", "position", "userId", "fg_percentage", "three_percentage", "ft_percentage", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, NOW(), NOW()
          )
        `;
        
        const playerValues = [
          player.id || `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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
          player.gameIdFromFile || gameId, // Use gameId as fallback
          player.playerId || `${gameId}-${Math.random().toString(36).substr(2, 3)}`, // Generate player ID
          player.position || 'Unknown', // Default position
          updateData.userId || currentGame.userId, // userId
          // Calculate percentages
          (player.fgAttempted || 0) > 0 ? Math.round(((player.fgMade || 0) / (player.fgAttempted || 0)) * 1000) / 10 : 0,
          (player.threeAttempted || 0) > 0 ? Math.round(((player.threeMade || 0) / (player.threeAttempted || 0)) * 1000) / 10 : 0,
          (player.ftAttempted || 0) > 0 ? Math.round(((player.ftMade || 0) / (player.ftAttempted || 0)) * 1000) / 10 : 0
        ];
        
        await pgClient.query(insertPlayerQuery, playerValues);
      }

      // Note: player_totals table stores cumulative player statistics across games, not team totals
      // Team totals for this specific game are handled by the teams table
      // Individual player totals will be updated separately through the player_totals update logic

      // Calculate and insert team totals for this game
      const homeTeam = updateData.homeTeam;
      const awayTeam = updateData.awayTeam;
      
      // Group players by team
      const homePlayers = updateData.players.filter((p: any) => p.team === homeTeam);
      const awayPlayers = updateData.players.filter((p: any) => p.team === awayTeam);

      // Calculate home team totals
      if (homePlayers.length > 0) {
        const homeTotals = {
          team: homeTeam,
          totalPoints: homePlayers.reduce((sum: number, p: any) => sum + (p.points || 0), 0),
          totalRebounds: homePlayers.reduce((sum: number, p: any) => sum + (p.rebounds || 0), 0),
          totalAssists: homePlayers.reduce((sum: number, p: any) => sum + (p.assists || 0), 0),
          totalSteals: homePlayers.reduce((sum: number, p: any) => sum + (p.steals || 0), 0),
          totalBlocks: homePlayers.reduce((sum: number, p: any) => sum + (p.blocks || 0), 0),
          totalFouls: homePlayers.reduce((sum: number, p: any) => sum + (p.fouls || 0), 0),
          totalTurnovers: homePlayers.reduce((sum: number, p: any) => sum + (p.turnovers || 0), 0),
          totalFgMade: homePlayers.reduce((sum: number, p: any) => sum + (p.fgMade || 0), 0),
          totalFgAttempted: homePlayers.reduce((sum: number, p: any) => sum + (p.fgAttempted || 0), 0),
          totalThreeMade: homePlayers.reduce((sum: number, p: any) => sum + (p.threeMade || 0), 0),
          totalThreeAttempted: homePlayers.reduce((sum: number, p: any) => sum + (p.threeAttempted || 0), 0),
          totalFtMade: homePlayers.reduce((sum: number, p: any) => sum + (p.ftMade || 0), 0),
          totalFtAttempted: homePlayers.reduce((sum: number, p: any) => sum + (p.ftAttempted || 0), 0),
        };

        const insertHomeTeamQuery = `
          INSERT INTO teams (
            id, name, "isHome", points, rebounds, assists, steals, blocks,
            turnovers, fouls, "fgMade", "fgAttempted", "threeMade", "threeAttempted",
            "ftMade", "ftAttempted", "fg_percentage", "three_percentage", "ft_percentage",
            "createdAt", "updatedAt", "gameId", "userId"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
        `;

        const homeTeamValues = [
          `team_${Date.now()}_home`,
          homeTotals.team,
          true, // isHome
          homeTotals.totalPoints,
          homeTotals.totalRebounds,
          homeTotals.totalAssists,
          homeTotals.totalSteals,
          homeTotals.totalBlocks,
          homeTotals.totalTurnovers,
          homeTotals.totalFouls,
          homeTotals.totalFgMade,
          homeTotals.totalFgAttempted,
          homeTotals.totalThreeMade,
          homeTotals.totalThreeAttempted,
          homeTotals.totalFtMade,
          homeTotals.totalFtAttempted,
          homeTotals.totalFgAttempted > 0 ? Math.round((homeTotals.totalFgMade / homeTotals.totalFgAttempted) * 1000) / 10 : 0,
          homeTotals.totalThreeAttempted > 0 ? Math.round((homeTotals.totalThreeMade / homeTotals.totalThreeAttempted) * 1000) / 10 : 0,
          homeTotals.totalFtAttempted > 0 ? Math.round((homeTotals.totalFtMade / homeTotals.totalFtAttempted) * 1000) / 10 : 0,
          new Date().toISOString(), // createdAt
          new Date().toISOString(), // updatedAt
          gameId,
          updateData.userId || currentGame.userId
        ];

        await pgClient.query(insertHomeTeamQuery, homeTeamValues);
      }

      // Calculate away team totals
      if (awayPlayers.length > 0) {
        const awayTotals = {
          team: awayTeam,
          totalPoints: awayPlayers.reduce((sum: number, p: any) => sum + (p.points || 0), 0),
          totalRebounds: awayPlayers.reduce((sum: number, p: any) => sum + (p.rebounds || 0), 0),
          totalAssists: awayPlayers.reduce((sum: number, p: any) => sum + (p.assists || 0), 0),
          totalSteals: awayPlayers.reduce((sum: number, p: any) => sum + (p.steals || 0), 0),
          totalBlocks: awayPlayers.reduce((sum: number, p: any) => sum + (p.blocks || 0), 0),
          totalFouls: awayPlayers.reduce((sum: number, p: any) => sum + (p.fouls || 0), 0),
          totalTurnovers: awayPlayers.reduce((sum: number, p: any) => sum + (p.turnovers || 0), 0),
          totalFgMade: awayPlayers.reduce((sum: number, p: any) => sum + (p.fgMade || 0), 0),
          totalFgAttempted: awayPlayers.reduce((sum: number, p: any) => sum + (p.fgAttempted || 0), 0),
          totalThreeMade: awayPlayers.reduce((sum: number, p: any) => sum + (p.threeMade || 0), 0),
          totalThreeAttempted: awayPlayers.reduce((sum: number, p: any) => sum + (p.threeAttempted || 0), 0),
          totalFtMade: awayPlayers.reduce((sum: number, p: any) => sum + (p.ftMade || 0), 0),
          totalFtAttempted: awayPlayers.reduce((sum: number, p: any) => sum + (p.ftAttempted || 0), 0),
        };

        const insertAwayTeamQuery = `
          INSERT INTO teams (
            id, name, "isHome", points, rebounds, assists, steals, blocks,
            turnovers, fouls, "fgMade", "fgAttempted", "threeMade", "threeAttempted",
            "ftMade", "ftAttempted", "fg_percentage", "three_percentage", "ft_percentage",
            "createdAt", "updatedAt", "gameId", "userId"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
        `;

        const awayTeamValues = [
          `team_${Date.now()}_away`,
          awayTotals.team,
          false, // isHome
          awayTotals.totalPoints,
          awayTotals.totalRebounds,
          awayTotals.totalAssists,
          awayTotals.totalSteals,
          awayTotals.totalBlocks,
          awayTotals.totalTurnovers,
          awayTotals.totalFouls,
          awayTotals.totalFgMade,
          awayTotals.totalFgAttempted,
          awayTotals.totalThreeMade,
          awayTotals.totalThreeAttempted,
          awayTotals.totalFtMade,
          awayTotals.totalFtAttempted,
          awayTotals.totalFgAttempted > 0 ? Math.round((awayTotals.totalFgMade / awayTotals.totalFgAttempted) * 1000) / 10 : 0,
          awayTotals.totalThreeAttempted > 0 ? Math.round((awayTotals.totalThreeMade / awayTotals.totalThreeAttempted) * 1000) / 10 : 0,
          awayTotals.totalFtAttempted > 0 ? Math.round((awayTotals.totalFtMade / awayTotals.totalFtAttempted) * 1000) / 10 : 0,
          new Date().toISOString(), // createdAt
          new Date().toISOString(), // updatedAt
          gameId,
          updateData.userId || currentGame.userId
        ];

        await pgClient.query(insertAwayTeamQuery, awayTeamValues);
      }

      // Run the SQL query to update player_stats/averages
      const updatePlayerStatsQuery = `
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
          "userId",
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
          pt.userid as "userId",
          pt.total_fgm as "totalfgmade",
          pt.total_fga as "totalfgattempted",
          pt.total_3pm as "totalthreemade",
          pt.total_3pa as "totalthreeattempted",
          pt.total_ftm as "totalftmade",
          pt.total_fta as "totalftattempted"
        FROM public.player_totals pt
        WHERE pt.player_name IN ('Akif', 'Abdul', 'Anis', 'Nillan', 'Ikroop', 'Ankit', 'Dylan', 'Kashif')
        ON CONFLICT ("playerName", "userId") 
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
          "updatedAt" = CURRENT_TIMESTAMP;
      `;

      await pgClient.query(updatePlayerStatsQuery);

      // Commit the transaction
      await pgClient.query('COMMIT');

      // Return the updated game with players
      const updatedGame = await this.getGameById(gameId);
      return updatedGame;
    } catch (error) {
      // Rollback on error
      await pgClient.query('ROLLBACK');
      console.error('Error updating game:', error);
      throw error;
    }
  }

  async getGameById(gameId: string) {
    try {
      const query = `
        SELECT g.*, 
               json_agg(DISTINCT p.*) as players,
               json_agg(DISTINCT t.*) as teams
        FROM games g
        LEFT JOIN players p ON g.id = p."gameId"
        LEFT JOIN teams t ON g.id = t."gameId"
        WHERE g.id = $1
        GROUP BY g.id
      `;
      
      const result = await pgClient.query(query, [gameId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting game by ID:', error);
      return null;
    }
  }
}

export default new SupabaseService();
