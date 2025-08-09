import appleSignin from 'apple-signin-auth';
import jwt from 'jsonwebtoken';
import { prisma } from './database';
import { User, AppleAuthRequest, JwtPayload } from '@/types';

export class AppleAuthService {
  private config = {
    clientId: process.env.APPLE_CLIENT_ID!,
    teamId: process.env.APPLE_TEAM_ID!,
    privateKeyLocation: process.env.APPLE_PRIVATE_KEY!,
    keyId: process.env.APPLE_KEY_ID!,
  };

  async authenticateUser(authRequest: AppleAuthRequest): Promise<{ user: User; token: string }> {
    try {
      // Verify the Apple ID token
      const appleResponse = await appleSignin.verifyIdToken(authRequest.identityToken, {
        audience: this.config.clientId,
      });

      // Extract user information
      const appleUserId = appleResponse.sub;
      const email = appleResponse.email || authRequest.user?.email;
      const name = authRequest.user?.name 
        ? `${authRequest.user.name.firstName || ''} ${authRequest.user.name.lastName || ''}`.trim()
        : undefined;

      // Find or create user
      let user = await prisma.user.findUnique({
        where: { appleId: appleUserId },
      });

      if (!user) {
        // Create new user
        user = await prisma.user.create({
          data: {
            appleId: appleUserId,
            email: email || `user_${appleUserId}@apple.com`,
            name: name || 'Apple User',
          },
        });
      } else {
        // Update existing user if needed
        if (email && user.email !== email) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { email },
          });
        }
        if (name && user.name !== name) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { name },
          });
        }
      }

      // Generate JWT token
      const token = this.generateToken(user);

      return { user, token };
    } catch (error) {
      console.error('Apple authentication error:', error);
      throw new Error('Apple authentication failed');
    }
  }

  private generateToken(user: User): string {
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
      return await prisma.user.findUnique({
        where: { id: payload.userId },
      });
    } catch (error) {
      return null;
    }
  }
}

export default new AppleAuthService();
