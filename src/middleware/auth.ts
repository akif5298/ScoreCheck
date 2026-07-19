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
