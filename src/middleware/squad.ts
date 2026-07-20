import { Request, Response, NextFunction } from 'express';
import { resolveSquadId, SquadError } from '@/services/squadService';
import logger from '@/utils/logger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Ownership scope for this request. Set by resolveSquad, after authenticateToken. */
      squadId?: string;
    }
  }
}

export const SQUAD_HEADER = 'x-squad-id';

/**
 * Resolves the squad this request operates on and attaches it as req.squadId.
 *
 * Must run after authenticateToken. Membership is looked up in the database on every
 * request rather than trusted from the JWT: tokens are 7-day with no revocation list, so
 * a member removed from a squad would otherwise retain access until their token expired.
 *
 * The X-Squad-Id header lets the client switch squads without re-issuing a token, but it
 * is always validated against membership — an arbitrary header cannot reach another
 * squad's data.
 */
export const resolveSquad = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'User not authenticated' });
      return;
    }

    const header = req.headers[SQUAD_HEADER];
    const requested = Array.isArray(header) ? header[0] : header;

    req.squadId = await resolveSquadId(req.user.userId, requested || undefined);
    next();
  } catch (error) {
    if (error instanceof SquadError) {
      res.status(error.status).json({ success: false, error: error.message });
      return;
    }
    logger.error({ err: error }, 'Failed to resolve squad scope');
    res.status(500).json({ success: false, error: 'Failed to resolve squad' });
  }
};

/**
 * Reads req.squadId, throwing if resolveSquad has not run. Routes should use this rather
 * than `req.squadId!` so a missing middleware fails loudly instead of writing `undefined`
 * into a scope column.
 */
export function requireSquadId(req: Request): string {
  if (!req.squadId) {
    throw new Error('req.squadId is not set — resolveSquad middleware must run first');
  }
  return req.squadId;
}
