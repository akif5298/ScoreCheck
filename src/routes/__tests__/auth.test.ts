process.env.JWT_SECRET = 'test-secret-key-for-jwt-signing-0123456789';
process.env.INVITE_CODE = 'test-invite-code';
process.env.AUTH_RATE_LIMIT_MAX = '1000';

jest.mock('@/services/supabase', () => ({
  __esModule: true,
  default: {
    createLocalUser: jest.fn(),
    findUserByEmail: jest.fn(),
    findUserById: jest.fn(),
    updatePasswordHash: jest.fn(),
  },
}));

import request from 'supertest';
import express from 'express';
import bcrypt from 'bcryptjs';
import supabaseService from '@/services/supabase';
import authService from '@/services/authService';
import authRouter from '@/routes/auth';

const mocked = jest.mocked(supabaseService) as unknown as {
  createLocalUser: jest.Mock;
  findUserByEmail: jest.Mock;
  findUserById: jest.Mock;
  updatePasswordHash: jest.Mock;
};

const app = express();
app.use(express.json());
app.use('/', authRouter);

const PASSWORD = 'correct-horse-battery';
const passwordHash = bcrypt.hashSync(PASSWORD, 4); // low cost keeps tests fast

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  appleId: null,
  name: 'Test User',
  passwordHash,
  role: 'USER',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /signup', () => {
  const validBody = {
    email: 'New@Example.com',
    password: 'a-strong-password',
    name: 'New User',
    inviteCode: 'test-invite-code',
  };

  it('creates an account and returns 201 with user and token', async () => {
    mocked.findUserByEmail.mockResolvedValue(null);
    mocked.createLocalUser.mockResolvedValue({ ...mockUser, email: 'new@example.com' });

    const res = await request(app).post('/signup').send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.user.email).toBe('new@example.com');
    expect(res.body.data.user.passwordHash).toBeUndefined();
    // email is lowercased before storage and lookup
    expect(mocked.findUserByEmail).toHaveBeenCalledWith('new@example.com');
    expect(mocked.createLocalUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'new@example.com', name: 'New User' }),
    );
  });

  it('returns 403 for a wrong invite code', async () => {
    const res = await request(app).post('/signup').send({ ...validBody, inviteCode: 'nope' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(mocked.createLocalUser).not.toHaveBeenCalled();
  });

  it('returns 409 for an email that already has an account', async () => {
    mocked.findUserByEmail.mockResolvedValue(mockUser);

    const res = await request(app).post('/signup').send(validBody);

    expect(res.status).toBe(409);
    expect(mocked.createLocalUser).not.toHaveBeenCalled();
  });

  it('returns 400 for a password shorter than 8 characters', async () => {
    const res = await request(app).post('/signup').send({ ...validBody, password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mocked.findUserByEmail).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid email', async () => {
    const res = await request(app).post('/signup').send({ ...validBody, email: 'not-an-email' });

    expect(res.status).toBe(400);
  });
});

describe('POST /login', () => {
  it('returns 200 with user and token for valid credentials', async () => {
    mocked.findUserByEmail.mockResolvedValue(mockUser);

    const res = await request(app)
      .post('/login')
      .send({ email: 'Test@Example.com', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.user.id).toBe('user-1');
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('returns 401 for a wrong password', async () => {
    mocked.findUserByEmail.mockResolvedValue(mockUser);

    const res = await request(app)
      .post('/login')
      .send({ email: 'test@example.com', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('returns 401 with the same message for an unknown email', async () => {
    mocked.findUserByEmail.mockResolvedValue(null);

    const res = await request(app)
      .post('/login')
      .send({ email: 'nobody@example.com', password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('returns 401 for a legacy account without a password', async () => {
    mocked.findUserByEmail.mockResolvedValue({ ...mockUser, passwordHash: null });

    const res = await request(app)
      .post('/login')
      .send({ email: 'test@example.com', password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });
});

describe('POST /change-password', () => {
  const token = authService.generateToken(mockUser);

  it('updates the password for valid current credentials', async () => {
    mocked.findUserById.mockResolvedValue(mockUser);
    mocked.updatePasswordHash.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: PASSWORD, newPassword: 'a-new-strong-password' });

    expect(res.status).toBe(200);
    expect(mocked.updatePasswordHash).toHaveBeenCalledWith('user-1', expect.any(String));
  });

  it('returns 401 when the current password is wrong', async () => {
    mocked.findUserById.mockResolvedValue(mockUser);

    const res = await request(app)
      .post('/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'wrong', newPassword: 'a-new-strong-password' });

    expect(res.status).toBe(401);
    expect(mocked.updatePasswordHash).not.toHaveBeenCalled();
  });

  it('returns 401 without a token', async () => {
    const res = await request(app)
      .post('/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'a-new-strong-password' });

    expect(res.status).toBe(401);
    expect(mocked.findUserById).not.toHaveBeenCalled();
  });
});

describe('POST /verify', () => {
  it('returns 200 with the user for a valid token', async () => {
    mocked.findUserById.mockResolvedValue(mockUser);
    const token = authService.generateToken(mockUser);

    const res = await request(app).post('/verify').send({ token });

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe('user-1');
    expect(res.body.data.user.role).toBe('USER');
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('returns 400 when token is missing from the body', async () => {
    const res = await request(app).post('/verify').send({});

    expect(res.status).toBe(400);
  });

  it('returns 401 for a malformed token', async () => {
    const res = await request(app).post('/verify').send({ token: 'not-a-jwt' });

    expect(res.status).toBe(401);
    expect(mocked.findUserById).not.toHaveBeenCalled();
  });

  it('returns 401 when the token user no longer exists', async () => {
    mocked.findUserById.mockResolvedValue(null);
    const token = authService.generateToken(mockUser);

    const res = await request(app).post('/verify').send({ token });

    expect(res.status).toBe(401);
  });
});
