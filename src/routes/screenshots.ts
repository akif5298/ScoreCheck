import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { fromBuffer as fileTypeFromBuffer } from 'file-type';
import supabaseService, { DuplicateGameError } from '@/services/supabase';
import { EnhancedOCRService } from '@/services/enhancedOCRService';
import BoxScoreParser from '@/services/boxScoreParser';
import { authenticateToken, requireUserId } from '@/middleware/auth';
import { resolveSquad, requireSquadId } from '@/middleware/squad';
import { getMembership } from '@/services/squadService';
import { ApiResponse, Game, Player } from '@/types';
import { classifyScreenshot } from '@/services/junkFilter';
import { assertExtractionHostReachable, warmupModel } from '@/services/ollamaExtractor';
import {
  computePerceptualHash,
  hammingDistance,
  DUPLICATE_HAMMING_THRESHOLD,
} from '@/utils/imageHash';
import { ValidationError, ExtractionUnavailableError } from '@/errors';
import { TtlMap } from '@/utils/ttlMap';
import logger from '@/utils/logger';
import {
  getMappingsForSquad,
  getAllowedNamesForSquad,
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

// Bridges perceptual hashes from upload time to save time (single-instance only; lost on restart).
//
// Bounded and self-expiring: entries are removed on the terminal paths (a committed save,
// or a duplicate), but an upload abandoned at the review step has no terminal path and used
// to pin its entry for the lifetime of the process.
//
// Six hours is far longer than a review takes while still bounding growth; the cap is the
// backstop if something goes wrong. Losing an entry is safe — the save path reads a miss as
// "no hash known" and stores the game without one, which only costs future dedup on that
// single screenshot.
const PENDING_HASH_TTL_MS = 6 * 60 * 60 * 1000;
const PENDING_HASH_MAX_ENTRIES = 5000;
const pendingHashes = new TtlMap<string>(PENDING_HASH_TTL_MS, PENDING_HASH_MAX_ENTRIES);

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

// Lightweight limiter for the warmup poke. Generous — a warmup is cheap and
// idempotent — but bounded so a client bug or bad actor can't hammer the GPU host.
// Kept separate from uploadRateLimit so warming never eats into a user's actual
// upload allowance.
const warmupRateLimit = rateLimit({
  windowMs: 60_000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.userId ?? 'anonymous',
  // A throttled warmup is a no-op, not an error — the host is already warm (or
  // warming) from the earlier poke. Answer 202 so the fire-and-forget client stays quiet.
  handler: (_req: Request, res: Response) =>
    res.status(202).json({ success: true, message: 'Already warming' } as ApiResponse),
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

// Hands back reservations that were never spent. Floors at zero so a refund can never
// mint allowance, and ignores a stale day so a refund crossing midnight cannot decrement
// the new day's count.
function refundExtractions(userId: string, n: number): void {
  if (n <= 0) return;
  const entry = extractionCounts.get(userId);
  if (entry && entry.day === todayKey()) {
    entry.count = Math.max(0, entry.count - n);
  }
}

// How many extractions this request is asking for. Used by both the gate and the
// handler's reconciliation so the two can never disagree about what was reserved.
function extractionCost(req: Request): number {
  if (Array.isArray(req.files)) return req.files.length;
  return req.file ? 1 : 0;
}

// Gate: reserves the whole request's cost before any inference runs.
//
// This used to check `used >= limit` and let the handlers record afterwards, which meant
// the limit was only ever enforced against a count that predated the batch: a user at
// 49/50 could send 10 files and land at 59. Reserving up front makes an over-limit batch
// fail as a unit.
//
// Runs AFTER multer, unlike the check it replaces — the file count is the thing being
// authorised, and req.files does not exist until multer has parsed the body. uploadRateLimit
// still runs first, so the cheap abuse ceiling is unchanged.
//
// Whatever is reserved here and not spent is refunded by the handler; see extractionCost.
function extractionQuota(req: Request, res: Response, next: () => void): void {
  const userId = req.user?.userId;
  if (!userId) return next();

  const requested = extractionCost(req);
  // No files: the handler owns that 400, and it costs no inference.
  if (requested === 0) return next();

  if (extractionUsedToday(userId) + requested > EXTRACTION_DAILY_LIMIT) {
    res.status(429).json({
      success: false,
      error: `Daily extraction limit reached (${EXTRACTION_DAILY_LIMIT}/day). Try again tomorrow.`,
    } as ApiResponse);
    return;
  }

  recordExtractions(userId, requested);
  next();
}

// The batch path signals a duplicate by tagging an Error with a code, because it has to
// unwind out of a per-file promise rather than return a response directly.
function isDuplicateScreenshotError(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error &&
    (error as { code?: unknown }).code === 'DUPLICATE_SCREENSHOT'
  );
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
// Warm the extraction host ahead of a real upload. The client pokes this when the
// upload page mounts, so Modal's scale-to-zero cold start (~70-85s: container boot +
// loading both models into VRAM) overlaps with the user picking and reviewing files
// instead of stalling the first extraction's preflight.
//
// Fire-and-forget: respond 202 immediately and let warmupModel() run in the
// background. It's best-effort and never rejects, so nothing here can fail the request.
// Waking the host also triggers Modal's @enter, which preloads both the OCR and
// junk-filter models — one poke covers the whole pipeline. No squad scope needed
// (this touches no data); no extraction quota (it runs no inference on a screenshot).
router.post('/warmup', authenticateToken, warmupRateLimit, (_req: Request, res: Response) => {
  void warmupModel();
  res.status(202).json({ success: true, message: 'Warming extraction host' } as ApiResponse);
});

router.post('/upload-multiple', authenticateToken, resolveSquad, uploadRateLimit, upload.array('screenshots', 10), extractionQuota, async (req: Request, res: Response) => {
  // Reserved by extractionQuota above; reconciled in the finally below so a batch is
  // charged for exactly the files that reached the GPU, whether it succeeded or not.
  const quotaUserId = req.user?.userId;
  const reserved = extractionCost(req);
  let extracted = 0;
  try {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'No files uploaded',
      };
      return res.status(400).json(response);
    }

    // Fail fast with a clean 503 if the extraction host is down (the per-call
    // paths below swallow failures into empty results).
    await assertExtractionHostReachable();

    // Validate and de-duplicate every file BEFORE any of them reaches the GPU.
    //
    // This used to live inside the per-file work below, where each file was compared only
    // against the hashes already committed to the database. Nothing in this request was
    // saved yet, so two copies of the same screenshot in one request both passed and the
    // squad ended up holding the game twice. A file now has to clear the committed set
    // *and* every file accepted ahead of it here.
    //
    // Sequential on purpose: the loop below runs its files concurrently, so a running set
    // filled in there would race — two matching files in the same pair could each check
    // before the other inserted. Walking the files in order also makes which copy gets
    // rejected deterministic, and lets the committed hashes be fetched once rather than
    // once per file.
    const committedHashes = await supabaseService.getGameHashesBySquadId(requireSquadId(req));
    const hashByFile = new Map<Express.Multer.File, string>();
    const acceptedHashes: string[] = [];

    for (const file of files) {
      // Reject files whose bytes don't match an image type before hitting OCR
      await validateMagicBytes(file.buffer);

      const imageHash = await computePerceptualHash(file.buffer);
      const clashes = (h: string) => hammingDistance(imageHash, h) <= DUPLICATE_HAMMING_THRESHOLD;
      if (committedHashes.some(clashes)) {
        throw Object.assign(new Error(`${file.originalname}: visually similar screenshot already saved`), {
          code: 'DUPLICATE_SCREENSHOT',
        });
      }
      if (acceptedHashes.some(clashes)) {
        throw Object.assign(new Error(`${file.originalname}: visually similar screenshot uploaded twice in the same request`), {
          code: 'DUPLICATE_SCREENSHOT',
        });
      }

      acceptedHashes.push(imageHash);
      hashByFile.set(file, imageHash);
    }

    // Process files in batches of 2
    const results = [];
    const batchSize = 2;

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);

      const batchPromises = batch.map(async (file) => {
        const imageHash = hashByFile.get(file)!;

        // Junk filter — fails open if Ollama is offline.
        const junkResult = await classifyScreenshot(file.buffer);
        if (!junkResult.isValidBoxScore && junkResult.confidence === 'high') {
          throw new Error(`${file.originalname}: image does not appear to be a valid NBA 2K box score`);
        }

        const enhancedOCRService = new EnhancedOCRService();
        // Mappings fetched once per batch outside the per-file loop — not available here,
        // so fetch per file (fail-open on error).
        //
        // Fail-open is deliberate: a mapping outage should degrade names, not reject the
        // upload. It is logged rather than swallowed because the degraded result is
        // otherwise indistinguishable from a squad that simply has no mappings, so a
        // squad-wide outage would quietly mis-name every player on every upload.
        let fileMappings: Map<string, string> | undefined;
        try {
          fileMappings = await getMappingsForSquad(requireSquadId(req));
        } catch (err) {
          logger.warn({ err, fileName: file.originalname }, 'Failed to fetch player mappings — proceeding without mapping');
        }
        const extractedData = await enhancedOCRService.extractStructuredDataFromImage(file.buffer, file.originalname, fileMappings);
        // Counted here, not on batch success: a batch that dies partway still burned the
        // GPU for the files that got this far, and those must stay charged.
        extracted++;

        // Upload to Supabase
        const imageNumber = extractImageNumber(file.originalname);
        const userId = requireUserId(req);
        // Unique suffix: imageNumber is scraped from the filename, and phone counters reset,
        // so two distinct games could yield the same path. uploadImage uses upsert:true, so a
        // collision silently overwrote the earlier screenshot in Storage.
        const fileName = `${userId}-${imageNumber}-${randomUUID().slice(0, 8)}-boxscore.${file.originalname.split('.').pop()}`;
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

    const response: ApiResponse = {
      success: true,
      data: {
        results,
        totalProcessed: results.length,
      },
    };

    return res.json(response);
  } catch (error) {
    // A duplicate is a statement about the request, not a server fault. POST /upload has
    // always answered 409 for the identical condition; this route answered 500, so the
    // same rejection looked like an outage depending on which endpoint you used.
    if (isDuplicateScreenshotError(error)) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_SCREENSHOT',
        error: error.message,
      });
    }
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
  } finally {
    if (quotaUserId) refundExtractions(quotaUserId, reserved - extracted);
  }
});

// Keep the original single upload for backward compatibility
router.post('/upload', authenticateToken, resolveSquad, uploadRateLimit, upload.single('screenshot'), extractionQuota, async (req: Request, res: Response) => {
  const quotaUserId = req.user?.userId;
  const reserved = extractionCost(req);
  let extracted = 0;
  try {
    if (!req.file) {
      const response: ApiResponse = {
        success: false,
        error: 'No file uploaded',
      };
      return res.status(400).json(response);
    }

    // Fail fast with a clean 503 if the extraction host is down.
    await assertExtractionHostReachable();

    // Reject files whose bytes don't match an image type before hitting OCR
    await validateMagicBytes(req.file.buffer);

    // Perceptual-hash duplicate check (before OCR to avoid wasted GCV calls)
    const imageHash = await computePerceptualHash(req.file.buffer);
    const existingHashes = await supabaseService.getGameHashesBySquadId(requireSquadId(req));
    if (existingHashes.some(h => hammingDistance(imageHash, h) <= DUPLICATE_HAMMING_THRESHOLD)) {
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
      mappings = await getMappingsForSquad(requireSquadId(req));
    } catch (err) {
      logger.error({ err }, 'Failed to fetch player mappings — proceeding without mapping');
    }

    // Create fresh OCR service instance for each request to prevent caching
    const enhancedOCRService = new EnhancedOCRService();
    const extractedData = await enhancedOCRService.extractStructuredDataFromImage(req.file.buffer, req.file.originalname, mappings);
    // The GPU has now been used; everything above this line exits without spending the
    // reservation and gets it refunded.
    extracted++;

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
    // Unique suffix — see the note in /upload-multiple: colliding paths silently overwrote
    // an earlier screenshot because uploadImage uses upsert:true.
    const objectPath = `${requireUserId(req)}-${imageNumber}-${randomUUID().slice(0, 8)}-boxscore.${ext}`;
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
  } finally {
    if (quotaUserId) refundExtractions(quotaUserId, reserved - extracted);
  }
});

// Save the reviewed data to the database
router.post('/save', authenticateToken, resolveSquad, async (req: Request, res: Response) => {
  try {
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
    const existingGame = await supabaseService.getGameByScreenshotUrl(imageUrl, requireSquadId(req));
    if (existingGame) {
      logger.info({ gameId: existingGame.id }, 'Duplicate save request — returning existing game');
      // Return this game's own players. (json_agg yields [null] for a game with no player
      // rows, so strip nulls rather than surfacing them to the client.)
      const existingFull = await supabaseService.getGameById(existingGame.id, requireSquadId(req));
      const existingPlayers = ((existingFull?.players ?? []) as (Player | null)[]).filter(
        (p): p is Player => p != null,
      );
      const response: ApiResponse<{ game: Game; players: Player[] }> = {
        success: true,
        data: {
          game: existingGame,
          players: existingPlayers,
        },
        message: 'Game already exists in database',
      };
      return res.status(200).json(response);
    }

    // Pre-generate a stable ID so players and teams can reference the game
    // before the transaction commits, then save everything atomically.
    // UUID rather than Date.now(): two saves in the same millisecond collided, which
    // becomes far more likely once several people upload into a shared squad.
    const gameId = `game_${randomUUID()}`;

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
        squadId: requireSquadId(req),
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
      squadId: requireSquadId(req),
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
      squadId: requireSquadId(req),
    };

    // Retrieve the perceptual hash stored at upload time (null if upload route not used).
    // Deliberately NOT removed from the map yet — if the save below throws, the entry must
    // survive so a retry still persists the hash. Deleting it up front left any retried game
    // with a null imageHash, i.e. permanently invisible to duplicate detection.
    const savedImageHash = pendingHashes.get(imageUrl) ?? null;

    // Atomic save: game + players + teams in a single transaction on a dedicated
    // pooled client, which also
    // re-checks for a perceptual duplicate under an advisory lock (see
    // SupabaseService.assertNotDuplicateInSquad).
    let saveResult: { game: any; players: Player[] };
    try {
      saveResult = await supabaseService.saveGameWithStats(
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
          squadId: requireSquadId(req),
          // Attribution + delete/move rights. Distinct from squadId, which controls access.
          uploadedByUserId: requireUserId(req),
        },
        playerInputs,
        homeTeamInput,
        awayTeamInput,
      );
    } catch (saveError) {
      if (!(saveError instanceof DuplicateGameError)) throw saveError;

      // Lost the save-time dedup race: another member committed the same screenshot while
      // this one sat in review. Not a failure — the game the user was saving is in the
      // squad, so respond as the imageUrl-duplicate path above does. A 500 here would
      // tell the user their game was lost when it demonstrably was not.
      logger.info(
        { gameId: saveError.existingGameId, squadId: requireSquadId(req) },
        'Concurrent save of the same screenshot — returning the game that won the race',
      );

      // Terminal outcome, so the upload→save bridge for this image is done with. Leaving
      // it would pin the entry in the map for the process's lifetime.
      pendingHashes.delete(imageUrl);

      const squadId = requireSquadId(req);
      const winner = await supabaseService.getGameById(saveError.existingGameId, squadId);
      if (!winner) {
        // The winning game vanished between the aborted save and this read — only possible
        // if it was deleted in that window. Reporting a duplicate would point the client at
        // a game that no longer exists, so surface it as the failure it is and let the user
        // retry, which will now succeed.
        throw saveError;
      }
      // Drop the aggregate fields so the shape matches the other duplicate path, and strip
      // json_agg's [null] for a game with no player rows.
      const { players: winnerPlayers, teams: _teams, ...winnerGame } = winner as any;
      const response: ApiResponse<{ game: Game; players: Player[] }> = {
        success: true,
        data: {
          game: winnerGame as Game,
          players: ((winnerPlayers ?? []) as (Player | null)[]).filter(
            (p): p is Player => p != null,
          ),
        },
        message: 'Game already exists in database',
      };
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(response);
    }
    const { game, players: savedPlayers } = saveResult;

    // Save committed — the upload→save hash bridge for this image is now consumed.
    pendingHashes.delete(imageUrl);

    // Rebuild aggregates for this squad from the rows just written. Replaces the previous
    // per-player incremental accumulation, which had no decrement path and let totals
    // drift away from the underlying games.
    //
    // The game itself is already committed at this point, so a failure here must not be
    // reported as a failed save. It is logged loudly rather than swallowed, and because
    // the rebuild is idempotent and derived entirely from `players`, the next save or edit
    // in this squad repairs it — unlike the old incremental path, where a lost update was
    // permanent.
    try {
      await supabaseService.recomputeSquadAggregates(requireSquadId(req));
    } catch (aggregateErr) {
      logger.error(
        { err: aggregateErr, gameId: game.id, squadId: requireSquadId(req) },
        'Game saved but squad aggregate rebuild failed — totals are stale until the next write',
      );
    }

    const response: ApiResponse<{ game: Game; players: Player[] }> = {
      success: true,
      data: {
        game,
        // The rows just written by saveGameWithStats — previously this returned the user's
        // whole game list under a field typed Player[].
        players: savedPlayers,
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
router.get('/games', authenticateToken, resolveSquad, async (req: Request, res: Response) => {
  try {
    const games = await supabaseService.getGamesBySquadId(requireSquadId(req));

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
router.get('/games/:gameId', authenticateToken, resolveSquad, async (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;

    // Indexed single-row lookup, not a full squad scan + .find(). getGameById already
    // scopes by squadId, so a game in another squad reads as missing — same 404, no
    // membership disclosure.
    const game = await supabaseService.getGameById(gameId!, requireSquadId(req));

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
router.get('/games/:gameId/screenshot', authenticateToken, resolveSquad, async (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;

    const game = await supabaseService.getGameById(gameId!, requireSquadId(req));
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
router.post('/generate-team-names', authenticateToken, resolveSquad, async (req: Request, res: Response) => {
  try {
    const { players } = req.body;

    if (!players || !Array.isArray(players)) {
      const response: ApiResponse = {
        success: false,
        error: 'Players array is required',
      };
      return res.status(400).json(response);
    }

    // Generate custom team names from the user's mapped display names
    const customNames = await getAllowedNamesArray(requireSquadId(req));
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

// NOTE: POST /games/:gameId/start-edit was removed along with SupabaseService.startGameEdit.
// It subtracted a game from player_totals up front, with no endpoint to restore them if the
// edit was abandoned, and double-subtracted when the edit did complete. PUT /games/:gameId
// now rebuilds aggregates from the stored rows instead, so no pre-edit step is needed.
// Update game details
router.put('/games/:gameId', authenticateToken, resolveSquad, async (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;
    const { homeTeam, awayTeam, homeScore, awayScore, date, players } = req.body;

    if (!homeTeam || !awayTeam || homeScore === undefined || awayScore === undefined || !date || !players) {
      const response: ApiResponse = {
        success: false,
        error: 'Missing required fields: homeTeam, awayTeam, homeScore, awayScore, date, players',
      };
      return res.status(400).json(response);
    }

    // allowedNames is no longer passed: updateGame rebuilds aggregates via
    // recomputeSquadAggregates, which derives the tracked names from the squad roster itself.
    const updatedGame = await supabaseService.updateGame(gameId!, requireSquadId(req), {
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

/**
 * Delete a game from the active squad.
 *
 * New in the squad work — until now deletion existed only as an admin route
 * (`src/routes/admin.ts`), so members had no way to remove their own bad upload.
 *
 * Permission: the uploader, or the squad's OWNER. Any member may *edit* a shared game, but
 * removing one from the group's history is a stronger act, so it stays with the person who
 * contributed it or the person who runs the squad.
 */
router.delete('/games/:gameId', authenticateToken, resolveSquad, async (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;
    const squadId = requireSquadId(req);

    // resolveSquad already proved membership; this reads the role, which decides whether a
    // non-uploader may delete.
    const membership = await getMembership(requireUserId(req), squadId);
    if (!membership) {
      return res.status(404).json({ success: false, error: 'Squad not found' } as ApiResponse);
    }

    const result = await supabaseService.deleteGameForSquad(gameId!, squadId, {
      userId: requireUserId(req),
      isOwner: membership.role === 'OWNER',
    });

    if (result.outcome === 'not_found') {
      return res.status(404).json({ success: false, error: 'Game not found' } as ApiResponse);
    }
    if (result.outcome === 'forbidden') {
      return res.status(403).json({
        success: false,
        error: 'Only the member who uploaded this game, or the squad owner, can delete it',
      } as ApiResponse);
    }

    // Past the commit: the game is gone regardless of what follows. Both remaining steps are
    // non-transactional, so a failure in either is logged and reported as success — saying
    // the delete failed would be false, and would invite a retry that 404s.
    if (result.screenshotUrl) {
      try {
        await supabaseService.deleteImage(result.screenshotUrl);
      } catch (storageErr) {
        // Leaves an unreferenced object in the bucket. Costs storage; breaks nothing.
        logger.error(
          { err: storageErr, gameId, screenshotUrl: result.screenshotUrl },
          'Game deleted but its screenshot could not be removed from storage',
        );
      }
    }

    try {
      await supabaseService.recomputeSquadAggregates(squadId);
    } catch (aggregateErr) {
      // Totals now include a game that no longer exists. Self-heals on the squad's next
      // write, because the rebuild derives everything from `players`.
      logger.error(
        { err: aggregateErr, gameId, squadId },
        'Game deleted but squad aggregate rebuild failed — totals are stale until the next write',
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Game deleted successfully',
    } as ApiResponse);
  } catch (error) {
    logger.error({ err: error }, 'Error deleting game');
    return res.status(500).json({ success: false, error: 'Failed to delete game' } as ApiResponse);
  }
});

export default router;
