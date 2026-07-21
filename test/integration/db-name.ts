/**
 * Resolves the connection URLs for the integration harness.
 *
 * Jest parallelises across worker processes, and every integration test TRUNCATEs the
 * whole schema in `beforeEach`. Sharing one database across workers would therefore have
 * them wipe each other's fixtures mid-test. Rather than forcing the entire run serial
 * (which would also slow the unit project, since `maxWorkers` is a global option), each
 * worker gets its own database cloned from a migrated template — Postgres copies a
 * template database by cloning its files, so this is close to free.
 */

const DEFAULT_BASE = 'postgresql://postgres:int@localhost:55434/scorecheck_test';

/** The migrated template every worker database is cloned from. */
export function templateUrl(): string {
  return process.env.TEST_DATABASE_URL || DEFAULT_BASE;
}

/** The database this worker owns, e.g. scorecheck_test_w2. */
export function workerUrl(): string {
  const url = new URL(templateUrl());
  const worker = process.env.JEST_WORKER_ID || '1';
  url.pathname = `${url.pathname}_w${worker}`;
  return url.toString();
}

/** The maintenance database, used for CREATE DATABASE. */
export function adminUrl(): string {
  const url = new URL(templateUrl());
  url.pathname = '/postgres';
  return url.toString();
}

export function databaseNameOf(connectionString: string): string {
  return new URL(connectionString).pathname.replace(/^\//, '');
}
