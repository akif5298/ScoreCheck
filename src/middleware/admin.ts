import { Request, Response, NextFunction } from 'express';
import { JwtPayload } from '@/types';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    if (req.user.role !== 'ADMIN') {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }

    next();
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
    return;
  }
};
