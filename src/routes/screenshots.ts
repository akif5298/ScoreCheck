import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { prisma } from '@/services/database';
import visionService from '@/services/vision';
import BoxScoreParser from '@/services/boxScoreParser';
import { authenticateToken } from '@/middleware/auth';
import { ApiResponse, Game, Player, Team } from '@/types';

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = process.env.UPLOAD_PATH || './uploads';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `boxscore-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
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

// Upload and process box score screenshot
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

    // Read the uploaded file
    const imageBuffer = fs.readFileSync(req.file.path);

    // Extract text using Google Cloud Vision
    const textBlocks = await visionService.extractTextFromImage(imageBuffer);

    // Parse the box score data
    const parser = new BoxScoreParser(textBlocks);
    const boxScoreData = parser.parse();

    // Create game record
    const game = await prisma.game.create({
      data: {
        date: new Date(),
        homeTeam: boxScoreData.homeTeam,
        awayTeam: boxScoreData.awayTeam,
        homeScore: boxScoreData.homeScore,
        awayScore: boxScoreData.awayScore,
        screenshotUrl: req.file.path,
        processed: true,
        userId: req.user.userId,
      },
    });

    // Create player records
    const playerPromises = boxScoreData.players.map(playerData =>
      prisma.player.create({
        data: {
          name: playerData.name,
          team: playerData.team,
          position: playerData.position || null,
          minutes: playerData.minutes || null,
          points: playerData.points,
          rebounds: playerData.rebounds,
          assists: playerData.assists,
          steals: playerData.steals,
          blocks: playerData.blocks,
          turnovers: playerData.turnovers,
          fouls: playerData.fouls,
          fgMade: playerData.fgMade,
          fgAttempted: playerData.fgAttempted,
          fgPercentage: playerData.fgPercentage,
          threeMade: playerData.threeMade,
          threeAttempted: playerData.threeAttempted,
          threePercentage: playerData.threePercentage,
          ftMade: playerData.ftMade,
          ftAttempted: playerData.ftAttempted,
          ftPercentage: playerData.ftPercentage,
          plusMinus: playerData.plusMinus,
          gameId: game.id,
          userId: req.user!.userId,
        },
      })
    );

    // Create team records
    const teamPromises = boxScoreData.teams.map(teamData =>
      prisma.team.create({
        data: {
          name: teamData.name,
          isHome: teamData.isHome,
          points: teamData.points,
          rebounds: teamData.rebounds,
          assists: teamData.assists,
          steals: teamData.steals,
          blocks: teamData.blocks,
          turnovers: teamData.turnovers,
          fouls: teamData.fouls,
          fgMade: teamData.fgMade,
          fgAttempted: teamData.fgAttempted,
          fgPercentage: teamData.fgPercentage,
          threeMade: teamData.threeMade,
          threeAttempted: teamData.threeAttempted,
          threePercentage: teamData.threePercentage,
          ftMade: teamData.ftMade,
          ftAttempted: teamData.ftAttempted,
          ftPercentage: teamData.ftPercentage,
          gameId: game.id,
          userId: req.user!.userId,
        },
      })
    );

    // Wait for all database operations to complete
    await Promise.all([...playerPromises, ...teamPromises]);

    const response: ApiResponse<{ game: Game; players: Player[]; teams: Team[] }> = {
      success: true,
      data: {
        game,
        players: await prisma.player.findMany({ where: { gameId: game.id } }),
        teams: await prisma.team.findMany({ where: { gameId: game.id } }),
      },
      message: 'Box score processed successfully',
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Screenshot processing error:', error);
    
    const response: ApiResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process screenshot',
    };

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

    const games = await prisma.game.findMany({
      where: { userId: req.user.userId },
      include: {
        players: true,
        teams: true,
      },
      orderBy: { createdAt: 'desc' },
    });

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

    const game = await prisma.game.findFirst({
      where: { 
        id: gameId!,
        userId: req.user.userId,
      },
      include: {
        players: true,
        teams: true,
      },
    });

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

export default router;
