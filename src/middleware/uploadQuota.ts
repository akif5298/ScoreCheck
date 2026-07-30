/**
 * Upload admission control: per-user rate limits, the daily extraction quota, and the
 * multer instance that parses the uploads themselves.
 *
 * These three sit together because they are the layers a request passes through before any
 * GPU work happens, and because the quota gate is meaningless without knowing where multer
 * runs in the chain. The intended order on an upload route is:
 *
 *   authenticateToken → resolveSquad → uploadRateLimit → upload.* → extractionQuota → handler
 *
 * extractionQuota MUST come after multer: it authorises a file count, and `req.files` does
 * not exist until multer has parsed the body. uploadRateLimit stays in front of multer so
 * the cheap per-minute ceiling still rejects floods before anything is buffered into memory.
 *
 * The quota is per-user abuse control, not a shared budget, and is in-memory — so it is
 * single-instance only and resets on restart. A Redis-backed version is future work
 * alongside an async extraction queue.
 */
import multer from 'multer';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { ApiResponse } from '@/types';
import {
  MAX_FILE_SIZE_BYTES,
  UPLOAD_RATE_LIMIT_WINDOW_MS,
  UPLOAD_RATE_LIMIT_MAX,
  EXTRACTION_DAILY_LIMIT,
} from '@/constants';

// Rate limiter applied only to upload endpoints (stricter than the global
// limiter). Keyed by user id (these routes always run after authenticateToken)
// so it's a true per-user limit, not per-IP behind Render's shared proxy.
export const uploadRateLimit = rateLimit({
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
export const warmupRateLimit = rateLimit({
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

// Per-user daily extraction quota. In-memory (single-instance only, like the pending-hash
// bridge) — bounds inference cost/abuse.
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
export function refundExtractions(userId: string, n: number): void {
  if (n <= 0) return;
  const entry = extractionCounts.get(userId);
  if (entry && entry.day === todayKey()) {
    entry.count = Math.max(0, entry.count - n);
  }
}

// How many extractions this request is asking for. Used by both the gate and the
// handler's reconciliation so the two can never disagree about what was reserved.
export function extractionCost(req: Request): number {
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
export function extractionQuota(req: Request, res: Response, next: () => void): void {
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

// Configure multer for memory storage (we'll upload directly to Supabase)
export const upload = multer({
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
