/**
 * Tests for POST /upload — the extraction path (previously untested).
 * Focus: the Phase-4 fail-fast behavior when the extraction host is down
 * (clean 503, not a confusing 500), and the no-file guard.
 *
 * All external services are mocked so no Ollama/DB/storage is needed.
 */

import request from 'supertest';
import express from 'express';
import { ExtractionUnavailableError } from '@/errors';

jest.mock('@/services/ollamaExtractor', () => ({
  assertExtractionHostReachable: jest.fn(),
  ollamaHeaders: jest.fn(() => ({ 'Content-Type': 'application/json' })),
}));

jest.mock('@/services/junkFilter', () => ({
  classifyScreenshot: jest.fn().mockResolvedValue({
    isValidBoxScore: true,
    confidence: 'high',
    reason: 'model_yes',
    latencyMs: 10,
  }),
}));

jest.mock('@/services/enhancedOCRService', () => ({
  EnhancedOCRService: jest.fn().mockImplementation(() => ({
    extractStructuredDataFromImage: jest.fn(),
  })),
}));

jest.mock('@/services/mappingService', () => ({
  __esModule: true,
  getMappingsForSquad: jest.fn().mockResolvedValue(new Map()),
  getAllowedNamesForSquad: jest.fn().mockResolvedValue(new Set()),
  getAllowedNamesArray: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/services/supabase', () => ({
  __esModule: true,
  default: {
    getGameHashesBySquadId: jest.fn().mockResolvedValue([]),
    getGameByScreenshotUrl: jest.fn().mockResolvedValue(null),
    uploadImage: jest.fn().mockResolvedValue('u1-1-boxscore.png'),
  },
}));

jest.mock('@/middleware/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', email: 'test@example.com', role: 'USER' };
    next();
  },
}));

jest.mock('@/middleware/squad', () => ({
  // Stands in for the DB-backed scope resolution; routes just need req.squadId set.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolveSquad: (req: any, _res: any, next: any) => {
    req.squadId = 'test-squad-1';
    next();
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireSquadId: (req: any) => req.squadId,
  SQUAD_HEADER: 'x-squad-id',
}));

import { assertExtractionHostReachable } from '@/services/ollamaExtractor';
import screenshotsRouter from '@/routes/screenshots';

const mockedReachable = assertExtractionHostReachable as jest.Mock;

const app = express();
app.use(express.json());
app.use('/', screenshotsRouter);

// A 1x1 PNG so multer's image fileFilter accepts the upload.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /upload', () => {
  it('returns 503 when the extraction host is unreachable', async () => {
    mockedReachable.mockRejectedValue(new ExtractionUnavailableError());

    const res = await request(app).post('/upload').attach('screenshot', PNG, 'shot.png');

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/unavailable/i);
  });

  it('returns 400 when no file is attached', async () => {
    mockedReachable.mockResolvedValue(undefined);

    const res = await request(app).post('/upload').field('note', 'no file here');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    // Reachability isn't checked until after the file guard.
    expect(mockedReachable).not.toHaveBeenCalled();
  });
});
