/**
 * Public entry point for the database layer.
 *
 * The implementation was split into src/services/db/ (client, storage, users, aggregates,
 * games) once this file reached 1,239 lines. This module stays as the single import path
 * so that split was invisible to callers: ~40 call sites across routes/ and services/, and
 * every `jest.mock('@/services/supabase')` in the test suite, continue to resolve here.
 *
 * Import from '@/services/supabase', not from '@/services/db/...'. Reaching past this file
 * would re-scatter the coupling the split just consolidated.
 *
 * Note for anyone moving this: `pgPool` is still constructed at module scope (in db/client.ts)
 * and `test/integration/setup-env.ts` runs as a Jest `setupFiles` entry because of it. The
 * pool must not become lazy without re-reading that file.
 */
export {
  pgPool,
  supabase,
  DuplicateGameError,
  SQUAD_SAVE_LOCK_NAMESPACE,
  SupabaseService,
} from './db';
export type { Queryable } from './db';

export { default } from './db';
