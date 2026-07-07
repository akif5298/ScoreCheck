import { Response, NextFunction } from 'express';
import { requireAdmin, AuthenticatedRequest } from '@/middleware/admin';

function mockReq(user?: { userId: string; email: string; role: string }): AuthenticatedRequest {
  return { user } as unknown as AuthenticatedRequest;
}

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('requireAdmin', () => {
  it('returns 401 when req.user is missing', () => {
    const req = mockReq(undefined);
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when the user role is not ADMIN', () => {
    const req = mockReq({ userId: 'u1', email: 'u1@example.com', role: 'USER' });
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Admin access required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when the user role is ADMIN', () => {
    const req = mockReq({ userId: 'u1', email: 'u1@example.com', role: 'ADMIN' });
    const res = mockRes();
    const next = jest.fn() as NextFunction;

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
