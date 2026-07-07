/**
 * Seeds known gamertag→displayName mappings for the dev demo user.
 * Run after logging in once in dev mode to create the demo user.
 *
 * Usage (from project root):
 *   npm run seed:mappings
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { Client } from 'pg';

const SEED_MAPPINGS = [
  // From visionService.ts nameMappings + ground_truth.json gamertags
  { gamertag: 'GRIM_AR15',       displayName: 'Akif' },
  { gamertag: 'GRIM_BuLLeTzZz', displayName: 'Nillan' },
  { gamertag: 'Anis_Rahman13',   displayName: 'Anis' },
  { gamertag: 'electrox04',      displayName: 'Abdul' },
  { gamertag: 'xjsi',            displayName: 'Ikroop' },
  { gamertag: 'xjsi---',         displayName: 'Ikroop' },
  { gamertag: 'anxrchyy',        displayName: 'Ankit' },
  { gamertag: 'chaozgamer',      displayName: 'TV' },
];

const DEMO_USER_EMAIL = 'dev.user@scorecheck.com';

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const userResult = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1 LIMIT 1`,
    [DEMO_USER_EMAIL],
  );

  if (userResult.rows.length === 0) {
    console.log(`No demo user found with email: ${DEMO_USER_EMAIL}`);
    console.log('Log in once via the frontend in dev mode (POST /api/auth/apple with mock token) to create the user, then re-run this script.');
    await client.end();
    return;
  }

  const userId = userResult.rows[0]!.id;
  console.log(`Seeding mappings for userId=${userId} (${DEMO_USER_EMAIL})`);

  for (const { gamertag, displayName } of SEED_MAPPINGS) {
    await client.query(
      `INSERT INTO player_mappings (id, "userId", gamertag, "displayName", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, NOW(), NOW())
       ON CONFLICT ("userId", gamertag) DO UPDATE
         SET "displayName" = EXCLUDED."displayName", "updatedAt" = NOW()`,
      [userId, gamertag, displayName],
    );
    console.log(`  ${gamertag.padEnd(20)} → ${displayName}`);
  }

  await client.end();
  console.log('Done.');
}

main().catch(err => {
  console.error('Seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
