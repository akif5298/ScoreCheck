/**
 * Throttling on POST /change-password.
 *
 * Its own file because the limiter's ceiling is process-wide module state configured at
 * import time: auth.test.ts raises it to 1000 so it can exercise the endpoint's behaviour,
 * whereas this file lowers it to 2 so the throttle itself can be reached.
 *
 * What this guards: /change-password sits behind authenticateToken, so it needs a valid
 * token — but a STOLEN token otherwise allowed unlimited guesses at `currentPassword`,
 * which is the only secret the endpoint still verifies. It was the one credential route
 * with no limiter at all.
 */
process.env.JWT_SECRET = 'test-secret-key-for-jwt-signing-0123456789';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.PASSWORD_CHANGE_RATE_LIMIT_MAX = '2';

// Kept offline: this file is about the throttle, not the breach policy.
jest.mock('@/services/passwordPolicy', () => ({
  __esModule: true,
  assessPassword: jest.fn().mockResolvedValue({ ok: true }),
  breachCount: jest.fn(),
  findObviousWeakness: jest.fn(),
}));

jest.mock('@/services/supabase', () => ({
  __esModule: true,
  default: {
    createLocalUser: jest.fn(),
    findUserByEmail: jest.fn(),
    findUserById: jest.fn(),
    updatePasswordHash: jest.fn(),
  },
  pgPool: { connect: jest.fn() },
}));

jest.mock('@/services/squadService', () => ({
  __esModule: true,
  createPersonalSquad: jest.fn(),
  getInvitePreview: jest.fn().mockResolvedValue(null),
}));

import request from 'supertest';
import express from 'express';
import bcrypt from 'bcryptjs';
import supabaseService from '@/services/supabase';
import authService from '@/services/authService';
import authRouter from '@/routes/auth';

const mocked = jest.mocked(supabaseService) as unknown as {
  findUserById: jest.Mock;
  updatePasswordHash: jest.Mock;
};

const app = express();
app.use(express.json());
app.use('/', authRouter);

const PASSWORD = 'correct-horse-battery';
const passwordHash = bcrypt.hashSync(PASSWORD, 4); // low cost keeps tests fast

function tokenFor(id: string): string {
  return authService.generateToken({ id, email: `${id}@example.com`, role: 'USER' });
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked.findUserById.mockResolvedValue({
    id: 'user-1',
    email: 'user-1@example.com',
    passwordHash,
    role: 'USER',
  });
  mocked.updatePasswordHash.mockResolvedValue(undefined);
});

describe('POST /change-password throttling', () => {
  it('429s once a user exceeds the attempt ceiling', async () => {
    const auth = `Bearer ${tokenFor('user-1')}`;
    const wrongGuess = {
      currentPassword: 'not-the-password',
      newPassword: 'a-brand-new-password',
    };

    const statuses: number[] = [];
    let lastBody: { error?: string } = {};
    // Ceiling is 2, so the third attempt must be refused outright.
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/change-password')
        .set('Authorization', auth)
        .send(wrongGuess);
      statuses.push(res.status);
      lastBody = res.body;
    }

    // The first two are rejected on the merits (wrong current password), the third is
    // never evaluated at all.
    expect(statuses[2]).toBe(429);
    expect(lastBody.error).toMatch(/too many password change attempts/i);
  });

  it('throttles per user rather than per IP', async () => {
    // Every request in this suite shares one IP. An IP-keyed limiter would let one account
    // exhaust the allowance for everyone behind the same proxy, which is exactly the
    // failure uploadRateLimit already documents.
    const spent = `Bearer ${tokenFor('user-1')}`;
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/change-password')
        .set('Authorization', spent)
        .send({ currentPassword: 'wrong', newPassword: 'a-brand-new-password' });
    }

    mocked.findUserById.mockResolvedValue({
      id: 'user-2',
      email: 'user-2@example.com',
      passwordHash,
      role: 'USER',
    });

    const other = await request(app)
      .post('/change-password')
      .set('Authorization', `Bearer ${tokenFor('user-2')}`)
      .send({ currentPassword: PASSWORD, newPassword: 'a-brand-new-password' });

    expect(other.status).not.toBe(429);
  });
});
