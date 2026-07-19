import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import { fromBuffer as fileTypeFromBuffer } from 'file-type';
import supabaseService from '@/services/supabase';
import { EnhancedOCRService } from '@/services/enhancedOCRService';
import BoxScoreParser from '@/services/boxScoreParser';
import { authenticateToken } from '@/middleware/auth';
import { ApiResponse, Game, Player } from '@/types';
import { classifyScreenshot } from '@/services/junkFilter';
import { assertExtractionHostReachable } from '@/services/ollamaExtractor';
import { computePerceptualHash, hammingDistance } from '@/utils/imageHash';
import { ValidationError, ExtractionUnavailableError } from '@/errors';
import logger from '@/utils/logger';
import {
  getMappingsForUser,
  getAllowedNamesForUser,
  getAllowedNamesArray,
} from '@/services/mappingService';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  UPLOAD_RATE_LIMIT_WINDOW_MS,
  UPLOAD_RATE_LIMIT_MAX,
  EXTRACTION_DAILY_LIMIT,
} from '@/constants';

const router = Router();

// Bridges perceptual hashes from upload time to save time (single-instance only; lost on restart)
const pendingHashes = new Map<string, string>();

// Incoming player data shape from the review UI (all fields optional until validated)
interface IncomingPlayerData {
  id?: string;
  name?: string;
  team?: string;
  teammateGrade?: string;
  points?: number;
  rebounds?: number;
  assists?: number;
  steals?: number;
  blocks?: number;
  turnovers?: number;
  fouls?: number;
  fgMade?: number;
  fgAttempted?: number;
  threeMade?: number;
  threeAttempted?: number;
  ftMade?: number;
  ftAttempted?: number;
}

// Rate limiter applied only to upload endpoints (stricter than the global
// limiter). Keyed by user id (these routes always run after authenticateToken)
// so it's a true per-user limit, not per-IP behind Render's shared proxy.
const uploadRateLimit = rateLimit({
  windowMs: UPLOAD_RATE_LIMIT_WINDOW_MS,
  max: UPLOAD_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.userId ?? 'anonymous',
  message: { success: false, error: 'Too many uploads. Please wait a minute and try again.' },
});

// Per-user daily extraction quota. In-memory (single-instance only, like
// pendingHashes above) — bounds inference cost/abuse; a Redis-backed version is
// future work alongside an async extraction queue.
const extractionCounts = new Map<string, { day: string; count: number }>();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function extractionUsedToday(userId: string): number {
  const entry = extractionCounts.get(userId);
  return entry && entry.day === todayKey() ? entry.count : 0;
}

function recordExtractions(userId: string, n: number): void {
  const day = todayKey();
  const entry = extractionCounts.get(userId);
  if (entry && entry.day === day) entry.count += n;
  else extractionCounts.set(userId, { day, count: n });
}

// Gate: rejects when the user is already at their daily limit. Per-file counts
// are recorded by the handlers after extraction actually runs.
function extractionQuota(req: Request, res: Response, next: () => void): void {
  const userId = req.user?.userId;
  if (userId && extractionUsedToday(userId) >= EXTRACTION_DAILY_LIMIT) {
    res.status(429).json({
      success: false,
      error: `Daily extraction limit reached (${EXTRACTION_DAILY_LIMIT}/day). Try again tomorrow.`,
    } as ApiResponse);
    return;
  }
  next();
}

// Rejects buffers whose magic bytes don't match an allowed image type.
async function validateMagicBytes(buffer: Buffer): Promise<void> {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(detected.mime)) {
    throw new ValidationError(
      `File content does not match an allowed image type${detected ? ` (detected: ${detected.mime})` : ''}`,
      'file',
    );
  }
}

// Helper function to extract image number from filename
function extractImageNumber(filename?: string): string {
  if (!filename) {
    return Date.now().toString();
  }

  const patterns = [
    /IMG_(\d+)\./i,
    /(\d+)-boxscore\./i,
    /(\d+)\./i,
    /(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = filename.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return Date.now().toString();
}

// Configure multer for memory storage (we'll upload directly to Supabase)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
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
router.post('/upload-multiple', authenticateToken, uploadRateLimit, extractionQuota, upload.array('screenshots', 10), async (req: Request, res: Response) => {
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

    // Fail fast with a clean 503 if the extraction host is down (the per-call
    // paths below swallow failures into empty results).
    await assertExtractionHostReachable();

    // Process files in batches of 2
    const results = [];
    const batchSize = 2;

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);

      const batchPromises = batch.map(async (file) => {
        // Reject files whose bytes don't match an image type before hitting OCR
        await validateMagicBytes(file.buffer);

        // Perceptual-hash duplicate check (before OCR to avoid wasted GCV calls)
        const imageHash = await computePerceptualHash(file.buffer);
        const existingHashes = await supabaseService.getGameHashesByUserId(req.user!.userId);
        const isDuplicate = existingHashes.some(h => hammingDistance(imageHash, h) <= 10);
        if (isDuplicate) {
          throw Object.assign(new Error(`${file.originalname}: visually similar screenshot already saved`), {
            code: 'DUPLICATE_SCREENSHOT',
          });
        }

        // Junk filter — fails open if Ollama is offline.
        const junkResult = await classifyScreenshot(file.buffer);
        if (!junkResult.isValidBoxScore && junkResult.confidence === 'high') {
          throw new Error(`${file.originalname}: image does not appear to be a valid NBA 2K box score`);
        }

        const enhancedOCRService = new EnhancedOCRService();
        // Mappings fetched once per batch outside the per-file loop — not available here,
        // so fetch per file (fail-open on error).
        let fileMappings: Map<string, string> | undefined;
        try { fileMappings = await getMappingsForUser(req.user!.userId); } catch {}
        const extractedData = await enhancedOCRService.extractStructuredDataFromImage(file.buffer, file.originalname, fileMappings);

        // Upload to Supabase
        const imageNumber = extractImageNumber(file.originalname);
        const userId = req.user!.userId;
        const fileName = `${userId}-${imageNumber}-boxscore.${file.originalname.split('.').pop()}`;
        const originalImageUrl = await supabaseService.uploadImage(file.buffer, fileName);
        pendingHashes.set(originalImageUrl, imageHash);

        return {
          extractedData,
          originalImageUrl,
          fileName: file.originalname,
          processedAt: new Date().toISOString(),
        };
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    recordExtractions(req.user.userId, results.length);

    const response: ApiResponse = {
      success: true,
      data: {
        results,
        totalProcessed: results.length,
      },
    };

    return res.json(response);
  } catch (error) {
    if (error instanceof ExtractionUnavailableError) {
      logger.warn('Extraction host unreachable on upload-multiple');
      return res.status(503).json({
        success: false,
        error: 'Extraction service is temporarily unavailable. Please try again shortly.',
      } as ApiResponse);
    }
    logger.error({ err: error }, 'Multiple upload error');
    const response: ApiResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process images',
    };
    return res.status(error instanceof ValidationError ? 422 : 500).json(response);
  }
});

// Keep the original single upload for backward compatibility
router.post('/upload', authenticateToken, uploadRateLimit, extractionQuota, upload.single('screenshot'), async (req: Request, res: Response) => {
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

    // Fail fast with a clean 503 if the extraction host is down.
    await assertExtractionHostReachable();

    // Reject files whose bytes don't match an image type before hitting OCR
    await validateMagicBytes(req.file.buffer);

    // Perceptual-hash duplicate check (before OCR to avoid wasted GCV calls)
    const imageHash = await computePerceptualHash(req.file.buffer);
    const existingHashes = await supabaseService.getGameHashesByUserId(req.user.userId);
    if (existingHashes.some(h => hammingDistance(imageHash, h) <= 10)) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_SCREENSHOT',
        error: 'A visually similar screenshot has already been saved',
      });
    }

    // Junk filter — runs before the expensive GCV pipeline; fails open if Ollama is offline.
    const junkResult = await classifyScreenshot(req.file.buffer);
    if (!junkResult.isValidBoxScore && junkResult.confidence === 'high') {
      const response: ApiResponse = {
        success: false,
        error: 'The uploaded image does not appear to be a valid NBA 2K box score.',
      };
      return res.status(422).json(response);
    }

    // Fetch gamertag→displayName mappings for this user (fail-open: proceed without if DB errors)
    let mappings: Map<string, string> | undefined;
    try {
      mappings = await getMappingsForUser(req.user.userId);
    } catch (err) {
      logger.error({ err }, 'Failed to fetch player mappings — proceeding without mapping');
    }

    // Create fresh OCR service instance for each request to prevent caching
    const enhancedOCRService = new EnhancedOCRService();
    const extractedData = await enhancedOCRService.extractStructuredDataFromImage(req.file.buffer, req.file.originalname, mappings);

    if (extractedData.players.length !== 10) {
      logger.warn({ playerCount: extractedData.players.length, file: req.file.originalname }, 'Expected 10 players from OCR');
    }

    // Convert Player objects to ExtractedRow objects for the parser
    const extractedRows = extractedData.players.map((player: Player) => ({
      id: player.id,
      playerName: player.name,
      team: player.team,
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

    // Parse the box score data
    const parser = new BoxScoreParser(
      extractedRows,
      req.file.originalname,
      extractedData.teamAQuarters,
      extractedData.teamBQuarters,
    );
    const boxScoreData = parser.parse();

    if (boxScoreData.players.length !== extractedRows.length) {
      logger.warn(
        { before: extractedRows.length, after: boxScoreData.players.length },
        'BoxScoreParser dropped players',
      );
    }

    // Extract image number for consistent ID generation
    const imageNumber = extractImageNumber(req.file.originalname);

    // Persist the screenshot to Supabase Storage and key the review response by
    // its object path (stored in games.screenshotUrl on save — never base64).
    const ext = req.file.originalname.split('.').pop() || 'jpg';
    const objectPath = `${req.user.userId}-${imageNumber}-boxscore.${ext}`;
    const originalImageUrl = await supabaseService.uploadImage(req.file.buffer, objectPath);
    pendingHashes.set(originalImageUrl, imageHash);
    const responseData = {
      extractedData: {
        ...boxScoreData,
        homeTeam: extractedData.gameData?.homeTeam || boxScoreData.homeTeam,
        awayTeam: extractedData.gameData?.awayTeam || boxScoreData.awayTeam,
        teamATotals: extractedData.teamATotals,
        teamBTotals: extractedData.teamBTotals,
        teamAQuarters: extractedData.teamAQuarters,
        teamBQuarters: extractedData.teamBQuarters,
        imageNumber,
      },
      originalImageUrl,
      originalFileName: req.file.originalname,
    };

    recordExtractions(req.user.userId, 1);

    // Explicitly prevent caching of dynamic OCR results
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    return res.status(200).json(responseData);
  } catch (error) {
    if (error instanceof ExtractionUnavailableError) {
      logger.warn('Extraction host unreachable on upload');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({
        success: false,
        error: 'Extraction service is temporarily unavailable. Please try again shortly.',
      } as ApiResponse);
    }
    logger.error({ err: error }, 'Screenshot processing error');

    const response: ApiResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process screenshot',
    };

    res.setHeader('Cache-Control', 'no-store');
    return res.status(error instanceof ValidationError ? 422 : 500).json(response);
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

    const { gameData, playersData, imageUrl, originalFileName } = req.body as {
      gameData: {
        date?: string;
        homeTeam: string;
        awayTeam: string;
        homeScore: number;
        awayScore: number;
      };
      playersData: IncomingPlayerData[];
      imageUrl: string;
      originalFileName?: string;
    };

    if (!gameData || !playersData || !imageUrl) {
      const response: ApiResponse = {
        success: false,
        error: 'Missing required data for saving',
      };
      return res.status(400).json(response);
    }

    // Check if a game with this image URL already exists to prevent duplicates
    const existingGame = await supabaseService.getGameByScreenshotUrl(imageUrl, req.user.userId);
    if (existingGame) {
      logger.info({ gameId: existingGame.id }, 'Duplicate save request — returning existing game');
      const response: ApiResponse<{ game: Game; players: Player[] }> = {
        success: true,
        data: {
          game: existingGame,
          players: await supabaseService.getGamesByUserId(req.user.userId),
        },
        message: 'Game already exists in database',
      };
      return res.status(200).json(response);
    }

    // Pre-generate a stable ID so players and teams can reference the game
    // before the transaction commits, then save everything atomically.
    const gameId = `game_${Date.now()}`;

    // Extract image number from the original filename for gameIdFromFile
    const playerImageNumber = extractImageNumber(originalFileName);

    const getPositionFromPlayerNumber = (playerNum: string): string => {
      const num = parseInt(playerNum);
      if (num === 0 || num === 5) return 'PG';
      if (num === 1 || num === 6) return 'SG';
      if (num === 2 || num === 7) return 'SF';
      if (num === 3 || num === 8) return 'PF';
      if (num === 4 || num === 9) return 'C';
      return 'Unknown';
    };

    // Pre-compute all player write inputs (no DB calls yet)
    const playerInputs = playersData.map((playerData: IncomingPlayerData, index: number) => {
      const playerNumMatch = playerData.id?.match(/_(\d+)_/);
      const playerNumber = playerNumMatch?.[1] ?? (index + 1).toString();
      const playerId = `${playerImageNumber}_P${playerNumber}`;
      const position = getPositionFromPlayerNumber(playerNumber);
      const fgMade = Number(playerData.fgMade) || 0;
      const fgAttempted = Number(playerData.fgAttempted) || 0;
      const threeMade = Number(playerData.threeMade) || 0;
      const threeAttempted = Number(playerData.threeAttempted) || 0;
      const ftMade = Number(playerData.ftMade) || 0;
      const ftAttempted = Number(playerData.ftAttempted) || 0;
      return {
        id: playerData.id || `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: playerData.name || 'Unknown Player',
        team: playerData.team || 'Unknown Team',
        teammateGrade: playerData.teammateGrade || 'N/A',
        gameIdFromFile: playerImageNumber,
        playerId,
        position,
        points: playerData.points || 0,
        rebounds: playerData.rebounds || 0,
        assists: playerData.assists || 0,
        steals: playerData.steals || 0,
        blocks: playerData.blocks || 0,
        turnovers: playerData.turnovers || 0,
        fouls: playerData.fouls || 0,
        fgMade,
        fgAttempted,
        threeMade,
        threeAttempted,
        ftMade,
        ftAttempted,
        fg_percentage: fgAttempted > 0
          ? Math.round((fgMade / fgAttempted) * 100 * 100) / 100
          : 0.00,
        three_percentage: threeAttempted > 0
          ? Math.round((threeMade / threeAttempted) * 100 * 100) / 100
          : 0.00,
        ft_percentage: ftAttempted > 0
          ? Math.round((ftMade / ftAttempted) * 100 * 100) / 100
          : 0.00,
        gameId,
        userId: req.user!.userId,
      };
    });

    // Pre-compute team totals from player data
    const homeTeamPlayers = playersData.filter((p) => p.team === gameData.homeTeam);
    const awayTeamPlayers = playersData.filter((p) => p.team === gameData.awayTeam);

    const homeTeamTotals = {
      rebounds: homeTeamPlayers.reduce((sum, p) => sum + (p.rebounds || 0), 0),
      assists: homeTeamPlayers.reduce((sum, p) => sum + (p.assists || 0), 0),
      steals: homeTeamPlayers.reduce((sum, p) => sum + (p.steals || 0), 0),
      blocks: homeTeamPlayers.reduce((sum, p) => sum + (p.blocks || 0), 0),
      turnovers: homeTeamPlayers.reduce((sum, p) => sum + (p.turnovers || 0), 0),
      fouls: homeTeamPlayers.reduce((sum, p) => sum + (p.fouls || 0), 0),
      fgMade: homeTeamPlayers.reduce((sum, p) => sum + (p.fgMade || 0), 0),
      fgAttempted: homeTeamPlayers.reduce((sum, p) => sum + (p.fgAttempted || 0), 0),
      threeMade: homeTeamPlayers.reduce((sum, p) => sum + (p.threeMade || 0), 0),
      threeAttempted: homeTeamPlayers.reduce((sum, p) => sum + (p.threeAttempted || 0), 0),
      ftMade: homeTeamPlayers.reduce((sum, p) => sum + (p.ftMade || 0), 0),
      ftAttempted: homeTeamPlayers.reduce((sum, p) => sum + (p.ftAttempted || 0), 0),
    };

    const awayTeamTotals = {
      rebounds: awayTeamPlayers.reduce((sum, p) => sum + (p.rebounds || 0), 0),
      assists: awayTeamPlayers.reduce((sum, p) => sum + (p.assists || 0), 0),
      steals: awayTeamPlayers.reduce((sum, p) => sum + (p.steals || 0), 0),
      blocks: awayTeamPlayers.reduce((sum, p) => sum + (p.blocks || 0), 0),
      turnovers: awayTeamPlayers.reduce((sum, p) => sum + (p.turnovers || 0), 0),
      fouls: awayTeamPlayers.reduce((sum, p) => sum + (p.fouls || 0), 0),
      fgMade: awayTeamPlayers.reduce((sum, p) => sum + (p.fgMade || 0), 0),
      fgAttempted: awayTeamPlayers.reduce((sum, p) => sum + (p.fgAttempted || 0), 0),
      threeMade: awayTeamPlayers.reduce((sum, p) => sum + (p.threeMade || 0), 0),
      threeAttempted: awayTeamPlayers.reduce((sum, p) => sum + (p.threeAttempted || 0), 0),
      ftMade: awayTeamPlayers.reduce((sum, p) => sum + (p.ftMade || 0), 0),
      ftAttempted: awayTeamPlayers.reduce((sum, p) => sum + (p.ftAttempted || 0), 0),
    };

    const imageNumber = playerImageNumber;

    const homeTeamInput = {
      id: `team_${imageNumber}_home_${Math.random().toString(36).substr(2, 5)}`,
      name: gameData.homeTeam,
      isHome: true,
      points: gameData.homeScore,
      rebounds: homeTeamTotals.rebounds,
      assists: homeTeamTotals.assists,
      steals: homeTeamTotals.steals,
      blocks: homeTeamTotals.blocks,
      turnovers: homeTeamTotals.turnovers,
      fouls: homeTeamTotals.fouls,
      fgMade: homeTeamTotals.fgMade,
      fgAttempted: homeTeamTotals.fgAttempted,
      threeMade: homeTeamTotals.threeMade,
      threeAttempted: homeTeamTotals.threeAttempted,
      ftMade: homeTeamTotals.ftMade,
      ftAttempted: homeTeamTotals.ftAttempted,
      fg_percentage: homeTeamTotals.fgAttempted > 0
        ? Math.round((homeTeamTotals.fgMade / homeTeamTotals.fgAttempted) * 100 * 100) / 100
        : 0.00,
      three_percentage: homeTeamTotals.threeAttempted > 0
        ? Math.round((homeTeamTotals.threeMade / homeTeamTotals.threeAttempted) * 100 * 100) / 100
        : 0.00,
      ft_percentage: homeTeamTotals.ftAttempted > 0
        ? Math.round((homeTeamTotals.ftMade / homeTeamTotals.ftAttempted) * 100 * 100) / 100
        : 0.00,
      gameId,
      userId: req.user!.userId,
    };

    const awayTeamInput = {
      id: `team_${imageNumber}_away_${Math.random().toString(36).substr(2, 5)}`,
      name: gameData.awayTeam,
      isHome: false,
      points: gameData.awayScore,
      rebounds: awayTeamTotals.rebounds,
      assists: awayTeamTotals.assists,
      steals: awayTeamTotals.steals,
      blocks: awayTeamTotals.blocks,
      turnovers: awayTeamTotals.turnovers,
      fouls: awayTeamTotals.fouls,
      fgMade: awayTeamTotals.fgMade,
      fgAttempted: awayTeamTotals.fgAttempted,
      threeMade: awayTeamTotals.threeMade,
      threeAttempted: awayTeamTotals.threeAttempted,
      ftMade: awayTeamTotals.ftMade,
      ftAttempted: awayTeamTotals.ftAttempted,
      fg_percentage: awayTeamTotals.fgAttempted > 0
        ? Math.round((awayTeamTotals.fgMade / awayTeamTotals.fgAttempted) * 100 * 100) / 100
        : 0.00,
      three_percentage: awayTeamTotals.threeAttempted > 0
        ? Math.round((awayTeamTotals.threeMade / awayTeamTotals.threeAttempted) * 100 * 100) / 100
        : 0.00,
      ft_percentage: awayTeamTotals.ftAttempted > 0
        ? Math.round((awayTeamTotals.ftMade / awayTeamTotals.ftAttempted) * 100 * 100) / 100
        : 0.00,
      gameId,
      userId: req.user!.userId,
    };

    // Retrieve the perceptual hash stored at upload time (null if upload route not used)
    const savedImageHash = pendingHashes.get(imageUrl) ?? null;
    pendingHashes.delete(imageUrl);

    // Atomic save: game + players + teams in a single pgClient transaction
    const { game } = await supabaseService.saveGameWithStats(
      {
        id: gameId,
        date: gameData.date || new Date().toISOString(),
        homeTeam: gameData.homeTeam,
        awayTeam: gameData.awayTeam,
        homeScore: gameData.homeScore,
        awayScore: gameData.awayScore,
        screenshotUrl: imageUrl,
        imageHash: savedImageHash,
        processed: true,
        userId: req.user.userId,
      },
      playerInputs,
      homeTeamInput,
      awayTeamInput,
    );

    // Helper: accumulate player_totals for tracked players (does not write to player_stats directly).
    // Tracked players = the user's mapped display names.
    async function updatePlayerStats(gameId: string, players: IncomingPlayerData[], userId: string): Promise<void> {
      try {
        const allowedNames = await getAllowedNamesForUser(userId);
        for (const playerData of players) {
          if (!playerData.name || !allowedNames.has(playerData.name)) {
            continue;
          }
          await updatePlayerTotals(playerData, userId);
        }
      } catch (error) {
        // Don't fail the game save if totals update fails
        logger.error({ err: error, gameId }, 'Error updating player totals');
      }
    }

    async function updatePlayerTotals(playerData: IncomingPlayerData, userId: string): Promise<void> {
      const name = playerData.name;
      if (!name) return;
      try {
        const existingTotals = await supabaseService.getPlayerTotalsByPlayerName(name, userId);

        if (existingTotals) {
          const safeAdd = (a: number, b: number) => {
            const aVal = isNaN(a) ? 0 : (a || 0);
            const bVal = isNaN(b) ? 0 : (b || 0);
            return aVal + bVal;
          };

          const updatedTotals = {
            total_games: existingTotals.total_games + 1,
            total_points: safeAdd(existingTotals.total_points, playerData.points ?? 0),
            total_assists: safeAdd(existingTotals.total_assists, playerData.assists ?? 0),
            total_rebounds: safeAdd(existingTotals.total_rebounds, playerData.rebounds ?? 0),
            total_steals: safeAdd(existingTotals.total_steals, playerData.steals ?? 0),
            total_blocks: safeAdd(existingTotals.total_blocks, playerData.blocks ?? 0),
            total_fouls: safeAdd(existingTotals.total_fouls, playerData.fouls ?? 0),
            total_turnovers: safeAdd(existingTotals.total_turnovers, playerData.turnovers ?? 0),
            total_fgm: safeAdd(existingTotals.total_fgm, playerData.fgMade ?? 0),
            total_fga: safeAdd(existingTotals.total_fga, playerData.fgAttempted ?? 0),
            total_3pm: safeAdd(existingTotals.total_3pm, playerData.threeMade ?? 0),
            total_3pa: safeAdd(existingTotals.total_3pa, playerData.threeAttempted ?? 0),
            total_ftm: safeAdd(existingTotals.total_ftm, playerData.ftMade ?? 0),
            total_fta: safeAdd(existingTotals.total_fta, playerData.ftAttempted ?? 0),
            fg_percentage: 0.00,
            three_percentage: 0.00,
            ft_percentage: 0.00,
          };

          updatedTotals.fg_percentage = updatedTotals.total_fga > 0
            ? Math.round((updatedTotals.total_fgm / updatedTotals.total_fga) * 100 * 100) / 100
            : 0.00;
          updatedTotals.three_percentage = updatedTotals.total_3pa > 0
            ? Math.round((updatedTotals.total_3pm / updatedTotals.total_3pa) * 100 * 100) / 100
            : 0.00;
          updatedTotals.ft_percentage = updatedTotals.total_fta > 0
            ? Math.round((updatedTotals.total_ftm / updatedTotals.total_fta) * 100 * 100) / 100
            : 0.00;

          await supabaseService.updatePlayerTotals(name, userId, updatedTotals);

        } else {
          const safeNumber = (value: number | undefined) => {
            const num = Number(value);
            return isNaN(num) ? 0 : num;
          };

          const newTotals = {
            id: `total_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            player_id: playerData.id
              ? `${playerImageNumber}_P${playerData.id.match(/_(\d+)_/)?.[1] ?? '1'}`
              : `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            player_name: name,
            team: playerData.team ?? '',
            total_games: 1,
            total_points: safeNumber(playerData.points),
            total_assists: safeNumber(playerData.assists),
            total_rebounds: safeNumber(playerData.rebounds),
            total_steals: safeNumber(playerData.steals),
            total_blocks: safeNumber(playerData.blocks),
            total_fouls: safeNumber(playerData.fouls),
            total_turnovers: safeNumber(playerData.turnovers),
            total_fgm: safeNumber(playerData.fgMade),
            total_fga: safeNumber(playerData.fgAttempted),
            total_3pm: safeNumber(playerData.threeMade),
            total_3pa: safeNumber(playerData.threeAttempted),
            total_ftm: safeNumber(playerData.ftMade),
            total_fta: safeNumber(playerData.ftAttempted),
            fg_percentage: playerData.fgAttempted && playerData.fgAttempted > 0
              ? Math.round((safeNumber(playerData.fgMade) / safeNumber(playerData.fgAttempted)) * 100 * 100) / 100
              : 0.00,
            three_percentage: playerData.threeAttempted && playerData.threeAttempted > 0
              ? Math.round((safeNumber(playerData.threeMade) / safeNumber(playerData.threeAttempted)) * 100 * 100) / 100
              : 0.00,
            ft_percentage: playerData.ftAttempted && playerData.ftAttempted > 0
              ? Math.round((safeNumber(playerData.ftMade) / safeNumber(playerData.ftAttempted)) * 100 * 100) / 100
              : 0.00,
            userid: userId,
          };

          await supabaseService.createPlayerTotals(newTotals);
        }
      } catch (error) {
        // Don't fail the game save if totals update fails
        logger.error({ err: error, playerName: name }, 'Error updating player totals');
      }
    }

    await updatePlayerStats(game.id, playersData, req.user.userId);

    // Update player_stats table with averages from player_totals
    await supabaseService.updatePlayerStatsFromTotals(
      req.user.userId,
      await getAllowedNamesArray(req.user.userId),
    );

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
    logger.error({ err: error }, 'Error saving box score');

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
    logger.error({ err: error }, 'Error fetching games');

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
    logger.error({ err: error }, 'Error fetching game');

    const response: ApiResponse = {
      success: false,
      error: 'Failed to fetch game',
    };

    return res.status(500).json(response);
  }
});

// Mint a fresh signed URL for a game's stored screenshot (owner-scoped).
// games.screenshotUrl holds an object path, not a viewable URL.
router.get('/games/:gameId/screenshot', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;

    if (!req.user) {
      return res.status(401).json({ success: false, error: 'User not authenticated' } as ApiResponse);
    }

    const game = await supabaseService.getGameById(gameId!, req.user.userId);
    if (!game) {
      return res.status(404).json({ success: false, error: 'Game not found' } as ApiResponse);
    }

    const url = await supabaseService.getSignedUrl(game.screenshotUrl);
    if (!url) {
      return res.status(404).json({ success: false, error: 'No screenshot for this game' } as ApiResponse);
    }

    return res.status(200).json({ success: true, data: { url } } as ApiResponse);
  } catch (error) {
    logger.error({ err: error }, 'Error signing screenshot URL');
    return res.status(500).json({ success: false, error: 'Failed to load screenshot' } as ApiResponse);
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

    // Generate custom team names from the user's mapped display names
    const customNames = await getAllowedNamesArray(req.user.userId);
    const { teamAName, teamBName } = EnhancedOCRService.generateCustomTeamNamesAfterAssignment(
      players,
      customNames,
    );

    const response: ApiResponse<{ teamAName: string; teamBName: string }> = {
      success: true,
      data: { teamAName, teamBName },
      message: 'Team names generated successfully',
    };

    return res.status(200).json(response);
  } catch (error) {
    logger.error({ err: error }, 'Team name generation error');

    const response: ApiResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate team names',
    };

    return res.status(500).json(response);
  }
});

// Start game edit route (subtract current stats from totals)
router.post('/games/:gameId/start-edit', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;

    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: 'User not authenticated',
      };
      return res.status(401).json(response);
    }

    if (!gameId) {
      const response: ApiResponse = {
        success: false,
        error: 'Game ID is required',
      };
      return res.status(400).json(response);
    }

    const allowedNames = await getAllowedNamesArray(req.user.userId);
    const result = await supabaseService.startGameEdit(gameId, req.user.userId, allowedNames);

    if (result) {
      const response: ApiResponse = {
        success: true,
        data: result,
        message: 'Game edit started successfully',
      };
      return res.json(response);
    } else {
      const response: ApiResponse = {
        success: false,
        error: 'Game not found',
      };
      return res.status(404).json(response);
    }
  } catch (error) {
    logger.error({ err: error }, 'Error starting game edit');
    const response: ApiResponse = {
      success: false,
      error: 'Internal server error',
    };
    return res.status(500).json(response);
  }
});

// Update game details
router.put('/games/:gameId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;
    const { homeTeam, awayTeam, homeScore, awayScore, date, players } = req.body;

    if (!req.user) {
      const response: ApiResponse = {
        success: false,
        error: 'User not authenticated',
      };
      return res.status(401).json(response);
    }

    if (!homeTeam || !awayTeam || homeScore === undefined || awayScore === undefined || !date || !players) {
      const response: ApiResponse = {
        success: false,
        error: 'Missing required fields: homeTeam, awayTeam, homeScore, awayScore, date, players',
      };
      return res.status(400).json(response);
    }

    const allowedNames = await getAllowedNamesArray(req.user.userId);
    const updatedGame = await supabaseService.updateGame(gameId!, req.user.userId, allowedNames, {
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      date,
      players,
    });

    if (!updatedGame) {
      const response: ApiResponse = {
        success: false,
        error: 'Game not found',
      };
      return res.status(404).json(response);
    }

    const response: ApiResponse<Game> = {
      success: true,
      data: updatedGame,
      message: 'Game updated successfully',
    };

    return res.status(200).json(response);
  } catch (error) {
    logger.error({ err: error }, 'Error updating game');

    const response: ApiResponse = {
      success: false,
      error: 'Failed to update game',
    };

    return res.status(500).json(response);
  }
});

export default router;
