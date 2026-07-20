/**
 * Squad management: create, switch, members, invites, and the join flow.
 *
 * Scope note: these routes deliberately do NOT use the `resolveSquad` middleware. That
 * middleware resolves the *active* squad for data requests, whereas everything here names
 * its target squad explicitly in the path and re-checks membership per call. Using both
 * would invite the bug where a caller edits squad A while the URL says B.
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateToken } from '@/middleware/auth';
import { ApiResponse } from '@/types';
import logger from '@/utils/logger';
import {
  SquadError,
  createSquad,
  listSquadsForUser,
  setActiveSquad,
  listMembers,
  createInvite,
  revokeInvite,
  listInvites,
  getInvitePreview,
  acceptInvite,
  listRoster,
  claimRosterEntry,
} from '@/services/squadService';
import { moveGamesToSquad } from '@/services/gameMoveService';

const router = Router();

const MAX_SQUAD_NAME_LENGTH = 60;

/**
 * Translates SquadError's status into the response, and anything else into a 500.
 * Centralised so no handler accidentally leaks an internal message to the client.
 */
function fail(res: Response, error: unknown, context: string) {
  if (error instanceof SquadError) {
    return res.status(error.status).json({ success: false, error: error.message } as ApiResponse);
  }
  logger.error({ err: error }, context);
  return res.status(500).json({ success: false, error: context } as ApiResponse);
}

/** Trims and validates a user-supplied squad name. */
function parseSquadName(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new SquadError(400, 'Squad name is required');
  }
  const name = raw.trim();
  if (name.length > MAX_SQUAD_NAME_LENGTH) {
    throw new SquadError(400, `Squad name must be ${MAX_SQUAD_NAME_LENGTH} characters or fewer`);
  }
  return name;
}

// ── Squads ───────────────────────────────────────────────────────────────────────

/** Every squad the caller belongs to, personal first. Drives the sidebar switcher. */
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const squads = await listSquadsForUser(req.user!.userId);
    return res.json({ success: true, data: squads } as ApiResponse);
  } catch (error) {
    return fail(res, error, 'Failed to list squads');
  }
});

router.post('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const name = parseSquadName(req.body?.name);
    const squad = await createSquad(req.user!.userId, name);
    return res.status(201).json({ success: true, data: squad } as ApiResponse);
  } catch (error) {
    return fail(res, error, 'Failed to create squad');
  }
});

/**
 * Switch the caller's active squad. The client also sends X-Squad-Id per request, so this
 * is what makes the choice stick on a new device or a fresh login.
 */
router.post('/:squadId/activate', authenticateToken, async (req: Request, res: Response) => {
  try {
    await setActiveSquad(req.user!.userId, req.params.squadId!);
    return res.json({ success: true, data: { activeSquadId: req.params.squadId } } as ApiResponse);
  } catch (error) {
    return fail(res, error, 'Failed to switch squad');
  }
});

// ── Members ──────────────────────────────────────────────────────────────────────

router.get('/:squadId/members', authenticateToken, async (req: Request, res: Response) => {
  try {
    const members = await listMembers(req.user!.userId, req.params.squadId!);
    return res.json({ success: true, data: members } as ApiResponse);
  } catch (error) {
    return fail(res, error, 'Failed to list members');
  }
});

// ── Invites ──────────────────────────────────────────────────────────────────────

router.get('/:squadId/invites', authenticateToken, async (req: Request, res: Response) => {
  try {
    const invites = await listInvites(req.user!.userId, req.params.squadId!);
    return res.json({ success: true, data: invites } as ApiResponse);
  } catch (error) {
    return fail(res, error, 'Failed to list invites');
  }
});

router.post('/:squadId/invites', authenticateToken, async (req: Request, res: Response) => {
  try {
    const invite = await createInvite(req.user!.userId, req.params.squadId!, {
      expiresInDays: req.body?.expiresInDays,
      maxUses: req.body?.maxUses,
    });
    return res.status(201).json({ success: true, data: invite } as ApiResponse);
  } catch (error) {
    return fail(res, error, 'Failed to create invite');
  }
});

router.delete(
  '/:squadId/invites/:inviteId',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      await revokeInvite(req.user!.userId, req.params.squadId!, req.params.inviteId!);
      return res.json({ success: true, message: 'Invite revoked' } as ApiResponse);
    } catch (error) {
      return fail(res, error, 'Failed to revoke invite');
    }
  },
);

// ── Join flow ────────────────────────────────────────────────────────────────────

/**
 * Tokens carry 192 bits of entropy, so this limiter is not really about guessing — it
 * bounds the cost of someone hammering the one unauthenticated endpoint in the app.
 */
const inviteLookupLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please wait a moment.' },
});

/**
 * Public: the squad preview shown before signup/login, so an invited person can see what
 * they are joining. Unauthenticated by necessity — the visitor may not have an account yet.
 *
 * Returns 404 for anything unusable (unknown, revoked, expired, exhausted) so the response
 * cannot be used to tell those cases apart.
 */
router.get('/invites/:token', inviteLookupLimit, async (req: Request, res: Response) => {
  try {
    const preview = await getInvitePreview(req.params.token!);
    if (!preview) {
      return res
        .status(404)
        .json({ success: false, error: 'This invite link is not valid or has expired' } as ApiResponse);
    }
    return res.json({ success: true, data: preview } as ApiResponse);
  } catch (error) {
    return fail(res, error, 'Failed to look up invite');
  }
});

/**
 * Join the squad behind a token. Requires an account; the client sends the visitor through
 * signup or login first, preserving the token across the redirect.
 *
 * Joining never moves any data. Contributing existing games and claiming a roster entry are
 * separate steps the user can skip.
 */
router.post('/join/:token', authenticateToken, async (req: Request, res: Response) => {
  try {
    const result = await acceptInvite(req.user!.userId, req.params.token!);
    return res.json({
      success: true,
      data: result,
      message: result.joined
        ? `Joined ${result.squadName}`
        : `You are already a member of ${result.squadName}`,
    } as ApiResponse);
  } catch (error) {
    return fail(res, error, 'Failed to join squad');
  }
});

// ── Roster identity (the "which player are you?" step) ───────────────────────────

router.get('/:squadId/roster', authenticateToken, async (req: Request, res: Response) => {
  try {
    const roster = await listRoster(req.user!.userId, req.params.squadId!);
    return res.json({ success: true, data: roster } as ApiResponse);
  } catch (error) {
    return fail(res, error, 'Failed to list roster');
  }
});

/**
 * Claim a roster entry as yourself — either an existing one by `mappingId`, or a new one
 * from `gamertag` (+ optional `displayName`).
 *
 * This is the only link between an app user and their player rows, and therefore the sole
 * input to the cross-squad career view.
 */
router.post('/:squadId/roster/claim', authenticateToken, async (req: Request, res: Response) => {
  try {
    const entry = await claimRosterEntry(req.user!.userId, req.params.squadId!, {
      mappingId: req.body?.mappingId,
      gamertag: req.body?.gamertag,
      displayName: req.body?.displayName,
    });
    return res.json({ success: true, data: entry } as ApiResponse);
  } catch (error) {
    return fail(res, error, 'Failed to claim roster entry');
  }
});

// ── Moving games between squads ──────────────────────────────────────────────────

const MAX_GAMES_PER_MOVE = 500;

/** Validates the game-id list, so a malformed body fails before opening a transaction. */
function parseGameIds(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new SquadError(400, 'gameIds must be a non-empty array');
  }
  if (raw.length > MAX_GAMES_PER_MOVE) {
    throw new SquadError(400, `Cannot move more than ${MAX_GAMES_PER_MOVE} games at once`);
  }
  if (!raw.every((id) => typeof id === 'string' && id.trim().length > 0)) {
    throw new SquadError(400, 'gameIds must all be non-empty strings');
  }
  // Duplicates in the request would make the "one or more games were not found" count
  // check below fail spuriously.
  return [...new Set(raw as string[])];
}

/**
 * Move games into this squad. The target is the path squad; each game's source is read
 * from the game itself, so the caller cannot name a source they are not in.
 *
 * The response reports what actually happened per game rather than a bare count —
 * duplicates, renames and unmapped names all need surfacing, and a silent partial success
 * here is what makes squad analytics drift.
 */
router.post('/:squadId/games/move', authenticateToken, async (req: Request, res: Response) => {
  try {
    const gameIds = parseGameIds(req.body?.gameIds);
    const result = await moveGamesToSquad(req.user!.userId, req.params.squadId!, gameIds);

    const parts = [`Moved ${result.moved.length} game${result.moved.length === 1 ? '' : 's'}.`];
    if (result.duplicates.length > 0) {
      parts.push(`${result.duplicates.length} were already in the squad.`);
    }
    if (result.renamed.length > 0) {
      parts.push(`Renamed ${result.renamed.length} player${result.renamed.length === 1 ? '' : 's'}.`);
    }
    if (result.unmapped.length > 0) {
      parts.push(`${result.unmapped.length} name(s) are not on this squad's roster yet.`);
    }

    return res.json({ success: true, data: result, message: parts.join(' ') } as ApiResponse);
  } catch (error) {
    return fail(res, error, 'Failed to move games');
  }
});

export default router;
