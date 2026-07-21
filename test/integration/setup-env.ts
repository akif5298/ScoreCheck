/**
 * Runs as a Jest `setupFiles` entry — BEFORE any test module is imported.
 *
 * This ordering is load-bearing: `src/services/supabase.ts` constructs its `pg.Pool`
 * from `process.env.DATABASE_URL` at module scope, so the value must already be this
 * worker's database by the time anything imports it. `dotenv.config()` (called inside
 * that module) does not overwrite variables that are already set, so assigning here
 * wins over the production URL sitting in `.env`.
 */
import { workerUrl, databaseNameOf } from './db-name';

const url = workerUrl();

/**
 * Refuse to run against anything that is not obviously a throwaway database.
 *
 * The integration suites TRUNCATE every application table between tests. If a
 * misconfigured environment ever pointed them at production, the first `beforeEach`
 * would destroy the real data with no error and no undo. A missing or wrong env var
 * must fail the run loudly rather than fall through to whatever `.env` holds, so this
 * check is unconditional and has no escape hatch.
 */
function assertDisposable(connectionString: string): void {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error(`[integration] TEST_DATABASE_URL is not a valid URL: ${connectionString}`);
  }

  const host = parsed.hostname;
  const database = databaseNameOf(connectionString);

  const localHosts = ['localhost', '127.0.0.1', '::1', 'postgres', 'db'];
  if (!localHosts.includes(host)) {
    throw new Error(
      `[integration] refusing to run: host "${host}" is not local. ` +
        `Integration tests TRUNCATE tables and must never touch a remote database.`,
    );
  }

  if (!/test/i.test(database)) {
    throw new Error(
      `[integration] refusing to run: database "${database}" does not contain "test". ` +
        `Integration tests TRUNCATE tables; name the database explicitly, e.g. scorecheck_test.`,
    );
  }
}

assertDisposable(url);

process.env.DATABASE_URL = url;
process.env.DIRECT_DATABASE_URL = url;

// `supabase.ts` builds Supabase clients at module scope and throws on a missing URL.
// Integration tests never reach Storage, so unroutable placeholders are enough — and
// they guarantee an accidental network call fails fast instead of hitting a real bucket.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:1';
process.env.SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// Long enough to satisfy the 32-char minimum in src/config/env.ts.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters-long';
process.env.NODE_ENV = 'test';
