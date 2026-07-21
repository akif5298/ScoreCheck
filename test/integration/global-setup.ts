/**
 * Jest `globalSetup` for the integration project — runs once, before any worker starts.
 *
 * Builds the template database: creates it if missing and brings it up to date with
 * `prisma migrate deploy`. Each worker then clones this template (see setup-db.ts).
 *
 * Building from the committed migrations — rather than a `pg_dump` of production, which
 * is what scripts/squad-integration-check.ts documents — means the harness needs no
 * production access and CI can provision an identical database from a bare postgres
 * service container.
 */
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { templateUrl, adminUrl, databaseNameOf } from './db-name';

export default async function globalSetup(): Promise<void> {
  const template = templateUrl();
  const templateName = databaseNameOf(template);

  const admin = new Client({ connectionString: adminUrl() });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      `[integration] cannot reach Postgres at ${new URL(template).host}. Start one with:\n` +
        `  docker run -d --rm --name sc-int -e POSTGRES_PASSWORD=int -p 55434:5432 postgres:17\n` +
        `Original error: ${(err as Error).message}`,
    );
  }

  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      templateName,
    ]);
    if (rowCount === 0) {
      await admin.query(`CREATE DATABASE "${templateName.replace(/"/g, '""')}"`);
    }

    // Drop stale per-worker clones from a previous run. CREATE DATABASE ... TEMPLATE
    // requires the template to have no other sessions connected, and a leftover clone
    // is also a stale schema waiting to produce a confusing failure.
    const { rows: stale } = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE $1`,
      [`${templateName}\\_w%`],
    );
    for (const { datname } of stale) {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [datname],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${datname.replace(/"/g, '""')}"`);
    }
  } finally {
    await admin.end();
  }

  // Idempotent: applies nothing once the template is current.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: template, DIRECT_DATABASE_URL: template },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
}
