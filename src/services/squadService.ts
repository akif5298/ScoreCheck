/**
 * Squads: the ownership scope for all game data.
 *
 * Every user gets a personal squad (isPersonal = true) on signup, so "personal" is simply
 * a squad of one and every data query filters on a single key. Membership is resolved from
 * the database per request, never from the JWT — tokens last 7 days with no revocation, so
 * a removed member would otherwise keep access until their token expired.
 */

import { pgClient, pgPool, type Queryable } from './supabase';
import logger from '@/utils/logger';

export type SquadRole = 'OWNER' | 'MEMBER';

export interface Squad {
  id: string;
  name: string;
  isPersonal: boolean;
  createdByUserId: string;
}

export interface SquadMembership {
  squadId: string;
  userId: string;
  role: SquadRole;
}

export class SquadError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SquadError';
  }
}

/**
 * Creates a user's personal squad and their OWNER membership, and points
 * users.activeSquadId at it. Runs on the caller's client so signup can wrap the whole
 * account creation in one transaction.
 */
export async function createPersonalSquad(
  userId: string,
  db: Queryable = pgClient,
): Promise<Squad> {
  const result = await db.query<Squad>(
    `INSERT INTO squads (id, name, "isPersonal", "createdByUserId", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, 'Personal', true, $1, NOW(), NOW())
     RETURNING id, name, "isPersonal", "createdByUserId"`,
    [userId],
  );
  const squad = result.rows[0]!;

  await db.query(
    `INSERT INTO squad_members (id, "squadId", "userId", role, "joinedAt")
     VALUES (gen_random_uuid()::text, $1, $2, 'OWNER', NOW())`,
    [squad.id, userId],
  );
  await db.query(`UPDATE users SET "activeSquadId" = $1, "updatedAt" = NOW() WHERE id = $2`, [
    squad.id,
    userId,
  ]);

  return squad;
}

/** Creates a shared (non-personal) squad with the creator as OWNER. */
export async function createSquad(userId: string, name: string): Promise<Squad> {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<Squad>(
      `INSERT INTO squads (id, name, "isPersonal", "createdByUserId", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, false, $2, NOW(), NOW())
       RETURNING id, name, "isPersonal", "createdByUserId"`,
      [name, userId],
    );
    const squad = result.rows[0]!;
    await client.query(
      `INSERT INTO squad_members (id, "squadId", "userId", role, "joinedAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'OWNER', NOW())`,
      [squad.id, userId],
    );
    await client.query('COMMIT');
    return squad;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error({ err: rollbackErr }, 'Rollback failed after squad creation error');
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function getMembership(
  userId: string,
  squadId: string,
  db: Queryable = pgClient,
): Promise<SquadMembership | null> {
  const result = await db.query<SquadMembership>(
    `SELECT "squadId", "userId", role FROM squad_members WHERE "userId" = $1 AND "squadId" = $2`,
    [userId, squadId],
  );
  return result.rows[0] ?? null;
}

/** Throws 404 (not 403) for a squad the user isn't in — membership is not disclosed. */
export async function assertMember(
  userId: string,
  squadId: string,
  db: Queryable = pgClient,
): Promise<SquadMembership> {
  const membership = await getMembership(userId, squadId, db);
  if (!membership) {
    throw new SquadError(404, 'Squad not found');
  }
  return membership;
}

export async function assertOwner(
  userId: string,
  squadId: string,
  db: Queryable = pgClient,
): Promise<SquadMembership> {
  const membership = await assertMember(userId, squadId, db);
  if (membership.role !== 'OWNER') {
    throw new SquadError(403, 'Only the squad owner can do that');
  }
  return membership;
}

export async function listSquadsForUser(
  userId: string,
  db: Queryable = pgClient,
): Promise<Array<Squad & { role: SquadRole; memberCount: number }>> {
  const result = await db.query<Squad & { role: SquadRole; memberCount: number }>(
    `SELECT s.id, s.name, s."isPersonal", s."createdByUserId", sm.role,
            (SELECT COUNT(*)::int FROM squad_members m WHERE m."squadId" = s.id) AS "memberCount"
     FROM squads s
     JOIN squad_members sm ON sm."squadId" = s.id AND sm."userId" = $1
     ORDER BY s."isPersonal" DESC, s.name ASC`,
    [userId],
  );
  return result.rows;
}

/**
 * The squad a request should operate on.
 *
 * `requested` is the X-Squad-Id header when present; it is always validated against
 * membership so a header cannot be used to reach another squad's data. Falling back to
 * users.activeSquadId keeps a fresh session working before the client sends a header.
 * Self-heals if activeSquadId points somewhere the user is no longer a member of.
 */
export async function resolveSquadId(
  userId: string,
  requested?: string,
  db: Queryable = pgClient,
): Promise<string> {
  if (requested) {
    await assertMember(userId, requested, db);
    return requested;
  }

  const active = await db.query<{ activeSquadId: string | null }>(
    `SELECT "activeSquadId" FROM users WHERE id = $1`,
    [userId],
  );
  const activeSquadId = active.rows[0]?.activeSquadId ?? null;
  if (activeSquadId && (await getMembership(userId, activeSquadId, db))) {
    return activeSquadId;
  }

  // Stale or missing pointer (e.g. removed from that squad): fall back to the personal
  // squad, which every user always has, and repair the pointer.
  const personal = await db.query<{ id: string }>(
    `SELECT s.id FROM squads s
     JOIN squad_members sm ON sm."squadId" = s.id AND sm."userId" = $1
     WHERE s."isPersonal" = true
     ORDER BY s."createdAt" ASC
     LIMIT 1`,
    [userId],
  );
  const personalId = personal.rows[0]?.id;
  if (!personalId) {
    throw new SquadError(500, 'User has no personal squad');
  }
  await db.query(`UPDATE users SET "activeSquadId" = $1, "updatedAt" = NOW() WHERE id = $2`, [
    personalId,
    userId,
  ]);
  return personalId;
}

export async function setActiveSquad(userId: string, squadId: string): Promise<void> {
  await assertMember(userId, squadId);
  await pgClient.query(`UPDATE users SET "activeSquadId" = $1, "updatedAt" = NOW() WHERE id = $2`, [
    squadId,
    userId,
  ]);
}
