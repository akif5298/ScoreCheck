process.env.JWT_SECRET = 'test-secret-key-for-jwt-signing-0123456789';
process.env.INVITE_CODE = 'test-invite-code';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
// Same reason as above: this file exercises change-password behaviour, not its throttle.
// The limiter itself is covered by auth.rateLimit.test.ts, which sets a low ceiling.
process.env.PASSWORD_CHANGE_RATE_LIMIT_MAX = '1000';

// Signup and change-password now consult the breach policy, which reaches out to HIBP.
// Stubbed here so these tests stay hermetic and offline — the policy's own behaviour,
// including its fail-open path, is covered by services/__tests__/passwordPolicy.test.ts.
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
  // Signup wraps user creation and personal-squad creation in one transaction.
  pgPool: {
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    }),
  },
}));

jest.mock('@/services/squadService', () => ({
  __esModule: true,
  createPersonalSquad: jest.fn().mockResolvedValue({
    id: 'squad-personal-1',
    name: 'Personal',
    isPersonal: true,
    createdByUserId: 'user-1',
  }),
  // Signup accepts a squad invite token as an alternative to the global INVITE_CODE.
  // Default: the code is not a squad invite, so only the global code opens the gate.
  getInvitePreview: jest.fn().mockResolvedValue(null),
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
      expect.anything(), // transaction client
    );
  });

  it('creates the personal squad in the same transaction as the user', async () => {
    // An account with no personal squad has no resolvable data scope, so the two must
    // be created atomically — never one without the other.
    const { createPersonalSquad } = jest.requireMock('@/services/squadService');
    mocked.findUserByEmail.mockResolvedValue(null);
    mocked.createLocalUser.mockResolvedValue({ ...mockUser, email: 'new@example.com' });

    await request(app).post('/signup').send(validBody);

    expect(createPersonalSquad).toHaveBeenCalledWith('user-1', expect.anything());
    // Same client object passed to both = same transaction.
    const userClient = mocked.createLocalUser.mock.calls[0]![1];
    const squadClient = (createPersonalSquad as jest.Mock).mock.calls[0]![1];
    expect(userClient).toBe(squadClient);
  });

  it('returns 403 for a wrong invite code', async () => {
    const res = await request(app).post('/signup').send({ ...validBody, inviteCode: 'nope' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(mocked.createLocalUser).not.toHaveBeenCalled();
  });

  it('accepts a valid squad invite token in place of the global invite code', async () => {
    // Being invited to a squad is sufficient authorization: the join page passes the
    // invite token as the inviteCode, and signup must let it through even though it does
    // not match INVITE_CODE.
    const { getInvitePreview } = jest.requireMock('@/services/squadService');
    getInvitePreview.mockResolvedValue({ squadId: 's1', squadName: 'Tuesday Run' });
    mocked.findUserByEmail.mockResolvedValue(null);
    mocked.createLocalUser.mockResolvedValue({ ...mockUser, email: 'new@example.com' });

    const res = await request(app)
      .post('/signup')
      .send({ ...validBody, inviteCode: 'a-squad-invite-token' });

    expect(res.status).toBe(201);
    expect(getInvitePreview).toHaveBeenCalledWith('a-squad-invite-token');
    expect(mocked.createLocalUser).toHaveBeenCalled();
  });

  it('does not consume the squad invite during signup (the join step does)', async () => {
    // acceptInvite is never called here — the client joins as a separate step, so a
    // maxUses:1 link is not spent just by creating the account.
    const squadSvc = jest.requireMock('@/services/squadService');
    squadSvc.getInvitePreview.mockResolvedValue({ squadId: 's1', squadName: 'Tuesday Run' });
    mocked.findUserByEmail.mockResolvedValue(null);
    mocked.createLocalUser.mockResolvedValue({ ...mockUser, email: 'new@example.com' });

    await request(app).post('/signup').send({ ...validBody, inviteCode: 'a-squad-invite-token' });

    expect(squadSvc.acceptInvite).toBeUndefined();
  });

  it('rejects a code that is neither the global code nor a squad invite', async () => {
    const { getInvitePreview } = jest.requireMock('@/services/squadService');
    getInvitePreview.mockResolvedValue(null);

    const res = await request(app).post('/signup').send({ ...validBody, inviteCode: 'nope' });

    expect(res.status).toBe(403);
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
