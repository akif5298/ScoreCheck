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

// Upload and process box score screenshot for review
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

    console.log('Extracted team totals:', {
      teamATotals: extractedData.teamATotals,
      teamBTotals: extractedData.teamBTotals
    });

    // Convert Player objects to ExtractedRow objects for the parser
    const extractedRows = extractedData.players.map((player: Player) => ({
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
    }));

    console.log('🚨🚨🚨 EXTRACTED ROWS DEBUG 🚨🚨🚨');
    console.log('🚨🚨🚨 Sample extracted rows:', extractedRows.slice(0, 3).map(r => ({ name: r.playerName, team: r.team })));

    // Parse the box score data
    const parser = new BoxScoreParser(
      extractedRows, 
      req.file.originalname,
      extractedData.teamAQuarters,
      extractedData.teamBQuarters
    );
    const boxScoreData = parser.parse();

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

    const { gameData, playersData, originalImageBuffer } = req.body;

    if (!gameData || !playersData || !originalImageBuffer) {
      const response: ApiResponse = {
        success: false,
        error: 'Missing required data for saving',
      };
      return res.status(400).json(response);
    }

    // Convert base64 image back to buffer and upload to Supabase
    const imageBuffer = Buffer.from(originalImageBuffer.split(',')[1], 'base64');
    const fileName = `${Date.now()}-boxscore.jpg`;
    const imageUrl = await supabaseService.uploadImage(imageBuffer, fileName);

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

    // Create player records
    const playerPromises = playersData.map((playerData: any) => {
      console.log(`🔍 Player data for database:`, {
        id: playerData.id,
        name: playerData.name,
        team: playerData.team
      });
      
      return supabaseService.createPlayer({
        id: playerData.id, // ✅ Add the ID field
        name: playerData.name,
        team: playerData.team,
        teammateGrade: playerData.teammateGrade,
        gameIdFromFile: playerData.gameIdFromFile,
        playerId: playerData.playerId,
        position: playerData.position,
        points: playerData.points,
        rebounds: playerData.rebounds,
        assists: playerData.assists,
        steals: playerData.steals,
        blocks: playerData.blocks,
        turnovers: playerData.turnovers,
        fouls: playerData.fouls,
        fgMade: playerData.fgMade,
        fgAttempted: playerData.fgAttempted,
        threeMade: playerData.threeMade,
        threeAttempted: playerData.threeAttempted,
        ftMade: playerData.ftMade,
        ftAttempted: playerData.ftAttempted,
        gameId: game.id,
        userId: req.user!.userId,
      });
    });

    // Wait for all database operations to complete
    await Promise.all(playerPromises);

    // Create team records with image number format IDs
    const imageNumber = gameData.imageNumber || extractImageNumber(req.body.originalFileName);
    const homeTeamData = {
      id: `team_${imageNumber}_home_${Math.random().toString(36).substr(2, 5)}`,
      name: gameData.homeTeam,
      isHome: true,
      points: gameData.homeScore,
      gameId: game.id,
      userId: req.user!.userId,
      // Add team quarter totals if available
      ...(gameData.teamAQuarters && {
        teamAQuarters: gameData.teamAQuarters
      })
    };
    
    const awayTeamData = {
      id: `team_${imageNumber}_away_${Math.random().toString(36).substr(2, 5)}`,
      name: gameData.awayTeam,
      isHome: false,
      points: gameData.awayScore,
      gameId: game.id,
      userId: req.user!.userId,
      // Add team quarter totals if available
      ...(gameData.teamBQuarters && {
        teamBQuarters: gameData.teamBQuarters
      })
    };

    const teamPromises = [
      supabaseService.createTeam(homeTeamData),
      supabaseService.createTeam(awayTeamData)
    ];

    await Promise.all(teamPromises);

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
