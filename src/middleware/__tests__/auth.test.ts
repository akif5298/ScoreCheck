jest.mock('@/services/appleAuth', () => ({
  __esModule: true,
  default: { verifyToken: jest.fn() },
}));

import { Request, Response, NextFunction } from 'express';
import appleAuthService from '@/services/appleAuth';
import { authenticateToken, optionalAuth } from '@/middleware/auth';

const mockedVerifyToken = jest.mocked(appleAuthService.verifyToken);

function mockReq(authHeader?: string): Request {
  return { headers: { authorization: authHeader } } as unknown as Request;
}

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

const payload = { userId: 'user-1', email: 'test@example.com', role: 'USER' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('authenticateToken', () => {
  it('returns 401 when no Authorization header is present', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Access token required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the Authorization header has no token part', async () => {
    const req = mockReq('Bearer');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets req.user and calls next() for a valid token', async () => {
    mockedVerifyToken.mockReturnValue(payload as any);
    const req = mockReq('Bearer valid-token');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    await authenticateToken(req, res, next);

    expect(mockedVerifyToken).toHaveBeenCalledWith('valid-token');
    expect(req.user).toEqual(payload);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when verifyToken throws for an invalid token', async () => {
    mockedVerifyToken.mockImplementation(() => {
      throw new Error('Invalid token');
    });
    const req = mockReq('Bearer bad-token');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Authentication failed' });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('optionalAuth', () => {
  it('calls next() without setting req.user when no token is present', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    await optionalAuth(req, res, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets req.user and calls next() for a valid token', async () => {
    mockedVerifyToken.mockReturnValue(payload as any);
    const req = mockReq('Bearer valid-token');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    await optionalAuth(req, res, next);

    expect(req.user).toEqual(payload);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next() without req.user when verifyToken throws', async () => {
    mockedVerifyToken.mockImplementation(() => {
      throw new Error('Invalid token');
    });
    const req = mockReq('Bearer bad-token');
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    await optionalAuth(req, res, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
