import { Router, Request, Response } from 'express';
import { z } from 'zod';
import appleAuthService from '@/services/appleAuth';
import { AppleAuthRequest, ApiResponse } from '@/types';

const router = Router();

const appleAuthSchema = z.object({
  identityToken: z.string(),
  authorizationCode: z.string(),
  user: z.object({
    name: z.object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
    }).optional(),
    email: z.string().email().optional(),
  }).optional(),
});

router.post('/apple', async (req: Request, res: Response) => {
  try {
    const validatedData = appleAuthSchema.parse(req.body);
    
    const result = await appleAuthService.authenticateUser(validatedData as AppleAuthRequest);
    
    const response: ApiResponse<{ user: any; token: string }> = {
      success: true,
      data: {
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          createdAt: result.user.createdAt,
        },
        token: result.token,
      },
      message: 'Authentication successful',
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Apple authentication error:', error);
    
    const response: ApiResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Authentication failed',
    };

    return res.status(400).json(response);
  }
});

router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      const response: ApiResponse = {
        success: false,
        error: 'Token is required',
      };
      return res.status(400).json(response);
    }

    const user = await appleAuthService.getUserFromToken(token);
    
    if (!user) {
      const response: ApiResponse = {
        success: false,
        error: 'Invalid token',
      };
      return res.status(401).json(response);
    }

    const response: ApiResponse<{ user: any }> = {
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          createdAt: user.createdAt,
        },
      },
      message: 'Token is valid',
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Token verification error:', error);
    
    const response: ApiResponse = {
      success: false,
      error: 'Token verification failed',
    };

    return res.status(401).json(response);
  }
});

export default router;
