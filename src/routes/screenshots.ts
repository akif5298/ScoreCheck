import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { fromBuffer as fileTypeFromBuffer } from 'file-type';
import supabaseService from '@/services/supabase';
import {
  saveReviewedGame,
  type IncomingPlayerData,
  type ReviewedGameData,
} from '@/services/gameSaveService';
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
import { ValidationError, ExtractionUnavailableError, UploadExpiredError } from '@/errors';
import { pendingHashes } from '@/services/pendingHashes';
import { extractImageNumber } from '@/utils/imageNumber';
import logger from '@/utils/logger';
import {
  getMappingsForSquad,
  getAllowedNamesForSquad,
  getAllowedNamesArray,
} from '@/services/mappingService';
import { ALLOWED_IMAGE_MIME_TYPES } from '@/constants';
import {
  upload,
  uploadRateLimit,
  warmupRateLimit,
  extractionQuota,
  extractionCost,
  refundExtractions,
} from '@/middleware/uploadQuota';

const router = Router();

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
// Persist a reviewed box score. The pipeline itself lives in services/gameSaveService.ts;
// this handler validates the request and maps an outcome to a status code.
router.post('/save', authenticateToken, resolveSquad, async (req: Request, res: Response) => {
  try {
    const { gameData, playersData, imageUrl, originalFileName } = req.body as {
      gameData: ReviewedGameData;
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

    const result = await saveReviewedGame({
      squadId: requireSquadId(req),
      userId: requireUserId(req),
      gameData,
      playersData,
      imageUrl,
      originalFileName,
    });

    const response: ApiResponse<{ game: Game; players: Player[] }> = {
      success: true,
      data: { game: result.game, players: result.players },
      message:
        result.outcome === 'created'
          ? 'Box score saved successfully'
          : 'Game already exists in database',
    };

    // No cache headers set here on purpose. server/index.ts installs a global middleware
    // that applies the full no-store/no-cache/must-revalidate/proxy-revalidate set to every
    // response before any route runs, and every other route in the app relies on it.
    //
    // The three outcomes used to disagree: a fresh save re-set those four headers verbatim
    // (redundant), a lost dedup race replaced Cache-Control with a bare 'no-store' (shorter
    // than the global it overwrote), and the screenshotUrl match set nothing (correct).
    // Deleting all three makes the responses identical and leaves the caching policy in the
    // one place that owns it.
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
    // A timed-out upload is the caller's to fix by re-uploading, not a server fault. 410
    // with a code the client can branch on, rather than a 500 that reads as "we lost it".
    if (error instanceof UploadExpiredError) {
      logger.info({ squadId: requireSquadId(req) }, 'Save rejected — upload expired');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(error.status).json({
        success: false,
        code: 'UPLOAD_EXPIRED',
        error: error.message,
      });
    }

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
