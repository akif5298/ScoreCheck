import { Router, Request, Response } from 'express';
import { prisma } from '@/services/database';
import { authenticateToken } from '@/middleware/auth';
import { ApiResponse, AnalyticsData, PlayerStats } from '@/types';

const router = Router();

// Get player statistics
router.get('/players', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: 'User not authenticated',
      };
      return res.status(401).json(response);
    }

    const players = await prisma.player.findMany({
      where: { userId: req.user.userId },
      include: {
        game: true,
      },
      orderBy: { points: 'desc' },
    });

    // Calculate aggregated statistics
    const playerStats = await calculatePlayerStats(req.user.userId);

    const response: ApiResponse<{ players: any[]; stats: PlayerStats[] }> = {
      success: true,
      data: {
        players,
        stats: playerStats,
      },
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching player statistics:', error);
    
    const response: ApiResponse = {
      success: false,
      error: 'Failed to fetch player statistics',
    };

    return res.status(500).json(response);
  }
});

// Get team statistics
router.get('/teams', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: 'User not authenticated',
      };
      return res.status(401).json(response);
    }

    const teams = await prisma.team.findMany({
      where: { userId: req.user.userId },
      include: {
        game: true,
      },
      orderBy: { points: 'desc' },
    });

    // Calculate team statistics
    const teamStats = await calculateTeamStats(req.user.userId);

    const response: ApiResponse<{ teams: any[]; stats: any[] }> = {
      success: true,
      data: {
        teams,
        stats: teamStats,
      },
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching team statistics:', error);
    
    const response: ApiResponse = {
      success: false,
      error: 'Failed to fetch team statistics',
    };

    return res.status(500).json(response);
  }
});

// Get comprehensive analytics dashboard
router.get('/dashboard', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: 'User not authenticated',
      };
      return res.status(401).json(response);
    }

    // Get recent games
    const recentGames = await prisma.game.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Get player statistics
    const playerStats = await calculatePlayerStats(req.user.userId);

    // Get team statistics
    const teamStats = await calculateTeamStats(req.user.userId);

    // Get top performers
    const topPerformers = await getTopPerformers(req.user.userId);

    const analyticsData: AnalyticsData = {
      playerStats,
      teamStats,
      recentGames,
      topPerformers,
    };

    const response: ApiResponse<AnalyticsData> = {
      success: true,
      data: analyticsData,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching analytics dashboard:', error);
    
    const response: ApiResponse = {
      success: false,
      error: 'Failed to fetch analytics dashboard',
    };

    return res.status(500).json(response);
  }
});

// Helper function to calculate player statistics
async function calculatePlayerStats(userId: string): Promise<PlayerStats[]> {
  const players = await prisma.player.findMany({
    where: { userId },
    include: { game: true },
  });

  const playerMap = new Map<string, PlayerStats>();

  for (const player of players) {
    const key = `${player.name}-${player.team}`;
    
    if (!playerMap.has(key)) {
      playerMap.set(key, {
        id: '',
        playerName: player.name,
        team: player.team,
        gamesPlayed: 0,
        avgPoints: 0,
        avgRebounds: 0,
        avgAssists: 0,
        avgSteals: 0,
        avgBlocks: 0,
        avgTurnovers: 0,
        avgFouls: 0,
        avgFgPercentage: 0,
        avgThreePercentage: 0,
        avgFtPercentage: 0,
        avgPlusMinus: 0,
        totalPoints: 0,
        totalRebounds: 0,
        totalAssists: 0,
        totalSteals: 0,
        totalBlocks: 0,
        totalTurnovers: 0,
        totalFouls: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        userId,
      });
    }

    const stats = playerMap.get(key)!;
    stats.gamesPlayed++;
    stats.totalPoints += player.points;
    stats.totalRebounds += player.rebounds;
    stats.totalAssists += player.assists;
    stats.totalSteals += player.steals;
    stats.totalBlocks += player.blocks;
    stats.totalTurnovers += player.turnovers;
    stats.totalFouls += player.fouls;
  }

  // Calculate averages
  for (const stats of playerMap.values()) {
    if (stats.gamesPlayed > 0) {
      stats.avgPoints = stats.totalPoints / stats.gamesPlayed;
      stats.avgRebounds = stats.totalRebounds / stats.gamesPlayed;
      stats.avgAssists = stats.totalAssists / stats.gamesPlayed;
      stats.avgSteals = stats.totalSteals / stats.gamesPlayed;
      stats.avgBlocks = stats.totalBlocks / stats.gamesPlayed;
      stats.avgTurnovers = stats.totalTurnovers / stats.gamesPlayed;
      stats.avgFouls = stats.totalFouls / stats.gamesPlayed;
    }
  }

  return Array.from(playerMap.values());
}

// Helper function to calculate team statistics
async function calculateTeamStats(userId: string): Promise<any[]> {
  const teams = await prisma.team.findMany({
    where: { userId },
    include: { game: true },
  });

  const teamMap = new Map<string, any>();

  for (const team of teams) {
    if (!teamMap.has(team.name)) {
      teamMap.set(team.name, {
        name: team.name,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        totalPoints: 0,
        totalRebounds: 0,
        totalAssists: 0,
        avgPoints: 0,
        avgRebounds: 0,
        avgAssists: 0,
      });
    }

    const stats = teamMap.get(team.name)!;
    stats.gamesPlayed++;
    stats.totalPoints += team.points;
    stats.totalRebounds += team.rebounds;
    stats.totalAssists += team.assists;

    // Determine win/loss
    const game = team.game;
    if (game) {
      if (team.isHome) {
        if (game.homeScore > game.awayScore) {
          stats.wins++;
        } else {
          stats.losses++;
        }
      } else {
        if (game.awayScore > game.homeScore) {
          stats.wins++;
        } else {
          stats.losses++;
        }
      }
    }
  }

  // Calculate averages
  for (const stats of teamMap.values()) {
    if (stats.gamesPlayed > 0) {
      stats.avgPoints = stats.totalPoints / stats.gamesPlayed;
      stats.avgRebounds = stats.totalRebounds / stats.gamesPlayed;
      stats.avgAssists = stats.totalAssists / stats.gamesPlayed;
    }
  }

  return Array.from(teamMap.values());
}

// Helper function to get top performers
async function getTopPerformers(userId: string): Promise<{ points: PlayerStats[]; rebounds: PlayerStats[]; assists: PlayerStats[] }> {
  const playerStats = await calculatePlayerStats(userId);

  return {
    points: playerStats
      .sort((a, b) => b.avgPoints - a.avgPoints)
      .slice(0, 5),
    rebounds: playerStats
      .sort((a, b) => b.avgRebounds - a.avgRebounds)
      .slice(0, 5),
    assists: playerStats
      .sort((a, b) => b.avgAssists - a.avgAssists)
      .slice(0, 5),
  };
}

export default router;
