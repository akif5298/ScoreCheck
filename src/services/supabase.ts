import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/supabase';
import dotenv from 'dotenv';
import { Client } from 'pg';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

// Create a service role client for admin operations (bypasses RLS)
const supabaseServiceRole = createClient<Database>(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!);

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
}

export default new SupabaseService();
