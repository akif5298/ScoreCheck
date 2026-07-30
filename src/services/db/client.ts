/**
 * Shared connections and cross-cutting types for the database layer.
 *
 * Everything here is module-scope state that must be created exactly once: the pg pool,
 * the two Supabase clients, and the types/errors the domain modules pass between them.
 *
 * ORDERING IS LOAD-BEARING. `dotenv.config()` runs before the env vars are read, and the
 * pool is constructed at module scope from `process.env.DATABASE_URL`. Integration tests
 * depend on this: `test/integration/setup-env.ts` runs as a Jest `setupFiles` entry —
 * before any test module is imported — specifically so DATABASE_URL is already this
 * worker's database by the time anything pulls this module in. Do not move the pool
 * construction behind a function or a lazy getter without re-reading that file.
 */
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/supabase';
import dotenv from 'dotenv';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import logger from '@/utils/logger';

// Minimal shape shared by pg.Pool and a checked-out pg.PoolClient, so CRUD
// helpers can run either on the pool (default) or inside a transaction's
// dedicated client when one is passed in.
export interface Queryable {
  query<R extends QueryResultRow = any>(
    text: string,
    values?: any[],
  ): Promise<QueryResult<R>>;
}

// Raised when a save is aborted because the squad already holds a perceptually
// identical screenshot. Carries the winning game's id so the caller can return it
// instead of an error — from the user's point of view the game is present, which is
// what they wanted. Distinguishable from a genuine failure by `instanceof`, so the
// route does not report a 500 for what is a successful no-op.
export class DuplicateGameError extends Error {
  constructor(public readonly existingGameId: string) {
    super(`Game already exists in this squad (${existingGameId})`);
    this.name = 'DuplicateGameError';
  }
}

// Arbitrary but fixed first key for squad-save advisory locks. Two-key form so these
// locks share no space with any other advisory lock added later.
//
// Exported because moving games between squads runs the same duplicate check against the
// target squad and must serialise against concurrent saves into it. Both paths have to
// take the lock in the SAME namespace or they would not exclude each other at all.
export const SQUAD_SAVE_LOCK_NAMESPACE = 0x5343;

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
// Support both old and new key names for backward compatibility
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY!;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey);

// Create a service role client for admin operations (bypasses RLS)
export const supabaseServiceRole = createClient<Database>(supabaseUrl, supabaseSecretKey);

// Connection pool for all database operations. A pool (vs a single Client)
// survives dropped connections and serves concurrent requests without
// serializing them on one socket. Transactions check out a dedicated client
// via pgPool.connect(); everything else uses pgPool.query() directly.
export const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.PG_POOL_MAX || '10', 10),
});

// Surface background pool errors (e.g. a backend terminating an idle client)
// instead of crashing the process.
pgPool.on('error', (err) => logger.error({ err }, 'Unexpected PostgreSQL pool error'));
