/**
 * Fixture builders for the integration suites.
 *
 * These insert directly with SQL rather than going through the services, so a test
 * asserting on `createSquad` is not also depending on `signup` being correct. A broken
 * service then fails only the tests that target it, instead of cascading into every
 * suite that happened to need a user.
 */
import { randomUUID } from 'node:crypto';
import { pgPool } from '@/services/supabase';

export interface TestUser {
  id: string;
  email: string;
}

let seq = 0;

/** Inserts a user row. `activeSquadId` is left null — squad helpers set it. */
export async function makeUser(overrides: Partial<TestUser> = {}): Promise<TestUser> {
  const id = overrides.id ?? randomUUID();
  const email = overrides.email ?? `user${(seq += 1)}-${id.slice(0, 8)}@test.local`;

  await pgPool.query(
    `INSERT INTO users (id, email, name, role, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'USER', NOW(), NOW())`,
    [id, email, `Test ${seq}`],
  );

  return { id, email };
}

/** Inserts a player_mappings row for a squad's roster. */
export async function makeMapping(
  squadId: string,
  gamertag: string,
  displayName = gamertag,
): Promise<string> {
  const id = randomUUID();
  await pgPool.query(
    `INSERT INTO player_mappings (id, "squadId", gamertag, "displayName", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [id, squadId, gamertag, displayName],
  );
  return id;
}

/** Reads a user's activeSquadId — used to assert the signup/switch side effects. */
export async function getActiveSquadId(userId: string): Promise<string | null> {
  const { rows } = await pgPool.query<{ activeSquadId: string | null }>(
    'SELECT "activeSquadId" FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]?.activeSquadId ?? null;
}

/** Inserts a squad + OWNER membership directly, without going through squadService. */
export async function makeSquad(
  createdByUserId: string,
  opts: { name?: string; isPersonal?: boolean } = {},
): Promise<{ id: string; name: string }> {
  const id = randomUUID();
  const name = opts.name ?? `Squad-${id.slice(0, 6)}`;
  await pgPool.query(
    `INSERT INTO squads (id, name, "isPersonal", "createdByUserId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [id, name, opts.isPersonal ?? false, createdByUserId],
  );
  await pgPool.query(
    `INSERT INTO squad_members (id, "squadId", "userId", role, "joinedAt")
     VALUES (gen_random_uuid()::text, $1, $2, 'OWNER', NOW())`,
    [id, createdByUserId],
  );
  return { id, name };
}

/**
 * A player payload shaped the way saveGameWithStats/updateGame expect.
 *
 * `position`, `playerId` and `gameIdFromFile` are always supplied because all three are
 * NOT NULL with no default. SupabaseService.createPlayer passes `x || null` for each,
 * so omitting them does not fall back to a default — it raises a constraint violation.
 */
export function playerPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Akif',
    team: 'Team A',
    position: 'PG',
    playerId: 'p-1',
    gameIdFromFile: '0001',
    points: 10,
    rebounds: 5,
    assists: 3,
    steals: 1,
    blocks: 1,
    fouls: 2,
    turnovers: 2,
    fgMade: 4,
    fgAttempted: 8,
    threeMade: 1,
    threeAttempted: 3,
    ftMade: 1,
    ftAttempted: 2,
    ...over,
  };
}

/** Counts rows in a table, optionally scoped to a squad. */
export async function countRows(table: string, squadId?: string): Promise<number> {
  const { rows } = squadId
    ? await pgPool.query<{ n: string }>(
        `SELECT COUNT(*) n FROM "${table}" WHERE "squadId" = $1`,
        [squadId],
      )
    : await pgPool.query<{ n: string }>(`SELECT COUNT(*) n FROM "${table}"`);
  return Number(rows[0]?.n ?? 0);
}
