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
      
      const { data: { publicUrl } } = supabaseServiceRole.storage
        .from(bucket)
        .getPublicUrl(fileName);

      return publicUrl;
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
          "ftMade", "ftAttempted", "teammateGrade", "playerId", "gameIdFromFile", "createdAt", "updatedAt", "userId"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW(), NOW(), $22)
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
        playerData.teammateGrade || null,
        playerData.playerId || null,
        playerData.gameIdFromFile || null,
        playerData.userId
      ];
      
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
          "ftMade", "ftAttempted", "createdAt", "updatedAt", "userId"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW(), $18)
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
        teamData.userId
      ];
      
      const result = await pgClient.query(query, values);
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
          "totalFouls", "totalFgMade", "totalFgAttempted", "totalThreeMade", "totalThreeAttempted",
          "totalFtMade", "totalFtAttempted", "createdAt", "updatedAt", "userId"
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
        statsData.totalFgMade || 0, statsData.totalFgAttempted || 0,
        statsData.totalThreeMade || 0, statsData.totalThreeAttempted || 0,
        statsData.totalFtMade || 0, statsData.totalFtAttempted || 0,
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
          "totalFgMade" = $19,
          "totalFgAttempted" = $20,
          "totalThreeMade" = $21,
          "totalThreeAttempted" = $22,
          "totalFtMade" = $23,
          "totalFtAttempted" = $24,
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
}

export default new SupabaseService();
