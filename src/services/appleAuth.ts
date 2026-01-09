import appleSignin from 'apple-signin-auth';
import jwt from 'jsonwebtoken';
import supabaseService from './supabase';
import { supabase } from './supabase';
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
      console.log('Auth request:', {
        nodeEnv: process.env.NODE_ENV,
        identityToken: authRequest.identityToken,
        isDev: process.env.NODE_ENV === 'development',
        isMockToken: authRequest.identityToken === 'mock_identity_token',
        isDevToken: authRequest.identityToken === 'dev_login_token',
        jwtSecret: process.env.JWT_SECRET ? 'SET' : 'MISSING'
      });
      
      // Development mode: bypass Apple verification for testing
      if (process.env.NODE_ENV === 'development' && 
          (authRequest.identityToken === 'mock_identity_token' || authRequest.identityToken === 'dev_login_token')) {
        console.log('Using development mode authentication');
        
        const appleUserId = 'dev_user_' + Date.now();
        const email = authRequest.user?.email || 'dev.user@scorecheck.com';
        const name = authRequest.user?.name 
          ? `${authRequest.user.name.firstName || ''} ${authRequest.user.name.lastName || ''}`.trim()
          : 'Development User';

        console.log('Development user data:', { appleUserId, email, name });

        // Find or create user
        let user = await supabaseService.findUserByAppleId(appleUserId);
        console.log('Found existing user:', user);

        if (!user) {
          console.log('Creating new development user');
          // Create new user
          user = await supabaseService.createUser({
            appleId: appleUserId,
            email: email,
            name: name,
          });
          console.log('Created new user:', user);
        }

        // Generate JWT token
        const token = this.generateToken(user);
        console.log('Generated token successfully');
        return { user, token };
      }

      // Production mode: verify the Apple ID token
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
      let user = await supabaseService.findUserByAppleId(appleUserId);

      if (!user) {
        // Create new user
        user = await supabaseService.createUser({
          appleId: appleUserId,
          email: email || `user_${appleUserId}@apple.com`,
          name: name || 'Apple User',
        });
      } else {
        // Update existing user if needed
        if (email && user.email !== email) {
          user = await supabaseService.updateUser(user.id, { email });
        }
        if (name && user.name !== name) {
          user = await supabaseService.updateUser(user.id, { name });
        }
      }

      // Generate JWT token
      const token = this.generateToken(user);

      return { user, token };
    } catch (error) {
      console.error('Apple authentication error:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
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
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', payload.userId)
        .single();

      if (error) return null;
      return data;
    } catch (error) {
      return null;
    }
  }
}

export default new AppleAuthService();
