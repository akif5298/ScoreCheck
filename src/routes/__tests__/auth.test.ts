jest.mock('@/services/appleAuth', () => ({
  __esModule: true,
  default: {
    authenticateUser: jest.fn(),
    getUserFromToken: jest.fn(),
  },
}));

import request from 'supertest';
import express from 'express';
import appleAuthService from '@/services/appleAuth';
import authRouter from '@/routes/auth';

const mocked = jest.mocked(appleAuthService);

const app = express();
app.use(express.json());
app.use('/', authRouter);

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  createdAt: new Date('2026-01-01'),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /apple', () => {
  const validBody = {
    identityToken: 'apple-identity-token',
    authorizationCode: 'apple-auth-code',
  };

  it('returns 200 with user and token on success', async () => {
    mocked.authenticateUser.mockResolvedValue({ user: mockUser as any, token: 'jwt-token' });

    const res = await request(app).post('/apple').send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBe('jwt-token');
    expect(res.body.data.user.id).toBe('user-1');
  });

  it('returns 400 when identityToken is missing', async () => {
    const res = await request(app).post('/apple').send({ authorizationCode: 'code-only' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mocked.authenticateUser).not.toHaveBeenCalled();
  });

  it('returns 400 when authenticateUser throws', async () => {
    mocked.authenticateUser.mockRejectedValue(new Error('Apple authentication failed'));

    const res = await request(app).post('/apple').send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Apple authentication failed');
  });
});

describe('POST /verify', () => {
  it('returns 200 with the user for a valid token', async () => {
    mocked.getUserFromToken.mockResolvedValue(mockUser as any);

    const res = await request(app).post('/verify').send({ token: 'valid-token' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.id).toBe('user-1');
  });

  it('returns 400 when token is missing from the body', async () => {
    const res = await request(app).post('/verify').send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mocked.getUserFromToken).not.toHaveBeenCalled();
  });

  it('returns 401 when the token does not resolve to a user', async () => {
    mocked.getUserFromToken.mockResolvedValue(null);

    const res = await request(app).post('/verify').send({ token: 'unknown-token' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Invalid token');
  });

  it('returns 401 when getUserFromToken throws', async () => {
    mocked.getUserFromToken.mockRejectedValue(new Error('boom'));

    const res = await request(app).post('/verify').send({ token: 'valid-token' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Token verification failed');
  });
});
