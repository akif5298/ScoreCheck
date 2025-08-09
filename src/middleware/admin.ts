import { Request, Response, NextFunction } from 'express';
import { JwtPayload } from '@/types';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    next();
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
