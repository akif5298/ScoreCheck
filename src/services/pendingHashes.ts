/**
 * The upload→save perceptual-hash bridge.
 *
 * An upload computes a perceptual hash before OCR (to reject duplicates cheaply), but the
 * game row that stores it is not written until the user confirms the extracted stats at the
 * review step. This map carries the hash across that gap, keyed by the object path returned
 * by Storage.
 *
 * Its own module because both ends now live in different files: the upload routes write to
 * it, and the save pipeline reads and clears it. The lifecycle rule below is the reason it
 * did not simply get passed as a parameter — it belongs with the code that enforces it.
 *
 * LIFECYCLE RULE, and it has bitten before: an entry is removed only once the save reaches a
 * TERMINAL outcome — committed, or resolved as a duplicate. It must NOT be removed before
 * `saveGameWithStats` returns, because a save that throws will be retried, and a retry that
 * finds no hash writes a game with `imageHash: null` — permanently invisible to duplicate
 * detection.
 *
 * Bounded and self-expiring (see TtlMap): entries are cleared on the terminal paths, but an
 * upload abandoned at the review step has no terminal path and would otherwise pin its entry
 * for the process's lifetime. Six hours is far longer than a review takes; the cap is the
 * backstop. Losing an entry is safe — a miss reads as "no hash known" and the game is stored
 * without one, costing future dedup on that single screenshot and nothing else.
 *
 * Single-instance only, and lost on restart.
 */
import { TtlMap } from '@/utils/ttlMap';

const PENDING_HASH_TTL_MS = 6 * 60 * 60 * 1000;
const PENDING_HASH_MAX_ENTRIES = 5000;

export const pendingHashes = new TtlMap<string>(PENDING_HASH_TTL_MS, PENDING_HASH_MAX_ENTRIES);
