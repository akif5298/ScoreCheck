/**
 * Contract tests for the '@/services/supabase' module boundary itself, rather than for any
 * one query.
 *
 * Two things are pinned here, both of which the db/ split made easy to break silently:
 *
 *   1. The public export surface. ~40 call sites across routes/ and services/ import these
 *      by name from this exact path, and `DuplicateGameError` is caught by `instanceof` in
 *      routes/screenshots.ts. The implementation now lives behind two re-export hops
 *      (supabase.ts → db/index.ts → db/client.ts), so dropping a symbol from either barrel
 *      would compile fine here and fail at the call site.
 *
 *   2. The pool's background error handler. pg emits 'error' on the Pool when a backend
 *      terminates an idle client. An EventEmitter with no 'error' listener THROWS, which on
 *      an async event means an uncaught exception and a dead process — so the listener is
 *      what keeps a dropped connection from taking the server down.
 */

// Set before importing the service: it constructs Supabase clients at module load.
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = 'test-secret-key';

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import supabaseService, {
  pgPool,
  supabase,
  DuplicateGameError,
  SQUAD_SAVE_LOCK_NAMESPACE,
  SupabaseService,
} from '@/services/supabase';
import logger from '@/utils/logger';

describe('@/services/supabase public surface', () => {
  it('exports the symbols the rest of the app imports by name', () => {
    expect(typeof supabase).toBe('object');
    expect(pgPool).toBeDefined();
    expect(typeof SQUAD_SAVE_LOCK_NAMESPACE).toBe('number');
    expect(typeof SupabaseService).toBe('function');
  });

  it('default-exports a service instance carrying the whole method surface', () => {
    // One method from each domain module, so a barrel that forgot to compose one of them
    // fails here rather than at a call site.
    for (const method of [
      'uploadImage', // storage
      'findUserById', // users
      'recomputeSquadAggregates', // aggregates
      'saveGameWithStats', // games
      'getGameById', // games
    ]) {
      expect(typeof (supabaseService as unknown as Record<string, unknown>)[method]).toBe(
        'function',
      );
    }
    expect(supabaseService).toBeInstanceOf(SupabaseService);
  });

  it('keeps DuplicateGameError identifiable by instanceof and carrying the winning id', () => {
    // routes/screenshots.ts branches on `instanceof DuplicateGameError` to answer 200 with
    // the existing game instead of 500. A second copy of the class behind the re-export
    // would break that branch while every type still checked out.
    const err = new DuplicateGameError('game-winner');

    expect(err).toBeInstanceOf(DuplicateGameError);
    expect(err).toBeInstanceOf(Error);
    expect(err.existingGameId).toBe('game-winner');
    expect(err.name).toBe('DuplicateGameError');
  });
});

describe('pgPool background error handling', () => {
  it('logs a pool error rather than letting it become an uncaught exception', () => {
    const err = new Error('terminating connection due to administrator command');

    // Would throw here if no 'error' listener were registered — that is the regression
    // this guards against, not the log line itself.
    expect(() => pgPool.emit('error', err)).not.toThrow();

    expect(logger.error).toHaveBeenCalledWith({ err }, 'Unexpected PostgreSQL pool error');
  });
});
