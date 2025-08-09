import { Request, Response, NextFunction } from 'express';
import appleAuthService from '@/services/appleAuth';
import { JwtPayload } from '@/types';

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

    const payload = appleAuthService.verifyToken(token);
    req.user = payload;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
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
      const payload = appleAuthService.verifyToken(token);
      req.user = payload;
    }

    next();
  } catch (error) {
    // Continue without authentication for optional routes
    next();
  }
};
