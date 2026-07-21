/**
 * Jest `setupFilesAfterEnv` for the integration project — per-worker database
 * provisioning and per-test isolation.
 *
 * Every test starts from an empty database. TRUNCATE ... CASCADE is used rather than
 * per-test transactions with a rollback, because the code under test manages its own
 * transactions (and takes advisory locks inside them); wrapping it in an outer
 * transaction would change the very behaviour these suites exist to verify.
 */
import { Client } from 'pg';
import { pgPool } from '@/services/supabase';
import { templateUrl, workerUrl, adminUrl, databaseNameOf } from './db-name';

/**
 * Every application table. Listed explicitly rather than discovered from the catalog
 * so that a newly added table fails review here instead of silently going un-truncated
 * and leaking rows between tests.
 *
 * `_prisma_migrations` is deliberately excluded — wiping it would make every subsequent
 * `migrate deploy` replay the whole history.
 */
const TABLES = [
  'squad_audit_log',
  'game_edit_locks',
  'player_stats',
  'player_totals',
  'player_mappings',
  'players',
  'teams',
  'games',
  'squad_invites',
  'squad_members',
  'squads',
  'users',
] as const;

const TRUNCATE_SQL = `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`;

beforeAll(async () => {
  const worker = databaseNameOf(workerUrl());
  const template = databaseNameOf(templateUrl());

  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      worker,
    ]);
    if (rowCount === 0) {
      // Cloning a template copies its files directly — far cheaper than replaying
      // migrations once per worker.
      await admin.query(
        `CREATE DATABASE "${worker.replace(/"/g, '""')}" TEMPLATE "${template.replace(/"/g, '""')}"`,
      );
    }
  } finally {
    await admin.end();
  }
});

beforeEach(async () => {
  await pgPool.query(TRUNCATE_SQL);
});

afterAll(async () => {
  await pgPool.end();
});
