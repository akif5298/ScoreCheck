import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import supabaseService from '@/services/supabase';
import { EnhancedOCRService } from '@/services/enhancedOCRService';
import BoxScoreParser from '@/services/boxScoreParser';
import imageProcessor from '@/services/imageProcessor';
import { authenticateToken } from '@/middleware/auth';
import { ApiResponse, Game, Player, Team } from '@/types';

const router = Router();

// Helper function to update player stats in the player_stats table
async function updatePlayerStats(gameId: string, playersData: any[], userId: string) {
  try {
    console.log('🔄 Updating player stats for game:', gameId);
    
    for (const playerData of playersData) {
      // Skip players with non-allowed names
      if (!['Akif', 'Anis', 'Abdul', 'Ikroop', 'Nillan', 'Dylan', 'Ankit', 'TV', 'Kashif'].includes(playerData.name)) {
        console.log(`⏭️ Skipping non-allowed player: ${playerData.name}`);
        continue;
      }
      
      // Get existing player stats or create new
      const existingStats = await supabaseService.getPlayerStatsByPlayerName(playerData.name, userId);
      
      if (existingStats) {
        // Update existing stats
        console.log(`📊 Updating stats for existing player: ${playerData.name}`);
        
        const updatedStats = {
          gamesPlayed: existingStats.gamesPlayed + 1,
          totalPoints: existingStats.totalPoints + (playerData.points || 0),
          totalRebounds: existingStats.totalRebounds + (playerData.rebounds || 0),
          totalAssists: existingStats.totalAssists + (playerData.assists || 0),
          totalSteals: existingStats.totalSteals + (playerData.steals || 0),
          totalBlocks: existingStats.totalBlocks + (playerData.blocks || 0),
          totalTurnovers: existingStats.totalTurnovers + (playerData.turnovers || 0),
          totalFouls: existingStats.totalFouls + (playerData.fouls || 0),
          totalFgMade: existingStats.totalFgMade + (playerData.fgMade || 0),
          totalFgAttempted: existingStats.totalFgAttempted + (playerData.fgAttempted || 0),
          totalThreeMade: existingStats.totalThreeMade + (playerData.threeMade || 0),
          totalThreeAttempted: existingStats.totalThreeAttempted + (playerData.threeAttempted || 0),
          totalFtMade: existingStats.totalFtMade + (playerData.ftMade || 0),
          totalFtAttempted: existingStats.totalFtAttempted + (playerData.ftAttempted || 0),
          avgPoints: 0, // Will be calculated below
          avgRebounds: 0, // Will be calculated below
          avgAssists: 0, // Will be calculated below
          avgSteals: 0, // Will be calculated below
          avgBlocks: 0, // Will be calculated below
          avgTurnovers: 0, // Will be calculated below
          avgFouls: 0, // Will be calculated below
          avgFgPercentage: 0, // Will be calculated below
          avgThreePercentage: 0, // Will be calculated below
          avgFtPercentage: 0, // Will be calculated below
        };
        
        // Calculate new averages
        const newGamesPlayed = updatedStats.gamesPlayed;
        updatedStats.avgPoints = updatedStats.totalPoints / newGamesPlayed;
        updatedStats.avgRebounds = updatedStats.totalRebounds / newGamesPlayed;
        updatedStats.avgAssists = updatedStats.totalAssists / newGamesPlayed;
        updatedStats.avgSteals = updatedStats.totalSteals / newGamesPlayed;
        updatedStats.avgBlocks = updatedStats.totalBlocks / newGamesPlayed;
        updatedStats.avgTurnovers = updatedStats.totalTurnovers / newGamesPlayed;
        updatedStats.avgFouls = updatedStats.totalFouls / newGamesPlayed;
        
        // Calculate shooting percentages
        updatedStats.avgFgPercentage = updatedStats.totalFgAttempted > 0 
          ? Math.round((updatedStats.totalFgMade / updatedStats.totalFgAttempted) * 100 * 100) / 100 
          : 0.00;
        updatedStats.avgThreePercentage = updatedStats.totalThreeAttempted > 0 
          ? Math.round((updatedStats.totalThreeMade / updatedStats.totalThreeAttempted) * 100 * 100) / 100 
          : 0.00;
        updatedStats.avgFtPercentage = updatedStats.totalFtAttempted > 0 
          ? Math.round((updatedStats.totalFtMade / updatedStats.totalFtAttempted) * 100 * 100) / 100 
          : 0.00;
        
        await supabaseService.updatePlayerStats(playerData.name, userId, updatedStats);
        console.log(`✅ Updated stats for ${playerData.name}: ${updatedStats.gamesPlayed} games, ${updatedStats.totalPoints} total points`);
        
      } else {
        // Create new player stats
        console.log(`🆕 Creating new stats for player: ${playerData.name}`);
        
        const newStats = {
          id: `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          playerName: playerData.name,
          team: playerData.team,
          gamesPlayed: 1,
          avgPoints: playerData.points || 0,
          avgRebounds: playerData.rebounds || 0,
          avgAssists: playerData.assists || 0,
          avgSteals: playerData.steals || 0,
          avgBlocks: playerData.blocks || 0,
          avgTurnovers: playerData.turnovers || 0,
          avgFouls: playerData.fouls || 0,
          avgFgPercentage: playerData.fgAttempted && playerData.fgAttempted > 0 
            ? Math.round((playerData.fgMade / playerData.fgAttempted) * 100 * 100) / 100 
            : 0.00,
          avgThreePercentage: playerData.threeAttempted && playerData.threeAttempted > 0 
            ? Math.round((playerData.threeMade / playerData.threeAttempted) * 100 * 100) / 100 
            : 0.00,
          avgFtPercentage: playerData.ftAttempted && playerData.ftAttempted > 0 
            ? Math.round((playerData.ftMade / playerData.ftAttempted) * 100 * 100) / 100 
            : 0.00,
          totalPoints: playerData.points || 0,
          totalRebounds: playerData.rebounds || 0,
          totalAssists: playerData.assists || 0,
          totalSteals: playerData.steals || 0,
          totalBlocks: playerData.blocks || 0,
          totalTurnovers: playerData.turnovers || 0,
          totalFouls: playerData.fouls || 0,
          totalFgMade: playerData.fgMade || 0,
          totalFgAttempted: playerData.fgAttempted || 0,
          totalThreeMade: playerData.threeMade || 0,
          totalThreeAttempted: playerData.threeAttempted || 0,
          totalFtMade: playerData.ftMade || 0,
          totalFtAttempted: playerData.ftAttempted || 0,
          userId,
        };
        
        await supabaseService.createPlayerStats(newStats);
        console.log(`✅ Created new stats for ${playerData.name}: 1 game, ${newStats.totalPoints} total points`);
      }
    }
    
    console.log('✅ All player stats updated successfully');
  } catch (error) {
    console.error('❌ Error updating player stats:', error);
    throw error;
  }
}

// Initialize enhanced OCR service
// Create fresh OCR service instance for each request to prevent caching

// Helper function to extract image number from filename
function extractImageNumber(filename?: string): string {
  if (!filename) {
    // Fallback to timestamp if no filename provided
    return Date.now().toString();
  }
  
  // Try to extract number from various filename formats
  const patterns = [
    /IMG_(\d+)\./i,           // IMG_0312.JPEG
    /(\d+)-boxscore\./i,      // 1755490781069-boxscore.jpg
    /(\d+)\./i,               // Any number before extension
    /(\d+)/                   // Any number in filename
  ];
  
  for (const pattern of patterns) {
    const match = filename.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  // Fallback to timestamp if no pattern matches
  return Date.now().toString();
}

// Configure multer for memory storage (we'll upload directly to Supabase)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760'), // 10MB default
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});



// Upload and process multiple box score screenshots for review
router.post('/upload-multiple', authenticateToken, upload.array('screenshots', 10), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    
    if (!files || files.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'No files uploaded',
      };
      return res.status(400).json(response);
    }

    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: 'User not authenticated',
      };
      return res.status(401).json(response);
    }

    console.log(`🆔 Processing ${files.length} files for user ${(req.user as any).id}`);
    console.log(`🔍 Full req.user object:`, JSON.stringify(req.user, null, 2));

    // Process files in batches of 2
    const results = [];
    const batchSize = 2;
    
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i/batchSize) + 1}: ${batch.map(f => f.originalname).join(', ')}`);
      
      // Process batch in parallel
      const batchPromises = batch.map(async (file) => {
        const uniqueRequestId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9);
        console.log(`🆔 Processing file: ${file.originalname} with ID: ${uniqueRequestId}`);
        
        const enhancedOCRService = new EnhancedOCRService();
        const extractedData = await enhancedOCRService.extractStructuredDataFromImage(file.buffer, file.originalname);
        
        // Upload to Supabase
        const imageNumber = extractImageNumber(file.originalname);
        const userId = (req.user as any).id || (req.user as any).userId || 'unknown';
        const fileName = `${userId}-${imageNumber}-boxscore.${file.originalname.split('.').pop()}`;
        console.log(`🔍 Creating filename: ${fileName} for user: ${userId}`);
        const originalImageUrl = await supabaseService.uploadImage(file.buffer, fileName);

        return {
          extractedData,
          originalImageUrl,
          fileName: file.originalname,
          processedAt: new Date().toISOString()
        };
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      console.log(`✅ Completed batch ${Math.floor(i/batchSize) + 1}`);
    }

    const response: ApiResponse = {
      success: true,
      data: {
        results,
        totalProcessed: results.length
      }
    };

    return res.json(response);
  } catch (error) {
    console.error('Multiple upload error:', error);
    const response: ApiResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process images',
    };
    return res.status(500).json(response);
  }
});

// Keep the original single upload for backward compatibility
router.post('/upload', authenticateToken, upload.single('screenshot'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      const response: ApiResponse = {
        success: false,
        error: 'No file uploaded',
      };
      return res.status(400).json(response);
    }

    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: 'User not authenticated',
      };
      return res.status(401).json(response);
    }

    // Extract structured data using enhanced OCR service with cache-busting
    const uniqueRequestId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9);
    console.log(`🆔 Processing new upload request: ${uniqueRequestId}`);
    
    // Create fresh OCR service instance for each request to prevent caching
    const enhancedOCRService = new EnhancedOCRService();
    
    console.log('🚨🚨🚨 ABOUT TO CALL ENHANCED OCR 🚨🚨🚨');
    const extractedData = await enhancedOCRService.extractStructuredDataFromImage(req.file.buffer, req.file.originalname); 

    console.log('📁 File:', req.file.originalname);
    console.log('🔢 Total Players Detected:', extractedData.players.length);
    
    // Debug: Log each player being sent to frontend
    console.log('🔍 ALL PLAYERS BEING SENT TO FRONTEND:');
    console.log('🔍 Total players count:', extractedData.players.length);
    extractedData.players.forEach((player, index) => {
      console.log(`  Player ${index + 1}: ID=${player.id}, Name="${player.name}", Team=${player.team}`);
    });
    
    // Check if we have exactly 10 players
    if (extractedData.players.length !== 10) {
      console.log(`🚨🚨🚨 WARNING: Expected 10 players but got ${extractedData.players.length} 🚨🚨🚨`);
      console.log('🔍 This suggests one or more players failed to extract in the OCR service');
    }

    console.log('Extracted team totals:', {
      teamATotals: extractedData.teamATotals,
      teamBTotals: extractedData.teamBTotals
    });

    // Convert Player objects to ExtractedRow objects for the parser
    console.log('🔍 Converting Player objects to ExtractedRow objects...');
    console.log('🔍 Input players count:', extractedData.players.length);
    
    const extractedRows = extractedData.players.map((player: Player, index: number) => {
      console.log(`🔍 Converting Player ${index + 1}:`, { 
        id: player.id, 
        name: player.name, 
        team: player.team 
      });
      
      return {
        id: player.id, // ✅ Preserve the ID field
        playerName: player.name,
        team: player.team, // ✅ Preserve the team assignment
        teammateGrade: player.teammateGrade || '',
        points: player.points,
        rebounds: player.rebounds,
        assists: player.assists,
        steals: player.steals,
        blocks: player.blocks,
        fouls: player.fouls,
        turnovers: player.turnovers,
        fgMade: player.fgMade,
        fgAttempted: player.fgAttempted,
        threeMade: player.threeMade,
        threeAttempted: player.threeAttempted,
        ftMade: player.ftMade,
        ftAttempted: player.ftAttempted,
      };
    });
    
    console.log('🔍 ExtractedRows count after conversion:', extractedRows.length);
    console.log('🔍 ExtractedRows sample:', extractedRows.slice(0, 3).map(row => ({ 
      id: row.id, 
      playerName: row.playerName, 
      team: row.team 
    })));

    // Parse the box score data
    console.log('🔍 About to parse with BoxScoreParser:');
    console.log('  extractedRows count:', extractedRows.length);
    console.log('  extractedRows sample:', extractedRows.slice(0, 3).map(row => ({ 
      id: row.id, 
      playerName: row.playerName, 
      team: row.team, 
      points: row.points 
    })));
    
    const parser = new BoxScoreParser(
      extractedRows, 
      req.file.originalname,
      extractedData.teamAQuarters,
      extractedData.teamBQuarters
    );
    const boxScoreData = parser.parse();
    
    console.log('🔍 BoxScoreParser result:');
    console.log('  players count:', boxScoreData.players.length);
    console.log('  players:', boxScoreData.players.map(p => ({ id: p.id, name: p.name, team: p.team })));
    
    // Check if we lost any players during BoxScoreParser processing
    if (boxScoreData.players.length !== extractedRows.length) {
      console.log(`🚨🚨🚨 WARNING: BoxScoreParser lost players! Input: ${extractedRows.length}, Output: ${boxScoreData.players.length} 🚨🚨🚨`);
    }

    // Extract image number for consistent ID generation
    const imageNumber = extractImageNumber(req.file.originalname);
    
    // Return the extracted data for review instead of saving to database
    // IMPORTANT: Use custom team names from EnhancedOCRService, not generic ones from BoxScoreParser
    
    // Debug: Log what team names we're working with
    console.log('🔍 Team Names Debug:');
    console.log('  EnhancedOCRService gameData:', extractedData.gameData);
    console.log('  BoxScoreParser data:', { homeTeam: boxScoreData.homeTeam, awayTeam: boxScoreData.awayTeam });
    
    const responseData = {
      extractedData: {
        ...boxScoreData,
        // Override team names with custom ones from OCR service
        homeTeam: extractedData.gameData?.homeTeam || boxScoreData.homeTeam,
        awayTeam: extractedData.gameData?.awayTeam || boxScoreData.awayTeam,
        teamATotals: extractedData.teamATotals,
        teamBTotals: extractedData.teamBTotals,
        teamAQuarters: extractedData.teamAQuarters,
        teamBQuarters: extractedData.teamBQuarters,
        imageNumber: imageNumber // Include image number for team ID generation
      },
      originalImageUrl: `data:image/jpeg;base64,${req.file.buffer.toString('base64')}`,
      originalFileName: req.file.originalname,
    };
    
    // Debug: Check final response data
    console.log('🔍 Final response data check:');
    console.log('  responseData.extractedData.players count:', responseData.extractedData.players.length);
    console.log('  responseData.extractedData.players:', responseData.extractedData.players.map(p => ({ id: p.id, name: p.name, team: p.team })));
    
    // Final verification that we're sending 10 players
    if (responseData.extractedData.players.length !== 10) {
      console.log(`🚨🚨🚨 FINAL WARNING: Response data only has ${responseData.extractedData.players.length} players instead of 10! 🚨🚨🚨`);
    }
    
    // Debug: Log final team names being sent
    console.log('🔍 Final Team Names Being Sent:');
    console.log('  homeTeam:', responseData.extractedData.homeTeam);
    console.log('  awayTeam:', responseData.extractedData.awayTeam);



    console.log('Sending response data:', responseData);

    const response: ApiResponse<{
      extractedData: any;
      originalImageUrl: string;
      originalFileName: string;
    }> = {
      success: true,
      data: responseData,
      message: 'Box score extracted successfully. Please review the data before saving.',
    };

    // Explicitly prevent caching of dynamic OCR results
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    return res.status(200).json(response);
  } catch (error) {
    console.error('Screenshot processing error:', error);
    
    const response: ApiResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process screenshot',
    };

    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json(response);
  }
});

// Save the reviewed data to the database
router.post('/save', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: 'User not authenticated',
      };
      return res.status(401).json(response);
    }

    console.log('🔍 Received save request body:', JSON.stringify(req.body, null, 2));
    
    const { gameData, playersData, imageUrl } = req.body;

    if (!gameData || !playersData || !imageUrl) {
      console.log('❌ Missing required data:', {
        hasGameData: !!gameData,
        hasPlayersData: !!playersData,
        hasImageUrl: !!imageUrl,
        gameData: gameData,
        playersDataLength: playersData?.length,
        imageUrl: imageUrl
      });
      
      const response: ApiResponse = {
        success: false,
        error: 'Missing required data for saving',
      };
      return res.status(400).json(response);
    }

    // Use the existing Supabase URL instead of re-uploading
    console.log('🔍 Using existing image URL for save:', imageUrl);

    // Create game record
    const game = await supabaseService.createGame({
      date: gameData.date || new Date().toISOString(),
      homeTeam: gameData.homeTeam,
      awayTeam: gameData.awayTeam,
      homeScore: gameData.homeScore,
      awayScore: gameData.awayScore,
      screenshotUrl: imageUrl,
      processed: true,
      userId: req.user.userId,
    });

    // Extract image number from the image URL for gameIdFromFile
    // The imageUrl is a Supabase URL, so we need to extract the filename from it
    const urlParts = imageUrl.split('/');
    const fileName = urlParts[urlParts.length - 1]; // Get the last part of the URL (filename)
    const playerImageNumber = extractImageNumber(fileName);
    console.log(`🔍 Extracted image number for gameIdFromFile: ${playerImageNumber} from filename: ${fileName}`);
    
    // Debug: Log the first player data to see what we're working with
    if (playersData.length > 0) {
      console.log('🔍 Sample player data structure:', JSON.stringify(playersData[0], null, 2));
    }

    // Create player records
    const playerPromises = playersData.map((playerData: any) => {
      console.log(`🔍 Player data for database:`, {
        id: playerData.id,
        name: playerData.name,
        team: playerData.team,
        position: playerData.position,
        teammateGrade: playerData.teammateGrade,
        playerId: playerData.playerId
      });
      
      // Calculate shooting percentages
      const fgPercentage = playerData.fgAttempted && playerData.fgAttempted > 0 
        ? Math.round((playerData.fgMade / playerData.fgAttempted) * 100 * 100) / 100 
        : 0.00;
      
      const threePercentage = playerData.threeAttempted && playerData.threeAttempted > 0 
        ? Math.round((playerData.threeMade / playerData.threeAttempted) * 100 * 100) / 100 
        : 0.00;
      
      const ftPercentage = playerData.ftAttempted && playerData.ftAttempted > 0 
        ? Math.round((playerData.ftMade / playerData.ftAttempted) * 100 * 100) / 100 
        : 0.00;
      
      return supabaseService.createPlayer({
        id: playerData.id || `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: playerData.name || 'Unknown Player',
        team: playerData.team || 'Unknown Team',
        teammateGrade: playerData.teammateGrade || 'N/A',
        gameIdFromFile: playerImageNumber,
        playerId: playerData.playerId || `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        position: playerData.position || 'Unknown',
        points: playerData.points || 0,
        rebounds: playerData.rebounds || 0,
        assists: playerData.assists || 0,
        steals: playerData.steals || 0,
        blocks: playerData.blocks || 0,
        turnovers: playerData.turnovers || 0,
        fouls: playerData.fouls || 0,
        fgMade: playerData.fgMade || 0,
        fgAttempted: playerData.fgAttempted || 0,
        threeMade: playerData.threeMade || 0,
        threeAttempted: playerData.threeAttempted || 0,
        ftMade: playerData.ftMade || 0,
        ftAttempted: playerData.ftAttempted || 0,
        fg_percentage: fgPercentage,
        three_percentage: threePercentage,
        ft_percentage: ftPercentage,
        gameId: game.id,
        userId: req.user!.userId,
      });
    });

    // Wait for all database operations to complete
    await Promise.all(playerPromises);

    // Calculate team totals from player data
    const homeTeamPlayers = playersData.filter((p: any) => p.team === gameData.homeTeam);
    const awayTeamPlayers = playersData.filter((p: any) => p.team === gameData.awayTeam);
    
    const homeTeamTotals = {
      rebounds: homeTeamPlayers.reduce((sum: number, p: any) => sum + (p.rebounds || 0), 0),
      assists: homeTeamPlayers.reduce((sum: number, p: any) => sum + (p.assists || 0), 0),
      steals: homeTeamPlayers.reduce((sum: number, p: any) => sum + (p.steals || 0), 0),
      blocks: homeTeamPlayers.reduce((sum: number, p: any) => sum + (p.blocks || 0), 0),
      turnovers: homeTeamPlayers.reduce((sum: number, p: any) => sum + (p.turnovers || 0), 0),
      fouls: homeTeamPlayers.reduce((sum: number, p: any) => sum + (p.fouls || 0), 0),
      fgMade: homeTeamPlayers.reduce((sum: number, p: any) => sum + (p.fgMade || 0), 0),
      fgAttempted: homeTeamPlayers.reduce((sum: number, p: any) => sum + (p.fgAttempted || 0), 0),
      threeMade: homeTeamPlayers.reduce((sum: number, p: any) => sum + (p.threeMade || 0), 0),
      threeAttempted: homeTeamPlayers.reduce((sum: number, p:any) => sum + (p.threeAttempted || 0), 0),
      ftMade: homeTeamPlayers.reduce((sum: number, p: any) => sum + (p.ftMade || 0), 0),
      ftAttempted: homeTeamPlayers.reduce((sum: number, p: any) => sum + (p.ftAttempted || 0), 0),
    };
    
    // Calculate team shooting percentages
    const homeTeamPercentages = {
      fg_percentage: homeTeamTotals.fgAttempted > 0 
        ? Math.round((homeTeamTotals.fgMade / homeTeamTotals.fgAttempted) * 100 * 100) / 100 
        : 0.00,
      three_percentage: homeTeamTotals.threeAttempted > 0 
        ? Math.round((homeTeamTotals.threeMade / homeTeamTotals.threeAttempted) * 100 * 100) / 100 
        : 0.00,
      ft_percentage: homeTeamTotals.ftAttempted > 0 
        ? Math.round((homeTeamTotals.ftMade / homeTeamTotals.ftAttempted) * 100 * 100) / 100 
        : 0.00,
    };
    
    const awayTeamTotals = {
      rebounds: awayTeamPlayers.reduce((sum: number, p: any) => sum + (p.rebounds || 0), 0),
      assists: awayTeamPlayers.reduce((sum: number, p: any) => sum + (p.assists || 0), 0),
      steals: awayTeamPlayers.reduce((sum: number, p: any) => sum + (p.steals || 0), 0),
      blocks: awayTeamPlayers.reduce((sum: number, p: any) => sum + (p.blocks || 0), 0),
      turnovers: awayTeamPlayers.reduce((sum: number, p: any) => sum + (p.turnovers || 0), 0),
      fouls: awayTeamPlayers.reduce((sum: number, p: any) => sum + (p.fouls || 0), 0),
      fgMade: awayTeamPlayers.reduce((sum: number, p: any) => sum + (p.fgMade || 0), 0),
      fgAttempted: awayTeamPlayers.reduce((sum: number, p: any) => sum + (p.fgAttempted || 0), 0),
      threeMade: awayTeamPlayers.reduce((sum: number, p: any) => sum + (p.threeMade || 0), 0),
      threeAttempted: awayTeamPlayers.reduce((sum: number, p: any) => sum + (p.threeAttempted || 0), 0),
      ftMade: awayTeamPlayers.reduce((sum: number, p: any) => sum + (p.ftMade || 0), 0),
      ftAttempted: awayTeamPlayers.reduce((sum: number, p: any) => sum + (p.ftAttempted || 0), 0),
    };
    
    // Calculate away team shooting percentages
    const awayTeamPercentages = {
      fg_percentage: awayTeamTotals.fgAttempted > 0 
        ? Math.round((awayTeamTotals.fgMade / awayTeamTotals.fgAttempted) * 100 * 100) / 100 
        : 0.00,
      three_percentage: awayTeamTotals.threeAttempted > 0 
        ? Math.round((awayTeamTotals.threeMade / awayTeamTotals.threeAttempted) * 100 * 100) / 100 
        : 0.00,
      ft_percentage: awayTeamTotals.ftAttempted > 0 
        ? Math.round((awayTeamTotals.ftMade / awayTeamTotals.ftAttempted) * 100 * 100) / 100 
        : 0.00,
    };

    // Create team records with image number format IDs
    const imageNumber = gameData.imageNumber || extractImageNumber(req.body.originalFileName);
    
    console.log('🔍 Creating teams with image number:', imageNumber);
    console.log('🔍 Home team data:', { name: gameData.homeTeam, score: gameData.homeScore });
    console.log('🔍 Away team data:', { name: gameData.awayTeam, score: gameData.awayScore });
    
    const homeTeamData = {
      id: `team_${imageNumber}_home_${Math.random().toString(36).substr(2, 5)}`,
      name: gameData.homeTeam,
      isHome: true,
      points: gameData.homeScore,
      rebounds: homeTeamTotals.rebounds || 0,
      assists: homeTeamTotals.assists || 0,
      steals: homeTeamTotals.steals || 0,
      blocks: homeTeamTotals.blocks || 0,
      turnovers: homeTeamTotals.turnovers || 0,
      fouls: homeTeamTotals.fouls || 0,
      fgMade: homeTeamTotals.fgMade || 0,
      fgAttempted: homeTeamTotals.fgAttempted || 0,
      threeMade: homeTeamTotals.threeMade || 0,
      threeAttempted: homeTeamTotals.threeAttempted || 0,
      ftMade: homeTeamTotals.ftMade || 0,
      ftAttempted: homeTeamTotals.ftAttempted || 0,
      fg_percentage: homeTeamPercentages.fg_percentage || 0.00,
      three_percentage: homeTeamPercentages.three_percentage || 0.00,
      ft_percentage: homeTeamPercentages.ft_percentage || 0.00,
      gameId: game.id,
      userId: req.user!.userId,
    };
    
    const awayTeamData = {
      id: `team_${imageNumber}_away_${Math.random().toString(36).substr(2, 5)}`,
      name: gameData.awayTeam,
      isHome: false,
      points: gameData.awayScore,
      rebounds: awayTeamTotals.rebounds || 0,
      assists: awayTeamTotals.assists || 0,
      steals: awayTeamTotals.steals || 0,
      blocks: awayTeamTotals.blocks || 0,
      turnovers: awayTeamTotals.turnovers || 0,
      fouls: awayTeamTotals.fouls || 0,
      fgMade: awayTeamTotals.fgMade || 0,
      fgAttempted: awayTeamTotals.fgAttempted || 0,
      threeMade: awayTeamTotals.threeMade || 0,
      threeAttempted: awayTeamTotals.threeAttempted || 0,
      ftMade: awayTeamTotals.ftMade || 0,
      ftAttempted: awayTeamTotals.ftAttempted || 0,
      fg_percentage: awayTeamPercentages.fg_percentage || 0.00,
      three_percentage: awayTeamPercentages.three_percentage || 0.00,
      ft_percentage: awayTeamPercentages.ft_percentage || 0.00,
      gameId: game.id,
      userId: req.user!.userId,
    };

    console.log('🔍 About to create teams in database...');
    console.log('🔍 Home team data for DB:', homeTeamData);
    console.log('🔍 Away team data for DB:', awayTeamData);
    
    const teamPromises = [
      supabaseService.createTeam(homeTeamData),
      supabaseService.createTeam(awayTeamData)
    ];

    console.log('🔍 Team creation promises created, waiting for completion...');
    await Promise.all(teamPromises);
    console.log('✅ Teams created successfully in database');

    // Helper function to update player stats in the player_stats table
    async function updatePlayerStats(gameId: string, playersData: any[], userId: string) {
      try {
        console.log('🔄 Updating player stats for game:', gameId);
        
        for (const playerData of playersData) {
          // Skip players with non-allowed names
          if (!['Akif', 'Anis', 'Abdul', 'Ikroop', 'Nillan', 'Dylan', 'Ankit', 'TV', 'Kashif'].includes(playerData.name)) {
            console.log(`⏭️ Skipping non-allowed player: ${playerData.name}`);
            continue;
          }
          
          // Get existing player stats or create new
          const existingStats = await supabaseService.getPlayerStatsByPlayerName(playerData.name, userId);
          
          if (existingStats) {
            // Update existing stats
            console.log(`📊 Updating stats for existing player: ${playerData.name}`);
            
            const updatedStats = {
              gamesPlayed: existingStats.gamesPlayed + 1,
              totalPoints: existingStats.totalPoints + (playerData.points || 0),
              totalRebounds: existingStats.totalRebounds + (playerData.rebounds || 0),
              totalAssists: existingStats.totalAssists + (playerData.assists || 0),
              totalSteals: existingStats.totalSteals + (playerData.steals || 0),
              totalBlocks: existingStats.totalBlocks + (playerData.blocks || 0),
              totalTurnovers: existingStats.totalTurnovers + (playerData.turnovers || 0),
              totalFouls: existingStats.totalFouls + (playerData.fouls || 0),
              totalFgMade: existingStats.totalFgMade + (playerData.fgMade || 0),
              totalFgAttempted: existingStats.totalFgAttempted + (playerData.fgAttempted || 0),
              totalThreeMade: existingStats.totalThreeMade + (playerData.threeMade || 0),
              totalThreeAttempted: existingStats.totalThreeAttempted + (playerData.threeAttempted || 0),
              totalFtMade: existingStats.totalFtMade + (playerData.ftMade || 0),
              totalFtAttempted: existingStats.totalFtAttempted + (playerData.ftAttempted || 0),
              avgPoints: 0, // Will be calculated below
              avgRebounds: 0, // Will be calculated below
              avgAssists: 0, // Will be calculated below
              avgSteals: 0, // Will be calculated below
              avgBlocks: 0, // Will be calculated below
              avgTurnovers: 0, // Will be calculated below
              avgFouls: 0, // Will be calculated below
              avgFgPercentage: 0, // Will be calculated below
              avgThreePercentage: 0, // Will be calculated below
              avgFtPercentage: 0, // Will be calculated below
            };
            
            // Calculate new averages
            const newGamesPlayed = updatedStats.gamesPlayed;
            updatedStats.avgPoints = updatedStats.totalPoints / newGamesPlayed;
            updatedStats.avgRebounds = updatedStats.totalRebounds / newGamesPlayed;
            updatedStats.avgAssists = updatedStats.totalAssists / newGamesPlayed;
            updatedStats.avgSteals = updatedStats.totalSteals / newGamesPlayed;
            updatedStats.avgBlocks = updatedStats.totalBlocks / newGamesPlayed;
            updatedStats.avgTurnovers = updatedStats.totalTurnovers / newGamesPlayed;
            updatedStats.avgFouls = updatedStats.totalFouls / newGamesPlayed;
            
            // Calculate shooting percentages
            updatedStats.avgFgPercentage = updatedStats.totalFgAttempted > 0 
              ? Math.round((updatedStats.totalFgMade / updatedStats.totalFgAttempted) * 100 * 100) / 100 
              : 0.00;
            updatedStats.avgThreePercentage = updatedStats.totalThreeAttempted > 0 
              ? Math.round((updatedStats.totalThreeMade / updatedStats.totalThreeAttempted) * 100 * 100) / 100 
              : 0.00;
            updatedStats.avgFtPercentage = updatedStats.totalFtAttempted > 0 
              ? Math.round((updatedStats.totalFtMade / updatedStats.totalFtAttempted) * 100 * 100) / 100 
              : 0.00;
            
            await supabaseService.updatePlayerStats(playerData.name, userId, updatedStats);
            console.log(`✅ Updated stats for ${playerData.name}: ${updatedStats.gamesPlayed} games, ${updatedStats.totalPoints} total points`);
            
          } else {
            // Create new player stats
            console.log(`🆕 Creating new stats for player: ${playerData.name}`);
            
            const newStats = {
              id: `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              playerName: playerData.name,
              team: playerData.team,
              gamesPlayed: 1,
              avgPoints: playerData.points || 0,
              avgRebounds: playerData.rebounds || 0,
              avgAssists: playerData.assists || 0,
              avgSteals: playerData.steals || 0,
              avgBlocks: playerData.blocks || 0,
              avgTurnovers: playerData.turnovers || 0,
              avgFouls: playerData.fouls || 0,
              avgFgPercentage: playerData.fgAttempted && playerData.fgAttempted > 0 
                ? Math.round((playerData.fgMade / playerData.fgAttempted) * 100 * 100) / 100 
                : 0.00,
              avgThreePercentage: playerData.threeAttempted && playerData.threeAttempted > 0 
                ? Math.round((playerData.threeMade / playerData.threeAttempted) * 100 * 100) / 100 
                : 0.00,
              avgFtPercentage: playerData.ftAttempted && playerData.ftAttempted > 0 
                ? Math.round((playerData.ftMade / playerData.ftAttempted) * 100 * 100) / 100 
                : 0.00,
              totalPoints: playerData.points || 0,
              totalRebounds: playerData.rebounds || 0,
              totalAssists: playerData.assists || 0,
              totalSteals: playerData.steals || 0,
              totalBlocks: playerData.blocks || 0,
              totalTurnovers: playerData.turnovers || 0,
              totalFouls: playerData.fouls || 0,
              totalFgMade: playerData.fgMade || 0,
              totalFgAttempted: playerData.fgAttempted || 0,
              totalThreeMade: playerData.threeMade || 0,
              totalThreeAttempted: playerData.threeAttempted || 0,
              totalFtMade: playerData.ftMade || 0,
              totalFtAttempted: playerData.ftAttempted || 0,
              userId: userId,
            };
            
            await supabaseService.createPlayerStats(newStats);
            console.log(`✅ Created new stats for ${playerData.name}: ${newStats.totalPoints} points`);
          }
        }
        
        console.log('✅ Player stats updated successfully for game:', gameId);
      } catch (error) {
        console.error('❌ Error updating player stats:', error);
        // Don't throw error - we don't want to fail the game save if stats update fails
      }
    }

    await updatePlayerStats(game.id, playersData, req.user.userId);

    const response: ApiResponse<{ game: Game; players: Player[] }> = {
      success: true,
      data: {
        game,
        players: await supabaseService.getGamesByUserId(req.user.userId),
      },
      message: 'Box score saved successfully',
    };

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    return res.status(200).json(response);
  } catch (error) {
    console.error('Error saving box score:', error);
    
    const response: ApiResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save box score',
    };

    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json(response);
  }
});

// Get all games for a user
router.get('/games', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: 'User not authenticated',
      };
      return res.status(401).json(response);
    }

    const games = await supabaseService.getGamesByUserId(req.user.userId);

    const response: ApiResponse<Game[]> = {
      success: true,
      data: games,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching games:', error);
    
    const response: ApiResponse = {
      success: false,
      error: 'Failed to fetch games',
    };

    return res.status(500).json(response);
  }
});

// Get specific game details
router.get('/games/:gameId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;

    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: 'User not authenticated',
      };
      return res.status(401).json(response);
    }

    const games = await supabaseService.getGamesByUserId(req.user.userId);
    const game = games.find(g => g.id === gameId);

    if (!game) {
      const response: ApiResponse = {
        success: false,
        error: 'Game not found',
      };
      return res.status(404).json(response);
    }

    const response: ApiResponse<Game> = {
      success: true,
      data: game,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching game:', error);
    
    const response: ApiResponse = {
      success: false,
      error: 'Failed to fetch game',
    };

    return res.status(500).json(response);
  }
});

// Generate custom team names after player name assignment
router.post('/generate-team-names', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: 'User not authenticated',
      };
      return res.status(401).json(response);
    }

    const { players } = req.body;

    if (!players || !Array.isArray(players)) {
      const response: ApiResponse = {
        success: false,
        error: 'Players array is required',
      };
      return res.status(400).json(response);
    }

    console.log('🔍 Generating team names after assignment for players:', players.map(p => ({ name: p.name, team: p.team })));

    // Generate custom team names using the new static method
    const { teamAName, teamBName } = EnhancedOCRService.generateCustomTeamNamesAfterAssignment(players);

    console.log('🔍 Generated custom team names:', { teamAName, teamBName });

    const response: ApiResponse<{ teamAName: string, teamBName: string }> = {
      success: true,
      data: { teamAName, teamBName },
      message: 'Team names generated successfully',
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Team name generation error:', error);
    
    const response: ApiResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate team names',
    };

    return res.status(500).json(response);
  }
});

export default router;
