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
    console.log(`Sign up once with that email (POST /api/auth/signup, or the login page in dev) to create the user, then re-run this script.`);
    await client.end();
    return;
  }

  const userId = userResult.rows[0]!.id;

  // Mappings are owned by a squad, not a user. Resolve the same way the request path does
  // (see resolveSquadId in src/services/squadService.ts): the user's active squad when it
  // is one they actually belong to, otherwise their personal squad, which every account
  // gets at signup. Inlined as SQL rather than imported, to keep this script standalone —
  // importing the service would pull in supabase.ts, which builds a pg Pool and a Supabase
  // storage client at module scope and would fail here for reasons unrelated to seeding.
  const squadResult = await client.query<{ squadId: string | null }>(
    `SELECT COALESCE(
              (SELECT s.id FROM squads s
                 JOIN squad_members sm ON sm."squadId" = s.id AND sm."userId" = u.id
                WHERE s.id = u."activeSquadId"),
              (SELECT s.id FROM squads s
                 JOIN squad_members sm ON sm."squadId" = s.id AND sm."userId" = u.id
                WHERE s."isPersonal" = true
                ORDER BY s."createdAt" ASC
                LIMIT 1)
            ) AS "squadId"
       FROM users u
      WHERE u.id = $1`,
    [userId],
  );

  const squadId = squadResult.rows[0]?.squadId ?? null;
  if (!squadId) {
    console.log(`Demo user ${DEMO_USER_EMAIL} belongs to no squad — cannot seed mappings.`);
    console.log('Signup creates a personal squad automatically; this user predates that or was created by hand.');
    await client.end();
    process.exitCode = 1;
    return;
  }

  console.log(`Seeding mappings for squadId=${squadId} (user ${DEMO_USER_EMAIL})`);

  for (const { gamertag, displayName } of SEED_MAPPINGS) {
    await client.query(
      `INSERT INTO player_mappings (id, "squadId", gamertag, "displayName", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, NOW(), NOW())
       ON CONFLICT ("squadId", gamertag) DO UPDATE
         SET "displayName" = EXCLUDED."displayName", "updatedAt" = NOW()`,
      [squadId, gamertag, displayName],
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
