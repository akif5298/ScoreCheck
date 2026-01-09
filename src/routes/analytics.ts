import { Router, Request, Response } from 'express';
import supabaseService from '@/services/supabase';
import { authenticateToken } from '@/middleware/auth';
import { ApiResponse, AnalyticsData, PlayerStats } from '@/types';

const router = Router();

// Only allow these specific player names in stats and dashboard
const ALLOWED_PLAYER_NAMES = [
  'Akif', 'Anis', 'Abdul', 'Ikroop', 'Nillan', 'Dylan', 'Ankit', 'TV', 'Kashif'
];

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

    const games = await supabaseService.getGamesByUserId(req.user.userId);
    const allPlayers = games.flatMap(game => game.players || []);
    
    // Filter players to only include allowed names
    const players = allPlayers.filter(player => 
      player.name && ALLOWED_PLAYER_NAMES.includes(player.name)
    );

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

    const games = await supabaseService.getGamesByUserId(req.user.userId);
    const teams = games.map(game => ({
      name: game.homeTeam,
      points: game.homeScore,
      game: game
    })).concat(games.map(game => ({
      name: game.awayTeam,
      points: game.awayScore,
      game: game
    })));

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
    const allGames = await supabaseService.getGamesByUserId(req.user.userId);
    const recentGames = allGames.slice(0, 10);

    // Calculate totals for this user
    const totalGames = allGames.length;
    
    // Get distinct player count directly from database (more accurate)
    const totalPlayers = await supabaseService.getDistinctPlayerCount(req.user.userId);
    
    // Get unique teams across all games
    const allTeams = allGames.flatMap(game => game.teams || []);
    const uniqueTeamNames = new Set(allTeams.map(t => t.name));
    const totalTeams = uniqueTeamNames.size;

    // Get player statistics
    const playerStats = await calculatePlayerStats(req.user.userId);

    // Get team statistics
    const teamStats = await calculateTeamStats(req.user.userId);

    // Calculate average points between Team A and Team B
    const teamA = teamStats.find(team => team.name === 'Team A');
    const teamB = teamStats.find(team => team.name === 'Team B');
    let avgPointsTeamAAndB = 0;
    
    if (teamA && teamB) {
      avgPointsTeamAAndB = (teamA.avgPoints + teamB.avgPoints) / 2;
    } else if (teamA) {
      avgPointsTeamAAndB = teamA.avgPoints;
    } else if (teamB) {
      avgPointsTeamAAndB = teamB.avgPoints;
    }

    // Get top performers
    const topPerformers = await getTopPerformers(req.user.userId);

    // Get game highs
    const gameHighs = await getGameHighs(req.user.userId);

    const analyticsData: AnalyticsData = {
      totalGames,
      totalPlayers,
      totalTeams,
      avgPointsTeamAAndB,
      playerStats,
      teamStats,
      recentGames,
      topPerformers,
      gameHighs,
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
  try {
    // Use optimized player_stats table instead of calculating on-the-fly
    const playerStats = await supabaseService.getPlayerStats(userId);
    
    // Transform the data to match the expected PlayerStats format
    return playerStats.map(stats => ({
      id: stats.id,
      playerName: stats.playerName,
      team: stats.team,
      gamesPlayed: stats.gamesPlayed,
      avgPoints: stats.avgPoints,
      avgRebounds: stats.avgRebounds,
      avgAssists: stats.avgAssists,
      avgSteals: stats.avgSteals,
      avgBlocks: stats.avgBlocks,
      avgTurnovers: stats.avgTurnovers,
      avgFouls: stats.avgFouls,
      avgFgPercentage: stats.avgFgPercentage,
      avgThreePercentage: stats.avgThreePercentage,
      avgFtPercentage: stats.avgFtPercentage,
      avgPlusMinus: stats.avgPlusMinus,
      totalPoints: stats.totalPoints,
      totalRebounds: stats.totalRebounds,
      totalAssists: stats.totalAssists,
      totalSteals: stats.totalSteals,
      totalBlocks: stats.totalBlocks,
      totalTurnovers: stats.totalTurnovers,
      totalFouls: stats.totalFouls,
      createdAt: stats.createdAt,
      updatedAt: stats.updatedAt,
      userId: stats.userId,
    }));
  } catch (error) {
    console.error('Error getting player stats from optimized table:', error);
    
    // Fallback to old calculation method if optimized table fails
    console.log('🔄 Falling back to on-the-fly calculation...');
    const games = await supabaseService.getGamesByUserId(userId);
    const players = games.flatMap(game => game.players || []);

    const playerMap = new Map<string, PlayerStats>();

    for (const player of players) {
      // Skip players with null/undefined names or teams
      if (!player.name || !player.team) {
        console.warn('Skipping player with missing name or team:', player);
        continue;
      }
      
      // Only include players with allowed names
      if (!ALLOWED_PLAYER_NAMES.includes(player.name)) {
        console.warn(`Skipping player with non-allowed name: ${player.name}`);
        continue;
      }
      
      // Group by player name only, not by team
      const key = player.name;
      
      if (!playerMap.has(key)) {
        playerMap.set(key, {
          id: '',
          playerName: player.name,
          team: player.team, // Start with first team
          teams: new Set([player.team]), // Track all teams
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
      
      // Add team to the set if not already there
      if (stats.teams) {
        stats.teams.add(player.team);
      }
      
      // Add shooting stats if available
      if (player.fgMade !== undefined && player.fgAttempted !== undefined) {
        // These will be calculated as averages later
      }
    }

    // Calculate averages and format team field
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
      
      // Format team field to show all teams played for
      if (stats.teams && stats.teams.size > 1) {
        stats.team = Array.from(stats.teams).join(', ');
      }
      
      // Remove the teams Set from the final object
      delete (stats as any).teams;
    }

    return Array.from(playerMap.values());
  }
}

// Helper function to calculate team statistics
async function calculateTeamStats(userId: string): Promise<any[]> {
  const games = await supabaseService.getGamesByUserId(userId);
  
  const teamMap = new Map<string, any>();

  for (const game of games) {
    // Process home team (include all teams, even "Team A" and "Team B")
    if (game.homeTeam) {
      if (!teamMap.has(game.homeTeam)) {
        teamMap.set(game.homeTeam, {
          name: game.homeTeam,
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          totalPoints: 0,
          totalRebounds: 0,
          totalAssists: 0,
          totalSteals: 0,
          totalBlocks: 0,
          totalTurnovers: 0,
          totalFouls: 0,
          totalFgMade: 0,
          totalFgAttempted: 0,
          totalThreeMade: 0,
          totalThreeAttempted: 0,
          totalFtMade: 0,
          totalFtAttempted: 0,
          avgPoints: 0,
          avgRebounds: 0,
          avgAssists: 0,
          avgSteals: 0,
          avgBlocks: 0,
          avgTurnovers: 0,
          avgFouls: 0,
          fg_percentage: 0.00,
          three_percentage: 0.00,
          ft_percentage: 0.00,
        });
      }

      const homeStats = teamMap.get(game.homeTeam)!;
      homeStats.gamesPlayed++;
      homeStats.totalPoints += game.homeScore;
      
      // Aggregate team stats from players (include ALL players for accurate team totals)
      const homePlayers = game.players?.filter((p: any) => p.team === game.homeTeam) || [];
      console.log(`Team stats: ${game.homeTeam} (${homePlayers.length} players)`);
      console.log(`DEBUG: game.homeTeam = "${game.homeTeam}"`);
      console.log(`DEBUG: Available player teams:`, game.players?.map((p: any) => p.team) || []);
      console.log(`DEBUG: homePlayers found:`, homePlayers.map((p: any) => ({ name: p.name, team: p.team })));
      
      // Calculate team totals from ALL players (don't filter by allowed names)
      homeStats.totalRebounds += homePlayers.reduce((sum: number, p: any) => sum + (p.rebounds || 0), 0);
      homeStats.totalAssists += homePlayers.reduce((sum: number, p: any) => sum + (p.assists || 0), 0);
      homeStats.totalSteals += homePlayers.reduce((sum: number, p: any) => sum + (p.steals || 0), 0);
      homeStats.totalBlocks += homePlayers.reduce((sum: number, p: any) => sum + (p.blocks || 0), 0);
      homeStats.totalTurnovers += homePlayers.reduce((sum: number, p: any) => sum + (p.turnovers || 0), 0);
      homeStats.totalFouls += homePlayers.reduce((sum: number, p: any) => sum + (p.fouls || 0), 0);
      
      // Add shooting stats
      homeStats.totalFgMade = (homeStats.totalFgMade || 0) + homePlayers.reduce((sum: number, p: any) => sum + (p.fgMade || 0), 0);
      homeStats.totalFgAttempted = (homeStats.totalFgAttempted || 0) + homePlayers.reduce((sum: number, p: any) => sum + (p.fgAttempted || 0), 0);
      homeStats.totalThreeMade = (homeStats.totalThreeMade || 0) + homePlayers.reduce((sum: number, p: any) => sum + (p.threeMade || 0), 0);
      homeStats.totalThreeAttempted = (homeStats.totalThreeAttempted || 0) + homePlayers.reduce((sum: number, p: any) => sum + (p.threeAttempted || 0), 0);
      homeStats.totalFtMade = (homeStats.totalFtMade || 0) + homePlayers.reduce((sum: number, p: any) => sum + (p.ftMade || 0), 0);
      homeStats.totalFtAttempted = (homeStats.totalFtAttempted || 0) + homePlayers.reduce((sum: number, p: any) => sum + (p.ftAttempted || 0), 0);
      
      if (game.homeScore > game.awayScore) {
        homeStats.wins++;
      } else {
        homeStats.losses++;
      }
    }

    // Process away team (include all teams, even "Team A" and "Team B")
    if (game.awayTeam) {
      if (!teamMap.has(game.awayTeam)) {
        teamMap.set(game.awayTeam, {
          name: game.awayTeam,
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          totalPoints: 0,
          totalRebounds: 0,
          totalAssists: 0,
          totalSteals: 0,
          totalBlocks: 0,
          totalTurnovers: 0,
          totalFouls: 0,
          totalFgMade: 0,
          totalFgAttempted: 0,
          totalThreeMade: 0,
          totalThreeAttempted: 0,
          totalFtMade: 0,
          totalFtAttempted: 0,
          avgPoints: 0,
          avgRebounds: 0,
          avgAssists: 0,
          avgSteals: 0,
          avgBlocks: 0,
          avgTurnovers: 0,
          avgFouls: 0,
          fg_percentage: 0.00,
          three_percentage: 0.00,
          ft_percentage: 0.00,
        });
      }

      const awayStats = teamMap.get(game.awayTeam)!;
      awayStats.gamesPlayed++;
      awayStats.totalPoints += game.awayScore;
      
      // Aggregate team stats from players (include ALL players for accurate team totals)
      const awayPlayers = game.players?.filter((p: any) => p.team === game.awayTeam) || [];
      console.log(`Team stats: ${game.awayTeam} (${awayPlayers.length} players)`);
      console.log(`DEBUG: game.awayTeam = "${game.awayTeam}"`);
      console.log(`DEBUG: Available player teams:`, game.players?.map((p: any) => p.team) || []);
      console.log(`DEBUG: awayPlayers found:`, awayPlayers.map((p: any) => ({ name: p.name, team: p.team })));
      
      // Calculate team totals from ALL players (don't filter by allowed names)
      awayStats.totalRebounds += awayPlayers.reduce((sum: number, p: any) => sum + (p.rebounds || 0), 0);
      awayStats.totalAssists += awayPlayers.reduce((sum: number, p: any) => sum + (p.assists || 0), 0);
      awayStats.totalSteals += awayPlayers.reduce((sum: number, p: any) => sum + (p.steals || 0), 0);
      awayStats.totalBlocks += awayPlayers.reduce((sum: number, p: any) => sum + (p.blocks || 0), 0);
      awayStats.totalTurnovers += awayPlayers.reduce((sum: number, p: any) => sum + (p.turnovers || 0), 0);
      awayStats.totalFouls += awayPlayers.reduce((sum: number, p: any) => sum + (p.fouls || 0), 0);
      
      // Add shooting stats
      awayStats.totalFgMade = (awayStats.totalFgMade || 0) + awayPlayers.reduce((sum: number, p: any) => sum + (p.fgMade || 0), 0);
      awayStats.totalFgAttempted = (awayStats.totalFgAttempted || 0) + awayPlayers.reduce((sum: number, p: any) => sum + (p.fgAttempted || 0), 0);
      awayStats.totalThreeMade = (awayStats.totalThreeMade || 0) + awayPlayers.reduce((sum: number, p: any) => sum + (p.threeMade || 0), 0);
      awayStats.totalThreeAttempted = (awayStats.totalThreeAttempted || 0) + awayPlayers.reduce((sum: number, p: any) => sum + (p.threeAttempted || 0), 0);
      awayStats.totalFtMade = (awayStats.totalFtMade || 0) + awayPlayers.reduce((sum: number, p: any) => sum + (p.ftMade || 0), 0);
      awayStats.totalFtAttempted = (awayStats.totalFtAttempted || 0) + awayPlayers.reduce((sum: number, p: any) => sum + (p.ftAttempted || 0), 0);
      
      if (game.awayScore > game.homeScore) {
        awayStats.wins++;
      } else {
        awayStats.losses++;
      }
    }
  }

  // Calculate averages
  for (const stats of teamMap.values()) {
    if (stats.gamesPlayed > 0) {
      stats.avgPoints = stats.totalPoints / stats.gamesPlayed;
      stats.avgRebounds = stats.totalRebounds / stats.gamesPlayed;
      stats.avgAssists = stats.totalAssists / stats.gamesPlayed;
      stats.avgSteals = stats.totalSteals / stats.gamesPlayed;
      stats.avgBlocks = stats.totalBlocks / stats.gamesPlayed;
      stats.avgTurnovers = stats.totalTurnovers / stats.gamesPlayed;
      stats.avgFouls = stats.totalFouls / stats.gamesPlayed;
      
      // Calculate shooting percentages
      stats.fg_percentage = stats.totalFgAttempted > 0 
        ? Math.round((stats.totalFgMade / stats.totalFgAttempted) * 100 * 100) / 100 
        : 0.00;
      stats.three_percentage = stats.totalThreeAttempted > 0 
        ? Math.round((stats.totalThreeMade / stats.totalThreeAttempted) * 100 * 100) / 100 
        : 0.00;
      stats.ft_percentage = stats.totalFtAttempted > 0 
        ? Math.round((stats.totalFtMade / stats.totalFtAttempted) * 100 * 100) / 100 
        : 0.00;
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

// Helper function to get game highs for various statistics
async function getGameHighs(userId: string): Promise<{
  points: any[];
  rebounds: any[];
  assists: any[];
  steals: any[];
  blocks: any[];
  threeMade: any[];
}> {
  const games = await supabaseService.getGamesByUserId(userId);
  const allPlayers = games.flatMap(game => game.players || []);
  
  // Filter to only include allowed names
  const filteredPlayers = allPlayers.filter(player => 
    player.name && ALLOWED_PLAYER_NAMES.includes(player.name)
  );

  // Get game highs for each category
  const gameHighs = {
    points: filteredPlayers
      .sort((a, b) => b.points - a.points)
      .slice(0, 5)
      .map(player => ({
        playerName: player.name,
        team: player.team,
        value: player.points,
        gameId: player.gameId,
        date: games.find(g => g.id === player.gameId)?.createdAt || new Date()
      })),
    rebounds: filteredPlayers
      .sort((a, b) => b.rebounds - a.rebounds)
      .slice(0, 5)
      .map(player => ({
        playerName: player.name,
        team: player.team,
        value: player.rebounds,
        gameId: player.gameId,
        date: games.find(g => g.id === player.gameId)?.createdAt || new Date()
      })),
    assists: filteredPlayers
      .sort((a, b) => b.assists - a.assists)
      .slice(0, 5)
      .map(player => ({
        playerName: player.name,
        team: player.team,
        value: player.assists,
        gameId: player.gameId,
        date: games.find(g => g.id === player.gameId)?.createdAt || new Date()
      })),
    steals: filteredPlayers
      .sort((a, b) => b.steals - a.steals)
      .slice(0, 5)
      .map(player => ({
        playerName: player.name,
        team: player.team,
        value: player.steals,
        gameId: player.gameId,
        date: games.find(g => g.id === player.gameId)?.createdAt || new Date()
      })),
    blocks: filteredPlayers
      .sort((a, b) => b.blocks - a.blocks)
      .slice(0, 5)
      .map(player => ({
        playerName: player.name,
        team: player.team,
        value: player.blocks,
        gameId: player.gameId,
        date: games.find(g => g.id === player.gameId)?.createdAt || new Date()
      })),
    threeMade: filteredPlayers
      .sort((a, b) => (b.threeMade || 0) - (a.threeMade || 0))
      .slice(0, 5)
      .map(player => ({
        playerName: player.name,
        team: player.team,
        value: player.threeMade || 0,
        gameId: player.gameId,
        date: games.find(g => g.id === player.gameId)?.createdAt || new Date()
      }))
  };

  return gameHighs;
}

export default router;
