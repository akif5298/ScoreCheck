import { Router, Request, Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import authService, { AuthError, toPublicUser } from '@/services/authService';
import { authenticateToken } from '@/middleware/auth';
import { ApiResponse } from '@/types';
import logger from '@/utils/logger';

const router = Router();

// Stricter limiter for credential endpoints (global /api limiter still applies)
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many attempts. Please try again later.' },
});

/**
 * Throttles password changes per USER, not per IP.
 *
 * /change-password sits behind authenticateToken, so it is reachable only with a valid
 * token — but a stolen token otherwise allows unlimited guesses at `currentPassword`, which
 * is the one secret the endpoint still checks. Without this it was the only credential
 * endpoint with no limiter at all.
 *
 * Keyed by user id rather than IP for the same reason uploadRateLimit is: behind a shared
 * proxy an IP-keyed limit lets one account's attempts lock out everyone else's password
 * changes. Mounted AFTER authenticateToken so req.user is populated.
 */
const passwordChangeRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.PASSWORD_CHANGE_RATE_LIMIT_MAX || '5'),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.userId ?? req.ip ?? 'anonymous',
  message: {
    success: false,
    error: 'Too many password change attempts. Please try again later.',
  },
});

const emailSchema = z
  .string()
  .trim()
  .max(254)
  .email('Invalid email address')
  .transform((s) => s.toLowerCase());

// 72 bytes is bcrypt's input limit
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters');

const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(100).optional(),
  inviteCode: z.string().min(1, 'Invite code is required'),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

function handleAuthError(res: Response, error: unknown, context: string): Response {
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      error: error.errors[0]?.message ?? 'Invalid request',
    } satisfies ApiResponse);
  }
  if (error instanceof AuthError) {
    return res.status(error.status).json({
      success: false,
      error: error.message,
    } satisfies ApiResponse);
  }
  logger.error({ err: error }, context);
  return res.status(500).json({
    success: false,
    error: 'Something went wrong. Please try again.',
  } satisfies ApiResponse);
}

router.post('/signup', authRateLimit, async (req: Request, res: Response) => {
  try {
    const input = signupSchema.parse(req.body);
    const result = await authService.signup(input);

    const response: ApiResponse<typeof result> = {
      success: true,
      data: result,
      message: 'Account created',
    };
    return res.status(201).json(response);
  } catch (error) {
    return handleAuthError(res, error, 'Signup error');
  }
});

router.post('/login', authRateLimit, async (req: Request, res: Response) => {
  try {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input.email, input.password);

    const response: ApiResponse<typeof result> = {
      success: true,
      data: result,
      message: 'Login successful',
    };
    return res.status(200).json(response);
  } catch (error) {
    return handleAuthError(res, error, 'Login error');
  }
});

// Limiter after authenticateToken: it keys on req.user, which does not exist until then.
router.post('/change-password', authenticateToken, passwordChangeRateLimit, async (req: Request, res: Response) => {
  try {
    const input = changePasswordSchema.parse(req.body);
    await authService.changePassword(req.user!.userId, input.currentPassword, input.newPassword);

    return res.status(200).json({
      success: true,
      message: 'Password updated',
    } satisfies ApiResponse);
  } catch (error) {
    return handleAuthError(res, error, 'Change password error');
  }
});

router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Token is required',
      } satisfies ApiResponse);
    }

    const user = await authService.getUserFromToken(token);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
      } satisfies ApiResponse);
    }

    const response: ApiResponse<{ user: ReturnType<typeof toPublicUser> }> = {
      success: true,
      data: { user: toPublicUser(user) },
      message: 'Token is valid',
    };
    return res.status(200).json(response);
  } catch (error) {
    logger.error({ err: error }, 'Token verification error');
    return res.status(401).json({
      success: false,
      error: 'Token verification failed',
    } satisfies ApiResponse);
  }
});

export default router;
