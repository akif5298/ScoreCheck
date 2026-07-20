/**
 * Verifies the save-time duplicate check inside SupabaseService.saveGameWithStats.
 *
 * The upload route already rejects duplicates, but that check runs ~22s before the row is
 * written. Two squad members uploading the same screenshot at once both pass it — neither
 * game exists yet — and both reach the save. This suite pins the transaction-level fix:
 * an advisory lock that serialises saves within a squad, plus a re-check against committed
 * rows while that lock is held.
 *
 * Like supabase.errors.test.ts, this mocks `pg` rather than the service, because every
 * route suite mocks '@/services/supabase' wholesale and would never execute these lines.
 */

// Set before importing the service: it constructs Supabase clients at module load.
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = 'test-secret-key';

jest.mock('pg', () => {
  const mockClientQuery = jest.fn();
  const mockRelease = jest.fn();
  const mockConnect = jest.fn().mockResolvedValue({
    query: mockClientQuery,
    release: mockRelease,
  });
  return {
    Pool: jest.fn().mockImplementation(() => ({
      query: jest.fn(),
      on: jest.fn(),
      connect: mockConnect,
    })),
    __mockClientQuery: mockClientQuery,
    __mockRelease: mockRelease,
  };
});

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ storage: { from: jest.fn() } })),
}));

import supabaseService, { DuplicateGameError } from '@/services/supabase';
import { hammingDistance, DUPLICATE_HAMMING_THRESHOLD } from '@/utils/imageHash';

const { __mockClientQuery: clientQuery, __mockRelease: release } = jest.requireMock('pg') as {
  __mockClientQuery: jest.Mock;
  __mockRelease: jest.Mock;
};

// 60-char hex, matching the dhash format actually stored (verified: every production row
// is length 60). Distances from BASE are exact, so these also pin the threshold itself.
const BASE = '00'.repeat(30);
const THREE_BITS_OFF = '07' + '00'.repeat(29); // distance 3  — inside the threshold
const EXACTLY_AT_THRESHOLD = 'ff' + '03' + '00'.repeat(28); // distance 10 — inside
const ONE_BIT_OVER = 'ff' + '07' + '00'.repeat(28); // distance 11 — outside
const TOTALLY_DIFFERENT = 'ff'.repeat(30); // distance 240 — a genuinely different game

const SQUAD = 'squad-1';

/** Routes each SQL statement the transaction issues to a canned result. */
function primeClient(existingHashRows: Array<{ id: string; imageHash: string }>) {
  clientQuery.mockReset();
  clientQuery.mockImplementation(async (sql: string) => {
    if (/pg_advisory_xact_lock/.test(sql)) return { rows: [{}], rowCount: 1 };
    if (/SELECT id, "imageHash" FROM games/.test(sql)) {
      return { rows: existingHashRows, rowCount: existingHashRows.length };
    }
    if (/INSERT INTO games/.test(sql)) return { rows: [{ id: 'new-game' }], rowCount: 1 };
    if (/INSERT INTO players/.test(sql)) return { rows: [{ id: 'new-player' }], rowCount: 1 };
    if (/INSERT INTO teams/.test(sql)) return { rows: [{ id: 'new-team' }], rowCount: 1 };
    return { rows: [], rowCount: 0 }; // BEGIN / COMMIT / ROLLBACK
  });
}

const gameData = (imageHash: string | null) => ({
  id: 'game-new',
  date: '2026-07-20',
  homeTeam: 'Team A',
  awayTeam: 'Team B',
  homeScore: 95,
  awayScore: 87,
  screenshotUrl: 'path/to.jpg',
  imageHash,
  processed: true,
  squadId: SQUAD,
  uploadedByUserId: 'user-1',
});

const save = (imageHash: string | null) =>
  supabaseService.saveGameWithStats(gameData(imageHash), [{ name: 'Akif' }], {}, {});

/** SQL statements issued on the transaction's client, in order. */
const issued = () => clientQuery.mock.calls.map(c => String(c[0]));

beforeEach(() => {
  release.mockReset();
});

describe('saveGameWithStats — save-time duplicate detection', () => {
  describe('the advisory lock', () => {
    it('is taken before the duplicate check reads any rows', async () => {
      // The whole point of the lock. If the check ran first, two concurrent saves could
      // both read "no duplicate" and both insert — exactly the race being closed.
      primeClient([]);
      await save(BASE);

      const sql = issued();
      const lockAt = sql.findIndex(s => /pg_advisory_xact_lock/.test(s));
      const checkAt = sql.findIndex(s => /SELECT id, "imageHash" FROM games/.test(s));

      expect(lockAt).toBeGreaterThanOrEqual(0);
      expect(checkAt).toBeGreaterThan(lockAt);
    });

    it('is taken inside the transaction, so COMMIT/ROLLBACK releases it', async () => {
      // pg_advisory_xact_lock (not the session variant) is what makes stranding impossible.
      primeClient([]);
      await save(BASE);

      const sql = issued();
      expect(sql[0]).toBe('BEGIN');
      expect(sql[1]).toMatch(/pg_advisory_xact_lock/);
      expect(sql.some(s => /pg_advisory_lock\b/.test(s))).toBe(false);
    });

    it('is keyed on the squad, not the game or the user', async () => {
      primeClient([]);
      await save(BASE);

      const lockCall = clientQuery.mock.calls.find(c => /pg_advisory_xact_lock/.test(String(c[0])));
      expect(lockCall![1]).toEqual([expect.any(Number), SQUAD]);
    });
  });

  describe('when the squad already holds a matching screenshot', () => {
    it('throws DuplicateGameError carrying the winning game id', async () => {
      primeClient([{ id: 'game-winner', imageHash: THREE_BITS_OFF }]);

      await expect(save(BASE)).rejects.toBeInstanceOf(DuplicateGameError);
      await expect(save(BASE)).rejects.toMatchObject({ existingGameId: 'game-winner' });
    });

    it('rolls back and never inserts the losing game', async () => {
      primeClient([{ id: 'game-winner', imageHash: THREE_BITS_OFF }]);

      await expect(save(BASE)).rejects.toThrow(DuplicateGameError);

      const sql = issued();
      expect(sql.some(s => /INSERT INTO games/.test(s))).toBe(false);
      expect(sql.some(s => /INSERT INTO players/.test(s))).toBe(false);
      expect(sql).toContain('ROLLBACK');
      expect(sql).not.toContain('COMMIT');
    });

    it('releases the pooled client', async () => {
      // A leaked client on the duplicate path would exhaust the pool under the very
      // concurrency this check exists to handle.
      primeClient([{ id: 'game-winner', imageHash: THREE_BITS_OFF }]);

      await expect(save(BASE)).rejects.toThrow(DuplicateGameError);
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('matches at exactly the threshold and not one bit beyond', async () => {
      // Guards the boundary in both directions, so a change to the constant is a
      // deliberate act rather than a silent drift.
      expect(hammingDistance(BASE, EXACTLY_AT_THRESHOLD)).toBe(DUPLICATE_HAMMING_THRESHOLD);
      expect(hammingDistance(BASE, ONE_BIT_OVER)).toBe(DUPLICATE_HAMMING_THRESHOLD + 1);

      primeClient([{ id: 'game-at-limit', imageHash: EXACTLY_AT_THRESHOLD }]);
      await expect(save(BASE)).rejects.toThrow(DuplicateGameError);

      primeClient([{ id: 'game-past-limit', imageHash: ONE_BIT_OVER }]);
      await expect(save(BASE)).resolves.toBeDefined();
    });
  });

  describe('when there is no match', () => {
    it('commits a genuinely different game', async () => {
      primeClient([{ id: 'other-game', imageHash: TOTALLY_DIFFERENT }]);

      const result = await save(BASE);

      expect(result.game).toEqual({ id: 'new-game' });
      expect(issued()).toContain('COMMIT');
    });

    it('commits when the squad has no hashed games at all', async () => {
      primeClient([]);

      await expect(save(BASE)).resolves.toBeDefined();
      expect(issued()).toContain('COMMIT');
    });

    it('skips the row read entirely when the game has no hash', async () => {
      // A game saved without going through the upload route has nothing to compare.
      // It still takes the lock (cheap, and keeps the ordering invariant simple).
      primeClient([{ id: 'other-game', imageHash: TOTALLY_DIFFERENT }]);

      await expect(save(null)).resolves.toBeDefined();

      const sql = issued();
      expect(sql.some(s => /pg_advisory_xact_lock/.test(s))).toBe(true);
      expect(sql.some(s => /SELECT id, "imageHash" FROM games/.test(s))).toBe(false);
      expect(sql).toContain('COMMIT');
    });

    it('treats a stored hash of unexpected length as no match instead of throwing', async () => {
      // hammingDistance throws on a length mismatch. Every production row is 60 chars, but
      // a stray legacy value must not turn a save into a 500.
      primeClient([{ id: 'legacy', imageHash: 'abcd' }]);

      await expect(save(BASE)).resolves.toBeDefined();
      expect(issued()).toContain('COMMIT');
    });
  });

  it('scopes the duplicate check to the saving squad', async () => {
    // Cross-squad separation is the core guarantee of the squad model: another group
    // having the same screenshot must not block this squad's save.
    primeClient([]);
    await save(BASE);

    const checkCall = clientQuery.mock.calls.find(c =>
      /SELECT id, "imageHash" FROM games/.test(String(c[0])),
    );
    expect(String(checkCall![0])).toMatch(/"squadId" = \$1/);
    expect(checkCall![1]).toEqual([SQUAD]);
  });
});
