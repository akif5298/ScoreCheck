/**
 * Verifies SupabaseService read helpers PROPAGATE database errors rather than
 * reporting them as "no data".
 *
 * These helpers used to catch and return null/[]/0 on failure, which made callers take
 * their not-found branch and write incorrect rows:
 *   - getGameByScreenshotUrl → null read as "not a duplicate" → duplicate game saved.
 *   - getPlayerTotalsByPlayerName → null read as "no totals yet" → fresh totals row INSERTed
 *     over a player's real cumulative history.
 *
 * Every other suite mocks '@/services/supabase' wholesale, so these code paths are
 * otherwise never executed by the test suite.
 */

// Set before importing the service: it constructs Supabase clients at module load.
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = 'test-secret-key';

jest.mock('pg', () => {
  const mockQuery = jest.fn();
  return {
    Pool: jest.fn().mockImplementation(() => ({
      query: mockQuery,
      on: jest.fn(),
      connect: jest.fn(),
    })),
    __mockQuery: mockQuery,
  };
});

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ storage: { from: jest.fn() } })),
}));

import supabaseService from '@/services/supabase';

const { __mockQuery: mockQuery } = jest.requireMock('pg') as { __mockQuery: jest.Mock };

describe('SupabaseService read helpers — DB error propagation', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockRejectedValue(new Error('DB down'));
  });

  const cases: Array<[string, () => Promise<unknown>]> = [
    ['getGameByScreenshotUrl', () => supabaseService.getGameByScreenshotUrl('object/path.jpg', 'u1')],
    ['getPlayerTotalsByPlayerName', () => supabaseService.getPlayerTotalsByPlayerName('Akif', 'u1')],
    ['getPlayerStatsByPlayerName', () => supabaseService.getPlayerStatsByPlayerName('Akif', 'u1')],
    ['getGameById', () => supabaseService.getGameById('game-1', 'u1')],
    ['getGamesBySquadId', () => supabaseService.getGamesBySquadId('u1')],
    ['getPlayerStats', () => supabaseService.getPlayerStats('u1')],
    ['getPlayerTotalsBySquadId', () => supabaseService.getPlayerTotalsBySquadId('u1')],
    ['getDistinctPlayerCount', () => supabaseService.getDistinctPlayerCount('u1')],
  ];

  it.each(cases)('%s rejects rather than masking the failure as empty', async (_name, call) => {
    await expect(call()).rejects.toThrow('DB down');
  });

  it('still reports a genuine miss as absence, not an error', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    await expect(supabaseService.getGameByScreenshotUrl('missing.jpg', 'u1')).resolves.toBeNull();
    await expect(supabaseService.getPlayerTotalsByPlayerName('Nobody', 'u1')).resolves.toBeNull();
    await expect(supabaseService.getGamesBySquadId('u1')).resolves.toEqual([]);
  });
});
