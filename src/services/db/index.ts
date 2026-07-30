/**
 * The database facade.
 *
 * `SupabaseService` is assembled from the domain modules by composition:
 *
 *   client → StorageService → UsersService → AggregatesService → GamesService → SupabaseService
 *
 * The result is one class with one `this`, identical in behaviour to the single 1,239-line
 * class this replaced. That equivalence is the point of the split, and it is why the chain
 * is `extends` rather than a set of independently imported function modules: methods call
 * each other through `this`, so a `jest.spyOn(supabaseService, 'getGameById')` still
 * intercepts updateGame's internal call, exactly as before.
 *
 * Every consumer imports from '@/services/supabase', which re-exports this module. Nothing
 * outside src/services/db should reach in here directly.
 */
import { GamesService } from './games';

export { pgPool, supabase, DuplicateGameError, SQUAD_SAVE_LOCK_NAMESPACE } from './client';
export type { Queryable } from './client';

export class SupabaseService extends GamesService {}

export default new SupabaseService();
