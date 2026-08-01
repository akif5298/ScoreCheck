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
 * for the process's lifetime.
 *
 * THIRTY MINUTES, and the save then FAILS rather than degrading. Reviewing a box score takes
 * a minute or two, so half an hour is generous. Previously the window was six hours and a
 * lapsed entry simply read as "no hash known", so the game saved with a null imageHash —
 * permanently invisible to duplicate detection, with nothing shown to the user. Now the save
 * is refused with UploadExpiredError and the screenshot has to be uploaded again, which
 * costs one re-upload instead of silently weakening dedup forever.
 *
 * The grace window is long (24h) because it only governs how long we can still EXPLAIN the
 * timeout. Past it the key reads as `unknown` and the old degrade-quietly behaviour returns,
 * so it is set far beyond any plausible review session.
 *
 * Single-instance only, and lost on restart — after a restart a lapsed upload reads as
 * `unknown` rather than `expired`, so a deploy mid-review degrades quietly instead of
 * demanding a re-upload. That is the deliberate trade: never wrongly blame the user for a
 * timeout that was actually our process going away.
 */
import { TtlMap } from '@/utils/ttlMap';

const PENDING_HASH_TTL_MS = 30 * 60 * 1000;
const PENDING_HASH_GRACE_MS = 24 * 60 * 60 * 1000;
const PENDING_HASH_MAX_ENTRIES = 5000;

export const pendingHashes = new TtlMap<string>(
  PENDING_HASH_TTL_MS,
  PENDING_HASH_MAX_ENTRIES,
  PENDING_HASH_GRACE_MS,
);
