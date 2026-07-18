/**
 * Project-wide constants.
 * Import from here — do not redeclare in individual files.
 */

// ─── Ollama ───────────────────────────────────────────────────────────────────
// OLLAMA_EXTRACTION_MODEL: fine-tuned Qwen2.5-VL-3B (QLoRA, round 5 — trained
// on team-half crops, 38 labeled games). Extraction runs team-split inference
// for this model (see extractFineTunedTeamHalf in ollamaExtractor.ts).
// Holdout eval: 84.6% official accuracy at ~22s/image (up from 77.9% for the
// round-4b full-image model this replaces).
// OLLAMA_JUNK_FILTER_MODEL: minicpm-v stays — the junk filter is a simple
// yes/no classification the fine-tune wasn't trained for.
// ─────────────────────────────────────────────────────────────────────────────
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
export const OLLAMA_JUNK_FILTER_MODEL = 'minicpm-v:latest';
export const OLLAMA_EXTRACTION_MODEL  = process.env.OLLAMA_EXTRACTION_MODEL ?? 'scorecheck-ocr-r5:latest';
export const JUNK_FILTER_TIMEOUT_MS = 15_000;
export const EXTRACTION_TIMEOUT_MS = 60_000;

// ── File upload ───────────────────────────────────────────────────────────────
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif'] as const;
export const MAX_FILE_SIZE_BYTES = parseInt(process.env.MAX_FILE_SIZE || '10485760', 10);

// ── User roles ────────────────────────────────────────────────────────────────
export const ROLE = {
  USER: 'USER',
  ADMIN: 'ADMIN',
} as const;
export type Role = typeof ROLE[keyof typeof ROLE];

// ── HTTP status codes (commonly used subset) ──────────────────────────────────
export const HTTP = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
} as const;

// ── Rate limiting ─────────────────────────────────────────────────────────────
export const UPLOAD_RATE_LIMIT_WINDOW_MS = 60_000;      // 1 minute
export const UPLOAD_RATE_LIMIT_MAX = 10;                 // 10 uploads/minute/IP
export const GLOBAL_RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
export const GLOBAL_RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);

// ── Pagination defaults ───────────────────────────────────────────────────────
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

