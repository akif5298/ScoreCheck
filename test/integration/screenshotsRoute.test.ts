/**
 * Integration tests for /api/screenshots.
 *
 * The four existing unit suites mock the service layer wholesale, so they pin response
 * shapes but never touch squad scoping, the real duplicate check, or the in-memory quota.
 * These drive the real router — real JWT, real resolveSquad, real multer, real database —
 * and mock only what genuinely sits outside the process: the GPU extraction host, the junk
 * filter that calls it, and Supabase Storage (which the harness deliberately points at an
 * unroutable host).
 */
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import sharp from 'sharp';

// The daily quota is 50 and the per-minute upload limiter is 10, so the limiter always
// trips first and a naive "upload until 429" test silently measures the wrong guard.
// Lower the quota and raise the limiter so each can be exercised on its own terms.
jest.mock('@/constants', () => ({
  ...jest.requireActual('@/constants'),
  EXTRACTION_DAILY_LIMIT: 2,
  UPLOAD_RATE_LIMIT_MAX: 1000,
}));

jest.mock('@/services/ollamaExtractor', () => ({
  assertExtractionHostReachable: jest.fn().mockResolvedValue(undefined),
  warmupModel: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/services/junkFilter', () => ({
  classifyScreenshot: jest.fn().mockResolvedValue({ isValidBoxScore: true, confidence: 'high' }),
}));

jest.mock('@/services/enhancedOCRService', () => ({
  EnhancedOCRService: Object.assign(
    jest.fn().mockImplementation(() => ({
      extractStructuredDataFromImage: jest.fn().mockResolvedValue({ players: [], teams: [] }),
    })),
    {
      generateCustomTeamNamesAfterAssignment: jest.fn().mockReturnValue({
        teamAName: 'Akif (PG)',
        teamBName: 'Team B',
      }),
    },
  ),
}));

import supabaseService, { pgPool } from '@/services/supabase';
import authService from '@/services/authService';
import screenshotsRouter from '@/routes/screenshots';
import { assertExtractionHostReachable } from '@/services/ollamaExtractor';
import { classifyScreenshot } from '@/services/junkFilter';
import { ExtractionUnavailableError } from '@/errors';
import { makeUser, makeSquad, makeMapping } from './factories';

const mockedReachable = assertExtractionHostReachable as jest.Mock;
const mockedJunk = classifyScreenshot as jest.Mock;

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/screenshots', screenshotsRouter);
  return a;
}

async function actor() {
  const user = await makeUser();
  const squad = await makeSquad(user.id);
  await pgPool.query('UPDATE users SET "activeSquadId" = $1 WHERE id = $2', [squad.id, user.id]);
  return {
    user,
    squad,
    auth: `Bearer ${authService.generateToken({ id: user.id, email: user.email, role: 'USER' })}`,
  };
}

/**
 * A real PNG, so multer's filter and validateMagicBytes both see genuine image bytes.
 *
 * Deliberately noisy rather than a flat fill. A perceptual hash encodes gradients, and a
 * solid-colour image has none: every flat fixture hashed to all zeros whatever its colour,
 * which made any two of them duplicates of each other (distance 0, against a threshold of
 * 10). Tests that upload several files in one request were therefore uploading what the
 * dedup logic considers the same screenshot, and could not express "two different
 * screenshots" at all.
 *
 * Seeded xorshift noise gives distinct seeds a pairwise distance of ~112, while the same
 * seed still reproduces byte-for-byte — which the duplicate-detection tests depend on.
 */
async function pngBuffer(seed = 0): Promise<Buffer> {
  const width = 64;
  const height = 64;
  const pixels = Buffer.alloc(width * height * 3);
  // Nonzero state: xorshift is a fixed point at 0 and would emit a flat image again.
  let state = ((seed + 1) * 2654435761) >>> 0 || 0x9e3779b9;
  const next = (): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
  for (let i = 0; i < width * height; i++) {
    const v = Math.floor(next() * 256);
    pixels[i * 3] = v;
    pixels[i * 3 + 1] = (v * 3) % 256;
    pixels[i * 3 + 2] = (v * 7) % 256;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

async function seedGame(
  squadId: string,
  uploaderId: string,
  opts: { imageHash?: string | null; screenshotUrl?: string | null } = {},
): Promise<string> {
  const id = randomUUID();
  await pgPool.query(
    `INSERT INTO games (id, date, "homeTeam", "awayTeam", "homeScore", "awayScore",
                        "squadId", "uploadedByUserId", "imageHash", "screenshotUrl",
                        "createdAt", "updatedAt")
     VALUES ($1, NOW(), 'Team A', 'Team B', 100, 90, $2, $3, $4, $5, NOW(), NOW())`,
    [
      id,
      squadId,
      uploaderId,
      opts.imageHash === undefined ? null : opts.imageHash,
      opts.screenshotUrl === undefined ? null : opts.screenshotUrl,
    ],
  );
  return id;
}

beforeEach(() => {
  mockedReachable.mockResolvedValue(undefined);
  mockedJunk.mockResolvedValue({ isValidBoxScore: true, confidence: 'high' });
});

afterEach(() => jest.restoreAllMocks());

describe('authentication', () => {
  it.each([
    ['get', '/api/screenshots/games'],
    ['get', '/api/screenshots/games/abc'],
    ['get', '/api/screenshots/games/abc/screenshot'],
    ['post', '/api/screenshots/generate-team-names'],
    ['post', '/api/screenshots/warmup'],
  ])('%s %s requires a token', async (method, path) => {
    const res = await request(app())[method as 'get'](path);
    expect(res.status).toBe(401);
  });
});

describe('POST /warmup', () => {
  it('answers 202 immediately without waiting for the host', async () => {
    const me = await actor();

    const res = await request(app())
      .post('/api/screenshots/warmup')
      .set('Authorization', me.auth);

    // Fire-and-forget: the client pokes this when the upload page mounts so Modal's cold
    // start overlaps with the user picking files.
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ success: true });
  });

  it('answers 202 rather than 429 once the warmup limiter trips', async () => {
    const me = await actor();
    const a = app();

    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await request(a).post('/api/screenshots/warmup').set('Authorization', me.auth);
      statuses.push(res.status);
    }

    // A throttled warmup is a no-op, not an error — the host is already warming.
    expect(new Set(statuses)).toEqual(new Set([202]));
  });
});

describe('GET /games', () => {
  it('returns the squad\'s games', async () => {
    const me = await actor();
    await seedGame(me.squad.id, me.user.id);

    const res = await request(app()).get('/api/screenshots/games').set('Authorization', me.auth);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("never returns another squad's games", async () => {
    const me = await actor();
    const other = await actor();
    await seedGame(other.squad.id, other.user.id);

    const res = await request(app()).get('/api/screenshots/games').set('Authorization', me.auth);

    expect(res.body.data).toEqual([]);
  });

  it('reports page metadata alongside the rows', async () => {
    const me = await actor();
    for (let i = 0; i < 3; i++) await seedGame(me.squad.id, me.user.id);

    const res = await request(app()).get('/api/screenshots/games').set('Authorization', me.auth);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 25, total: 3, totalPages: 1 });
  });

  it('pages through the full set without repeating or dropping a game', async () => {
    // The property that makes pagination correct rather than merely present. The
    // unpaginated query has no ORDER BY at all, and these seeded games share one date, so
    // without the id tiebreak in the paged query a row could surface on two pages or on
    // neither.
    const me = await actor();
    const seeded: string[] = [];
    for (let i = 0; i < 5; i++) seeded.push(await seedGame(me.squad.id, me.user.id));

    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const res = await request(app())
        .get(`/api/screenshots/games?page=${page}&pageSize=2`)
        .set('Authorization', me.auth);
      expect(res.status).toBe(200);
      expect(res.body.meta).toMatchObject({ page, pageSize: 2, total: 5, totalPages: 3 });
      seen.push(...res.body.data.map((g: { id: string }) => g.id));
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect([...seen].sort()).toEqual([...seeded].sort());
  });

  it('clamps an oversized pageSize so the unbounded query cannot be re-requested', async () => {
    const me = await actor();
    await seedGame(me.squad.id, me.user.id);

    const res = await request(app())
      .get('/api/screenshots/games?pageSize=1000000')
      .set('Authorization', me.auth);

    expect(res.body.meta.pageSize).toBe(100);
  });

  it('falls back to sane defaults on nonsense parameters rather than erroring', async () => {
    const me = await actor();
    await seedGame(me.squad.id, me.user.id);

    const res = await request(app())
      .get('/api/screenshots/games?page=-4&pageSize=abc')
      .set('Authorization', me.auth);

    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 25 });
  });

  it('500s when the read fails', async () => {
    const me = await actor();
    // Spies the method the paginated route actually calls now — getGamesBySquadId is no
    // longer on this path, though analytics still depends on it.
    jest
      .spyOn(supabaseService, 'getGamesPageBySquadId')
      .mockRejectedValue(new Error('db down') as never);

    const res = await request(app()).get('/api/screenshots/games').set('Authorization', me.auth);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to fetch games' });
  });
});

describe('GET /games/:gameId', () => {
  it('returns the game', async () => {
    const me = await actor();
    const gameId = await seedGame(me.squad.id, me.user.id);

    const res = await request(app())
      .get(`/api/screenshots/games/${gameId}`)
      .set('Authorization', me.auth);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(gameId);
  });

  it('404s for an unknown id', async () => {
    const me = await actor();

    const res = await request(app())
      .get(`/api/screenshots/games/${randomUUID()}`)
      .set('Authorization', me.auth);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Game not found');
  });

  it("404s for another squad's game rather than revealing it exists", async () => {
    const me = await actor();
    const other = await actor();
    const theirGame = await seedGame(other.squad.id, other.user.id);

    const res = await request(app())
      .get(`/api/screenshots/games/${theirGame}`)
      .set('Authorization', me.auth);

    expect(res.status).toBe(404);
  });

  it('500s when the read fails', async () => {
    const me = await actor();
    // Spies the method the route actually calls: it looks a game up by id rather than
    // scanning the whole squad. The contract under test is unchanged — a failed read must
    // surface as 500, never as a 404 that reads like "no such game".
    jest
      .spyOn(supabaseService, 'getGameById')
      .mockRejectedValue(new Error('db down') as never);

    const res = await request(app())
      .get('/api/screenshots/games/anything')
      .set('Authorization', me.auth);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to fetch game' });
  });
});

describe('GET /games/:gameId/screenshot', () => {
  it('mints a signed URL from the stored object path', async () => {
    const me = await actor();
    const gameId = await seedGame(me.squad.id, me.user.id, { screenshotUrl: 'path/shot.jpg' });
    jest.spyOn(supabaseService, 'getSignedUrl').mockResolvedValue('https://signed/shot.jpg');

    const res = await request(app())
      .get(`/api/screenshots/games/${gameId}/screenshot`)
      .set('Authorization', me.auth);

    // The DB stores an object path, never a URL — the URL is minted per read so it cannot
    // go stale in the database.
    expect(res.status).toBe(200);
    expect(res.body.data.url).toBe('https://signed/shot.jpg');
  });

  it('404s for an unknown game', async () => {
    const me = await actor();

    const res = await request(app())
      .get(`/api/screenshots/games/${randomUUID()}/screenshot`)
      .set('Authorization', me.auth);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Game not found');
  });

  it("404s for another squad's game", async () => {
    const me = await actor();
    const other = await actor();
    const theirGame = await seedGame(other.squad.id, other.user.id, {
      screenshotUrl: 'path/shot.jpg',
    });

    const res = await request(app())
      .get(`/api/screenshots/games/${theirGame}/screenshot`)
      .set('Authorization', me.auth);

    expect(res.status).toBe(404);
  });

  it('404s with a distinct message when the game has no screenshot', async () => {
    const me = await actor();
    const gameId = await seedGame(me.squad.id, me.user.id, { screenshotUrl: null });

    const res = await request(app())
      .get(`/api/screenshots/games/${gameId}/screenshot`)
      .set('Authorization', me.auth);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('No screenshot for this game');
  });

  it('500s when signing throws', async () => {
    const me = await actor();
    const gameId = await seedGame(me.squad.id, me.user.id, { screenshotUrl: 'path/shot.jpg' });
    jest
      .spyOn(supabaseService, 'getSignedUrl')
      .mockRejectedValue(new Error('storage down') as never);

    const res = await request(app())
      .get(`/api/screenshots/games/${gameId}/screenshot`)
      .set('Authorization', me.auth);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to load screenshot' });
  });
});

describe('POST /generate-team-names', () => {
  it('builds names from the squad roster', async () => {
    const me = await actor();
    await makeMapping(me.squad.id, 'tag-akif', 'Akif');

    const res = await request(app())
      .post('/api/screenshots/generate-team-names')
      .set('Authorization', me.auth)
      .send({ players: [{ name: 'Akif', position: 'PG' }] });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ teamAName: 'Akif (PG)', teamBName: 'Team B' });
  });

  it.each([
    ['a missing players field', {}],
    ['a non-array players field', { players: 'nope' }],
  ])('400s on %s', async (_label, body) => {
    const me = await actor();

    const res = await request(app())
      .post('/api/screenshots/generate-team-names')
      .set('Authorization', me.auth)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Players array is required');
  });

  it('500s when the roster lookup fails', async () => {
    const me = await actor();
    const real = pgPool.query.bind(pgPool);
    jest.spyOn(pgPool, 'query').mockImplementation(((sql: unknown, params: unknown) => {
      if (typeof sql === 'string' && /DISTINCT "displayName"/.test(sql)) {
        return Promise.reject(new Error('db down'));
      }
      return real(sql as never, params as never);
    }) as never);

    const res = await request(app())
      .post('/api/screenshots/generate-team-names')
      .set('Authorization', me.auth)
      .send({ players: [] });

    expect(res.status).toBe(500);
  });
});

describe('POST /upload-multiple', () => {
  it('400s when no files are attached', async () => {
    const me = await actor();

    const res = await request(app())
      .post('/api/screenshots/upload-multiple')
      .set('Authorization', me.auth);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No files uploaded');
  });

  it('extracts each file and returns a result per image', async () => {
    const me = await actor();
    jest.spyOn(supabaseService, 'uploadImage').mockResolvedValue('stored/path.png');

    const res = await request(app())
      .post('/api/screenshots/upload-multiple')
      .set('Authorization', me.auth)
      .attach('screenshots', await pngBuffer(1), 'IMG_0001.png')
      .attach('screenshots', await pngBuffer(200), 'IMG_0002.png');

    expect(res.status).toBe(200);
    expect(res.body.data.totalProcessed).toBe(2);
    expect(res.body.data.results[0]).toMatchObject({ fileName: 'IMG_0001.png' });
  });

  it('503s when the extraction host is unreachable', async () => {
    const me = await actor();
    mockedReachable.mockRejectedValue(new ExtractionUnavailableError());

    const res = await request(app())
      .post('/api/screenshots/upload-multiple')
      .set('Authorization', me.auth)
      .attach('screenshots', await pngBuffer(1), 'IMG_0001.png');

    // A clean 503 rather than a 500, so the client can show "try again shortly".
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/temporarily unavailable/);
  });

  it('422s when the bytes are not a real image', async () => {
    const me = await actor();

    const res = await request(app())
      .post('/api/screenshots/upload-multiple')
      .set('Authorization', me.auth)
      .attach('screenshots', Buffer.from('not an image at all'), 'IMG_0001.png');

    // multer's filter only sees the extension; validateMagicBytes reads the actual bytes.
    expect(res.status).toBe(422);
  });

  it('rejects a screenshot the squad has already saved', async () => {
    const me = await actor();
    const buf = await pngBuffer(42);
    const { computePerceptualHash } = await import('@/utils/imageHash');
    await seedGame(me.squad.id, me.user.id, { imageHash: await computePerceptualHash(buf) });

    const res = await request(app())
      .post('/api/screenshots/upload-multiple')
      .set('Authorization', me.auth)
      .attach('screenshots', buf, 'IMG_0001.png');

    // 409, matching POST /upload: a duplicate is a statement about the request, not a
    // server fault. This route used to answer 500 for the same condition.
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_SCREENSHOT');
    expect(res.body.error).toMatch(/visually similar screenshot already saved/);
  });

  it('rejects a duplicate that exists only within the request itself', async () => {
    const me = await actor();
    jest.spyOn(supabaseService, 'uploadImage').mockResolvedValue('stored/path.png');

    // The same screenshot twice, under two filenames. Neither is saved yet, so the
    // committed-hash check clears both: the collision exists only between the two files
    // in this one request. Each file used to be compared against the database alone, so
    // both passed and the squad ended up with the same game twice.
    const shot = await pngBuffer(4242);

    const res = await request(app())
      .post('/api/screenshots/upload-multiple')
      .set('Authorization', me.auth)
      .attach('screenshots', shot, 'IMG_4242.png')
      .attach('screenshots', shot, 'IMG_4243.png');

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_SCREENSHOT');
    expect(res.body.error).toMatch(/visually similar/i);
  });

  it('rejects an image the junk filter is confident is not a box score', async () => {
    const me = await actor();
    mockedJunk.mockResolvedValue({ isValidBoxScore: false, confidence: 'high' });

    const res = await request(app())
      .post('/api/screenshots/upload-multiple')
      .set('Authorization', me.auth)
      .attach('screenshots', await pngBuffer(3), 'IMG_0003.png');

    expect(res.body.error).toMatch(/does not appear to be a valid NBA 2K box score/);
  });

  it('lets a low-confidence junk verdict through', async () => {
    const me = await actor();
    mockedJunk.mockResolvedValue({ isValidBoxScore: false, confidence: 'low' });
    jest.spyOn(supabaseService, 'uploadImage').mockResolvedValue('stored/path.png');

    const res = await request(app())
      .post('/api/screenshots/upload-multiple')
      .set('Authorization', me.auth)
      .attach('screenshots', await pngBuffer(4), 'IMG_0004.png');

    // The filter fails open: an uncertain classifier must not block a real upload.
    expect(res.status).toBe(200);
  });
});

describe('POST /upload (single)', () => {
  it('400s when no file is attached', async () => {
    const me = await actor();

    const res = await request(app())
      .post('/api/screenshots/upload')
      .set('Authorization', me.auth);

    expect(res.status).toBe(400);
  });

  it('extracts a single screenshot', async () => {
    const me = await actor();
    jest.spyOn(supabaseService, 'uploadImage').mockResolvedValue('stored/path.png');

    const res = await request(app())
      .post('/api/screenshots/upload')
      .set('Authorization', me.auth)
      .attach('screenshot', await pngBuffer(5), 'IMG_0005.png');

    expect(res.status).toBe(200);
  });

  it('503s when the extraction host is unreachable', async () => {
    const me = await actor();
    mockedReachable.mockRejectedValue(new ExtractionUnavailableError());

    const res = await request(app())
      .post('/api/screenshots/upload')
      .set('Authorization', me.auth)
      .attach('screenshot', await pngBuffer(6), 'IMG_0006.png');

    expect(res.status).toBe(503);
  });
});

describe('daily extraction quota', () => {
  it('429s with the quota message once the user is at their daily limit', async () => {
    const me = await actor();
    jest.spyOn(supabaseService, 'uploadImage').mockResolvedValue('stored/path.png');
    const a = app();

    const statuses: number[] = [];
    let lastBody: { error?: string } = {};
    // Limit is mocked to 2, so the third attempt must be refused.
    for (let i = 0; i < 3; i++) {
      const res = await request(a)
        .post('/api/screenshots/upload')
        .set('Authorization', me.auth)
        .attach('screenshot', await pngBuffer(100 + i), `IMG_${1000 + i}.png`);
      statuses.push(res.status);
      lastBody = res.body;
    }

    expect(statuses).toEqual([200, 200, 429]);
    // Asserting the message, not just the status: the per-minute upload limiter also
    // answers 429, and an earlier version of this test was measuring that instead.
    expect(lastBody.error).toMatch(/Daily extraction limit reached/);
  }, 60_000);

  it('counts each file in a batch, not each request', async () => {
    const me = await actor();
    jest.spyOn(supabaseService, 'uploadImage').mockResolvedValue('stored/path.png');
    const a = app();

    // Two files in one request consumes the whole quota of 2.
    const first = await request(a)
      .post('/api/screenshots/upload-multiple')
      .set('Authorization', me.auth)
      .attach('screenshots', await pngBuffer(11), 'IMG_0011.png')
      .attach('screenshots', await pngBuffer(222), 'IMG_0012.png');
    expect(first.status).toBe(200);

    const second = await request(a)
      .post('/api/screenshots/upload')
      .set('Authorization', me.auth)
      .attach('screenshot', await pngBuffer(33), 'IMG_0013.png');

    expect(second.status).toBe(429);
  }, 60_000);

  it('refuses a batch that would cross the limit rather than letting it overrun', async () => {
    const me = await actor();
    jest.spyOn(supabaseService, 'uploadImage').mockResolvedValue('stored/path.png');
    const a = app();

    // Burn 1 of the 2 available.
    const first = await request(a)
      .post('/api/screenshots/upload')
      .set('Authorization', me.auth)
      .attach('screenshot', await pngBuffer(61), 'IMG_6001.png');
    expect(first.status).toBe(200);

    // 1 used, 2 requested. The gate used to ask only "is used >= limit?" — false at 1 —
    // so the whole batch extracted and the user landed at 3/2. The cost has to be
    // reserved against the batch size before any of it runs.
    const second = await request(a)
      .post('/api/screenshots/upload-multiple')
      .set('Authorization', me.auth)
      .attach('screenshots', await pngBuffer(62), 'IMG_6002.png')
      .attach('screenshots', await pngBuffer(63), 'IMG_6003.png');

    expect(second.status).toBe(429);
    expect(second.body.error).toMatch(/Daily extraction limit reached/);
  }, 60_000);

  it('does not charge quota for a request that never reached extraction', async () => {
    const me = await actor();
    jest.spyOn(supabaseService, 'uploadImage').mockResolvedValue('stored/path.png');
    const a = app();

    // The reachability probe fails before any inference runs, so the reservation this
    // request took has to be handed back. Charging for it would let a GPU outage quietly
    // eat a user's daily allowance.
    mockedReachable.mockRejectedValueOnce(new ExtractionUnavailableError());
    const down = await request(a)
      .post('/api/screenshots/upload')
      .set('Authorization', me.auth)
      .attach('screenshot', await pngBuffer(88), 'IMG_8800.png');
    expect(down.status).toBe(503);

    // Both of the day's extractions must still be available.
    for (const seed of [140, 199]) {
      const res = await request(a)
        .post('/api/screenshots/upload')
        .set('Authorization', me.auth)
        .attach('screenshot', await pngBuffer(seed), `IMG_8${seed}.png`);
      expect(res.status).toBe(200);
    }
  }, 60_000);

  it('tracks the quota per user, not globally', async () => {
    const me = await actor();
    const them = await actor();
    jest.spyOn(supabaseService, 'uploadImage').mockResolvedValue('stored/path.png');
    const a = app();

    for (let i = 0; i < 2; i++) {
      await request(a)
        .post('/api/screenshots/upload')
        .set('Authorization', me.auth)
        .attach('screenshot', await pngBuffer(40 + i), `IMG_${2000 + i}.png`);
    }
    const mine = await request(a)
      .post('/api/screenshots/upload')
      .set('Authorization', me.auth)
      .attach('screenshot', await pngBuffer(49), 'IMG_2099.png');
    expect(mine.status).toBe(429);

    const theirs = await request(a)
      .post('/api/screenshots/upload')
      .set('Authorization', them.auth)
      .attach('screenshot', await pngBuffer(50), 'IMG_3000.png');

    expect(theirs.status).toBe(200);
  }, 60_000);
});

describe('single upload — remaining guards', () => {
  it('409s on a screenshot the squad already holds', async () => {
    const me = await actor();
    const buf = await pngBuffer(77);
    const { computePerceptualHash } = await import('@/utils/imageHash');
    await seedGame(me.squad.id, me.user.id, { imageHash: await computePerceptualHash(buf) });

    const res = await request(app())
      .post('/api/screenshots/upload')
      .set('Authorization', me.auth)
      .attach('screenshot', buf, 'IMG_0077.png');

    // The single-file path reports a duplicate as a 409 with a code, unlike the batch
    // path which throws and lands in the generic handler.
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_SCREENSHOT');
  });

  it('422s when the junk filter is confident the image is not a box score', async () => {
    const me = await actor();
    mockedJunk.mockResolvedValue({ isValidBoxScore: false, confidence: 'high' });

    const res = await request(app())
      .post('/api/screenshots/upload')
      .set('Authorization', me.auth)
      .attach('screenshot', await pngBuffer(78), 'IMG_0078.png');

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/does not appear to be a valid NBA 2K box score/);
  });

  it('proceeds without mappings when the roster lookup fails', async () => {
    const me = await actor();
    jest.spyOn(supabaseService, 'uploadImage').mockResolvedValue('stored/path.png');
    const real = pgPool.query.bind(pgPool);
    jest.spyOn(pgPool, 'query').mockImplementation(((sql: unknown, params: unknown) => {
      if (typeof sql === 'string' && /SELECT gamertag, "displayName"/.test(sql)) {
        return Promise.reject(new Error('roster unavailable'));
      }
      return real(sql as never, params as never);
    }) as never);

    const res = await request(app())
      .post('/api/screenshots/upload')
      .set('Authorization', me.auth)
      .attach('screenshot', await pngBuffer(79), 'IMG_0079.png');

    // Fail-open by design: an unmapped extraction is still worth reviewing, and the names
    // can be fixed on the roster page afterwards.
    expect(res.status).toBe(200);
  });

  it('rejects a non-image extension at the multer filter, before any OCR', async () => {
    const me = await actor();

    const res = await request(app())
      .post('/api/screenshots/upload')
      .set('Authorization', me.auth)
      .attach('screenshot', Buffer.from('%PDF-1.4'), 'notes.pdf');

    // multer's fileFilter throws, so this never reaches the handler at all.
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('POST /save — the real write path', () => {
  /** Ten players, ids 0-9, which is what the position-by-slot helper expects. */
  function tenPlayers() {
    return Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      name: `P${i}`,
      team: i < 5 ? 'Team A' : 'Team B',
      points: 10 + i,
      rebounds: i,
      assists: i,
      steals: 1,
      blocks: 1,
      turnovers: 1,
      fouls: 1,
      fgMade: 4,
      fgAttempted: 8,
      threeMade: 1,
      threeAttempted: 3,
      ftMade: 1,
      ftAttempted: 2,
    }));
  }

  const gameData = {
    homeTeam: 'Team A',
    awayTeam: 'Team B',
    homeScore: 100,
    awayScore: 90,
  };

  it.each([
    ['gameData', { playersData: [], imageUrl: 'x' }],
    ['playersData', { gameData, imageUrl: 'x' }],
    ['imageUrl', { gameData, playersData: [] }],
  ])('400s when %s is missing', async (_label, body) => {
    const me = await actor();

    const res = await request(app())
      .post('/api/screenshots/save')
      .set('Authorization', me.auth)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing required data for saving');
  });

  it('410s when the upload behind the save has timed out', async () => {
    const me = await actor();
    const { pendingHashes } = await import('@/services/pendingHashes');
    const imageUrl = 'stored/expired-shot.png';

    // Stand in for an upload half an hour ago. Reaching into the bridge directly rather
    // than driving /upload and waiting: the point under test is what /save does once the
    // entry has lapsed, and TtlMap's own expiry is unit-tested separately.
    pendingHashes.set(imageUrl, 'a'.repeat(60));
    const realNow = Date.now;
    Date.now = () => realNow() + 31 * 60 * 1000;
    try {
      const res = await request(app())
        .post('/api/screenshots/save')
        .set('Authorization', me.auth)
        .send({ gameData, playersData: tenPlayers(), imageUrl, originalFileName: 'IMG_9001.png' });

      expect(res.status).toBe(410);
      expect(res.body.code).toBe('UPLOAD_EXPIRED');
      expect(res.body.error).toMatch(/upload the screenshot again/i);
    } finally {
      Date.now = realNow;
      pendingHashes.delete(imageUrl);
    }

    // Nothing was written — the user has to re-upload, not end up with a half-saved game.
    const { rows } = await pgPool.query('SELECT id FROM games WHERE "squadId" = $1', [me.squad.id]);
    expect(rows).toHaveLength(0);
  });

  it('still saves when the bridge never knew the screenshot at all', async () => {
    // A save whose upload predates a restart, or that never went through /upload, cannot be
    // attributed to a timeout — it must keep working, storing a null imageHash as before.
    const me = await actor();

    const res = await request(app())
      .post('/api/screenshots/save')
      .set('Authorization', me.auth)
      .send({
        gameData,
        playersData: tenPlayers(),
        imageUrl: 'stored/never-seen.png',
        originalFileName: 'IMG_9002.png',
      });

    expect(res.status).toBe(200);
    const { rows } = await pgPool.query<{ imageHash: string | null }>(
      'SELECT "imageHash" FROM games WHERE "squadId" = $1',
      [me.squad.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.imageHash).toBeNull();
  });

  it('persists the game, its players and both team rows', async () => {
    const me = await actor();

    const res = await request(app())
      .post('/api/screenshots/save')
      .set('Authorization', me.auth)
      .send({
        gameData,
        playersData: tenPlayers(),
        imageUrl: 'stored/shot.png',
        originalFileName: 'IMG_0500.png',
      });

    expect(res.status).toBe(200);

    const { rows: games } = await pgPool.query(
      'SELECT id FROM games WHERE "squadId" = $1',
      [me.squad.id],
    );
    expect(games).toHaveLength(1);

    const { rows: players } = await pgPool.query<{ n: string }>(
      'SELECT COUNT(*) n FROM players WHERE "squadId" = $1',
      [me.squad.id],
    );
    expect(Number(players[0]!.n)).toBe(10);

    const { rows: teams } = await pgPool.query<{ n: string }>(
      'SELECT COUNT(*) n FROM teams WHERE "squadId" = $1',
      [me.squad.id],
    );
    expect(Number(teams[0]!.n)).toBe(2);
  });

  it('reads the slot out of the review id and maps it to a position', async () => {
    const me = await actor();
    // The review UI ids look like "row_3_abc"; the slot is the bracketed digits, not the
    // whole id and not the array index.
    const slotted = tenPlayers().map((p, i) => ({ ...p, id: `row_${i}_abc` }));

    await request(app())
      .post('/api/screenshots/save')
      .set('Authorization', me.auth)
      .send({ gameData, playersData: slotted, imageUrl: 'stored/pos.png' });

    const { rows } = await pgPool.query<{ name: string; position: string }>(
      'SELECT name, position FROM players WHERE "squadId" = $1 ORDER BY name',
      [me.squad.id],
    );
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.position]));
    // Slots 0 and 5 are both point guards — the two teams share one slot ordering.
    expect(byName['P0']).toBe('PG');
    expect(byName['P5']).toBe('PG');
    expect(byName['P4']).toBe('C');
    expect(byName['P9']).toBe('C');
  });

  it('falls back to the array index when the id carries no slot', async () => {
    const me = await actor();
    // tenPlayers() uses bare ids ("0".."9"), which the /_(\d+)_/ pattern does not match.
    await request(app())
      .post('/api/screenshots/save')
      .set('Authorization', me.auth)
      .send({ gameData, playersData: tenPlayers(), imageUrl: 'stored/fallback.png' });

    const { rows } = await pgPool.query<{ name: string; position: string }>(
      'SELECT name, position FROM players WHERE "squadId" = $1',
      [me.squad.id],
    );
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.position]));
    // index + 1, so the first row becomes slot 1 (SG) rather than slot 0 (PG). Worth
    // knowing: the two id shapes produce different positions for the same lineup.
    expect(byName['P0']).toBe('SG');
    expect(byName['P9']).toBe('Unknown');
  });

  it('sums each side into its own team row', async () => {
    const me = await actor();

    await request(app())
      .post('/api/screenshots/save')
      .set('Authorization', me.auth)
      .send({ gameData, playersData: tenPlayers(), imageUrl: 'stored/totals.png' });

    const { rows } = await pgPool.query<{ name: string; rebounds: number }>(
      'SELECT name, rebounds FROM teams WHERE "squadId" = $1 ORDER BY name',
      [me.squad.id],
    );
    // Home slots 0-4 rebound 0+1+2+3+4 = 10; away slots 5-9 give 5+6+7+8+9 = 35.
    expect(rows.find((r) => r.name === 'Team A')!.rebounds).toBe(10);
    expect(rows.find((r) => r.name === 'Team B')!.rebounds).toBe(35);
  });

  it('returns the existing game instead of saving twice for the same image', async () => {
    const me = await actor();
    const body = {
      gameData,
      playersData: tenPlayers(),
      imageUrl: 'stored/same.png',
    };

    const first = await request(app())
      .post('/api/screenshots/save')
      .set('Authorization', me.auth)
      .send(body);
    const second = await request(app())
      .post('/api/screenshots/save')
      .set('Authorization', me.auth)
      .send(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.message).toBe('Game already exists in database');
    // The second call must return that game's OWN players, not an empty list.
    expect(second.body.data.players).toHaveLength(10);

    const { rows } = await pgPool.query<{ n: string }>(
      'SELECT COUNT(*) n FROM games WHERE "squadId" = $1',
      [me.squad.id],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });
});

describe('extractImageNumber fallback', () => {
  it('falls back to a timestamp when the filename carries no digits', async () => {
    const me = await actor();

    await request(app())
      .post('/api/screenshots/save')
      .set('Authorization', me.auth)
      .send({
        gameData: { homeTeam: 'Team A', awayTeam: 'Team B', homeScore: 1, awayScore: 1 },
        playersData: [{ id: '0', name: 'Solo', team: 'Team A', points: 1 }],
        imageUrl: 'stored/nodigits.png',
        originalFileName: 'screenshot.png',
      });

    const { rows } = await pgPool.query<{ gameIdFromFile: string }>(
      'SELECT "gameIdFromFile" FROM players WHERE "squadId" = $1',
      [me.squad.id],
    );
    // No pattern matches, so the helper stamps Date.now() rather than returning empty.
    expect(rows[0]!.gameIdFromFile).toMatch(/^\d{10,}$/);
  });
});

describe('unexpected failures', () => {
  it('500s from /upload when storage rejects, distinct from the 503 and 422 paths', async () => {
    const me = await actor();
    jest
      .spyOn(supabaseService, 'uploadImage')
      .mockRejectedValue(new Error('bucket unavailable') as never);

    const res = await request(app())
      .post('/api/screenshots/upload')
      .set('Authorization', me.auth)
      .attach('screenshot', await pngBuffer(88), 'IMG_0088.png');

    // Not a ValidationError and not an ExtractionUnavailableError, so it falls through to
    // the generic 500 rather than 422/503.
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('bucket unavailable');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('500s from PUT /games/:gameId when the update fails', async () => {
    const me = await actor();
    const gameId = await seedGame(me.squad.id, me.user.id);
    jest
      .spyOn(supabaseService, 'updateGame')
      .mockRejectedValue(new Error('update blew up') as never);

    const res = await request(app())
      .put(`/api/screenshots/games/${gameId}`)
      .set('Authorization', me.auth)
      .send({
        homeTeam: 'Team A',
        awayTeam: 'Team B',
        homeScore: 1,
        awayScore: 1,
        date: new Date().toISOString(),
        players: [],
      });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to update game' });
  });

  it('400s from PUT when a required field is missing', async () => {
    const me = await actor();
    const gameId = await seedGame(me.squad.id, me.user.id);

    // PUT takes a flat body, not the { gameData, playersData } shape /save uses.
    const res = await request(app())
      .put(`/api/screenshots/games/${gameId}`)
      .set('Authorization', me.auth)
      .send({ homeTeam: 'Team A', awayTeam: 'Team B' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing required fields/);
  });
});

describe('request body limits', () => {
  const gameData = {
    homeTeam: 'Team A',
    awayTeam: 'Team B',
    homeScore: 100,
    awayScore: 90,
  };

  it('refuses a save carrying more player rows than a box score can hold', async () => {
    // Every element becomes an INSERT in one transaction, so an unbounded array is a
    // write-amplification lever, not just bad data.
    const me = await actor();

    const res = await request(app())
      .post('/api/screenshots/save')
      .set('Authorization', me.auth)
      .send({
        gameData,
        playersData: new Array(31).fill({ name: 'Akif', team: 'Team A' }),
        imageUrl: 'stored/too-many.png',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/more than 30 players/i);

    const { rows } = await pgPool.query('SELECT id FROM games WHERE "squadId" = $1', [me.squad.id]);
    expect(rows).toHaveLength(0);
  });

  it('refuses an oversized team name', async () => {
    const me = await actor();

    const res = await request(app())
      .post('/api/screenshots/save')
      .set('Authorization', me.auth)
      .send({
        gameData: { ...gameData, homeTeam: 'A'.repeat(301) },
        playersData: [],
        imageUrl: 'stored/long-name.png',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/homeTeam/);
  });

  it('refuses a score that is not a number', async () => {
    const me = await actor();

    const res = await request(app())
      .post('/api/screenshots/save')
      .set('Authorization', me.auth)
      .send({
        gameData: { ...gameData, homeScore: 'lots' },
        playersData: [],
        imageUrl: 'stored/bad-score.png',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/homeScore/);
  });

  it('refuses an edit whose players field is truthy but not an array', async () => {
    // The presence check passes a non-empty string; only the schema catches the type.
    const me = await actor();
    const gameId = await seedGame(me.squad.id, me.user.id);

    const res = await request(app())
      .put(`/api/screenshots/games/${gameId}`)
      .set('Authorization', me.auth)
      .send({ ...gameData, date: '2026-07-18', players: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/players/);
  });
});
