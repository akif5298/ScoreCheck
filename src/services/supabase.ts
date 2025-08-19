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
          "totalFouls", "createdAt", "updatedAt", "userId"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW(), NOW(), $23)
        RETURNING *
      `;
      const values = [
        statsData.id || `player_${Date.now()}`,
        statsData.name || statsData.playerName, statsData.team, 
        statsData.gamesPlayed || 1,
        statsData.points || 0, statsData.rebounds || 0, statsData.assists || 0,
        statsData.steals || 0, statsData.blocks || 0, statsData.turnovers || 0, 
        statsData.fouls || 0, 
        statsData.fgMade && statsData.fgAttempted ? (statsData.fgMade / statsData.fgAttempted * 100) : 0,
        statsData.threeMade && statsData.threeAttempted ? (statsData.threeMade / statsData.threeAttempted * 100) : 0,
        statsData.ftMade && statsData.ftAttempted ? (statsData.ftMade / statsData.ftAttempted * 100) : 0,
        0, // avgPlusMinus
        statsData.points || 0, statsData.rebounds || 0, statsData.assists || 0,
        statsData.steals || 0, statsData.blocks || 0, statsData.turnovers || 0, 
        statsData.fouls || 0,
        statsData.userId
      ];
      
      const result = await pgClient.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating player stats:', error);
      throw error;
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
