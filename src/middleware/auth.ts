import { Request, Response, NextFunction } from 'express';
import authService from '@/services/authService';
import { JwtPayload } from '@/types';
import logger from '@/utils/logger';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({ success: false, error: 'Access token required' });
      return;
    }

    const payload = authService.verifyToken(token);
    req.user = payload;
    next();
  } catch (error) {
    logger.error({ err: error }, 'Authentication error');
    res.status(401).json({ success: false, error: 'Authentication failed' });
  }
};

/**
 * Reads the authenticated user id, throwing if authenticateToken has not run.
 *
 * The mirror of requireSquadId in middleware/squad.ts, and it exists for the same reason:
 * handlers used to re-check `if (!req.user)` and return their own 401, which could never
 * fire — authenticateToken rejects first, and resolveSquad rejects again after it. Those
 * branches were dead, but deleting them left `req.user` typed as possibly-undefined at
 * every use. This narrows it in one place and fails loudly rather than letting `undefined`
 * reach a database column.
 */
export function requireUserId(req: Request): string {
  if (!req.user) {
    throw new Error('req.user is not set — authenticateToken middleware must run first');
  }
  return req.user.userId;
}

export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const payload = authService.verifyToken(token);
      req.user = payload;
    }

    next();
  } catch (error) {
    // Continue without authentication for optional routes
    next();
  }
};
