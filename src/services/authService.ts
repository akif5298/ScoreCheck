import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import supabaseService from './supabase';
import { User, JwtPayload } from '@/types';
import logger from '@/utils/logger';

const BCRYPT_COST = 12;

// Compared against when login hits an unknown email so response timing does not
// reveal whether the account exists.
const DUMMY_HASH = bcrypt.hashSync('scorecheck-timing-dummy', BCRYPT_COST);

/** Error with an HTTP status the auth routes translate directly into a response. */
export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface SignupInput {
  email: string;
  password: string;
  name?: string | undefined;
  inviteCode: string;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: Date;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
  };
}

function inviteCodeMatches(candidate: string): boolean {
  const expected = process.env.INVITE_CODE;
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(candidate).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export class AuthService {
  generateToken(user: Pick<User, 'id' | 'email' | 'role'>): string {
    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    return jwt.sign(payload, process.env.JWT_SECRET!, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    } as jwt.SignOptions);
  }

  verifyToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  async getUserFromToken(token: string): Promise<User | null> {
    try {
      const payload = this.verifyToken(token);
      return await supabaseService.findUserById(payload.userId);
    } catch (error) {
      return null;
    }
  }

  async signup(input: SignupInput): Promise<{ user: PublicUser; token: string }> {
    if (!process.env.INVITE_CODE) {
      throw new AuthError(503, 'Signups are currently disabled');
    }
    if (!inviteCodeMatches(input.inviteCode)) {
      throw new AuthError(403, 'Invalid invite code');
    }

    const existing = await supabaseService.findUserByEmail(input.email);
    if (existing) {
      throw new AuthError(409, 'An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
    const user = await supabaseService.createLocalUser({
      email: input.email,
      name: input.name ?? null,
      passwordHash,
    });

    logger.info({ userId: user.id }, 'User signed up');
    return { user: toPublicUser(user), token: this.generateToken(user) };
  }

  async login(email: string, password: string): Promise<{ user: PublicUser; token: string }> {
    const user = await supabaseService.findUserByEmail(email);

    // Unknown email and password-less (legacy Apple) accounts fail identically.
    const hash = user?.passwordHash ?? DUMMY_HASH;
    const valid = await bcrypt.compare(password, hash);
    if (!user || !user.passwordHash || !valid) {
      throw new AuthError(401, 'Invalid email or password');
    }

    return { user: toPublicUser(user), token: this.generateToken(user) };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await supabaseService.findUserById(userId);
    if (!user || !user.passwordHash) {
      throw new AuthError(401, 'Invalid credentials');
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      throw new AuthError(401, 'Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await supabaseService.updatePasswordHash(userId, passwordHash);
    logger.info({ userId }, 'Password changed');
  }
}

export default new AuthService();
