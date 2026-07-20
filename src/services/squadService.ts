/**
 * Squads: the ownership scope for all game data.
 *
 * Every user gets a personal squad (isPersonal = true) on signup, so "personal" is simply
 * a squad of one and every data query filters on a single key. Membership is resolved from
 * the database per request, never from the JWT — tokens last 7 days with no revocation, so
 * a removed member would otherwise keep access until their token expired.
 */

import { randomBytes } from 'node:crypto';
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

/**
 * Copies the user's personal roster into a squad whose own roster is empty.
 *
 * Without this a newly created squad recognises nobody, so games moved into it show raw
 * gamertags and accrue no stats until every mapping is re-entered by hand — which is
 * exactly the bootstrap path, so the empty case is the common one rather than the edge.
 *
 * Guarded on a genuinely empty roster so it can never disturb an established squad, and
 * ON CONFLICT DO NOTHING so a concurrent seed cannot turn squad creation into an error.
 * linkedUserId is deliberately not copied: the identity link is per-squad and is claimed
 * through the identify step, not inherited.
 */
export async function seedRosterFromPersonal(
  userId: string,
  squadId: string,
  db: Queryable = pgClient,
): Promise<number> {
  const { rows: existing } = await db.query<{ n: string }>(
    'SELECT COUNT(*) n FROM player_mappings WHERE "squadId" = $1',
    [squadId],
  );
  if (Number(existing[0]?.n ?? 0) > 0) return 0;

  const result = await db.query(
    `INSERT INTO player_mappings (id, "squadId", gamertag, "displayName", "createdAt", "updatedAt")
     SELECT gen_random_uuid()::text, $1, pm.gamertag, pm."displayName", NOW(), NOW()
     FROM player_mappings pm
     JOIN squads s ON s.id = pm."squadId"
     WHERE s."createdByUserId" = $2 AND s."isPersonal" = true
     ON CONFLICT DO NOTHING`,
    [squadId, userId],
  );

  return result.rowCount ?? 0;
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
    await seedRosterFromPersonal(userId, squad.id, client);
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

// ── Members ──────────────────────────────────────────────────────────────────────

export interface SquadMemberDetail {
  userId: string;
  name: string | null;
  email: string;
  role: SquadRole;
  joinedAt: Date;
  /** Roster entry this member has claimed as themselves, if any (the identify step). */
  displayName: string | null;
  gamertag: string | null;
  /** Games in this squad uploaded by this member. Drives the leave/remove warning later. */
  uploadedGames: number;
}

/** The roster + who's in it. Any member may see who else is in their own squad. */
export async function listMembers(
  userId: string,
  squadId: string,
  db: Queryable = pgClient,
): Promise<SquadMemberDetail[]> {
  await assertMember(userId, squadId, db);
  const result = await db.query<SquadMemberDetail>(
    `SELECT sm."userId", u.name, u.email, sm.role, sm."joinedAt",
            pm."displayName", pm.gamertag,
            (SELECT COUNT(*)::int FROM games g
              WHERE g."squadId" = sm."squadId" AND g."uploadedByUserId" = sm."userId")
              AS "uploadedGames"
     FROM squad_members sm
     JOIN users u ON u.id = sm."userId"
     LEFT JOIN player_mappings pm
       ON pm."squadId" = sm."squadId" AND pm."linkedUserId" = sm."userId"
     WHERE sm."squadId" = $1
     ORDER BY sm.role ASC, sm."joinedAt" ASC`,
    [squadId],
  );
  return result.rows;
}

// ── Invites ──────────────────────────────────────────────────────────────────────

export interface SquadInvite {
  id: string;
  squadId: string;
  token: string;
  role: SquadRole;
  expiresAt: Date;
  maxUses: number;
  usedCount: number;
  revokedAt: Date | null;
  createdAt: Date;
}

/** What a logged-out visitor may see before deciding to sign up. Deliberately minimal. */
export interface InvitePreview {
  squadId: string;
  squadName: string;
  invitedByName: string | null;
  memberCount: number;
  gameCount: number;
}

const DEFAULT_INVITE_TTL_DAYS = 7;
const MAX_INVITE_TTL_DAYS = 30;

/**
 * Creates a reusable invite link. OWNER only.
 *
 * `maxUses: 0` means unlimited until expiry or revocation — the common case, since the
 * point is to drop one link into a group chat.
 */
export async function createInvite(
  userId: string,
  squadId: string,
  options: { expiresInDays?: number; maxUses?: number } = {},
): Promise<SquadInvite> {
  const squad = await assertOwner(userId, squadId);
  void squad;

  const personal = await pgClient.query<{ isPersonal: boolean }>(
    `SELECT "isPersonal" FROM squads WHERE id = $1`,
    [squadId],
  );
  if (personal.rows[0]?.isPersonal) {
    // A personal squad is the user's private scope; letting someone in would silently turn
    // their whole history into shared data. Making a shared squad is the explicit path.
    throw new SquadError(400, 'A personal squad cannot be shared — create a squad instead');
  }

  const ttl = options.expiresInDays ?? DEFAULT_INVITE_TTL_DAYS;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_INVITE_TTL_DAYS) {
    throw new SquadError(400, `expiresInDays must be a whole number between 1 and ${MAX_INVITE_TTL_DAYS}`);
  }
  const maxUses = options.maxUses ?? 0;
  if (!Number.isInteger(maxUses) || maxUses < 0) {
    throw new SquadError(400, 'maxUses must be 0 (unlimited) or a positive whole number');
  }

  // 192 bits of entropy, URL-safe. Guessing is infeasible, which is what lets the preview
  // endpoint stay unauthenticated.
  const token = randomBytes(24).toString('base64url');

  const result = await pgClient.query<SquadInvite>(
    `INSERT INTO squad_invites
       (id, "squadId", token, "createdByUserId", role, "expiresAt", "maxUses", "usedCount", "createdAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, 'MEMBER', NOW() + ($4 || ' days')::interval, $5, 0, NOW())
     RETURNING id, "squadId", token, role, "expiresAt", "maxUses", "usedCount", "revokedAt", "createdAt"`,
    [squadId, token, userId, String(ttl), maxUses],
  );
  return result.rows[0]!;
}

/** OWNER only. Revoking is immediate and permanent; issue a new link instead of un-revoking. */
export async function revokeInvite(
  userId: string,
  squadId: string,
  inviteId: string,
): Promise<void> {
  await assertOwner(userId, squadId);
  const result = await pgClient.query(
    `UPDATE squad_invites SET "revokedAt" = NOW()
     WHERE id = $1 AND "squadId" = $2 AND "revokedAt" IS NULL`,
    [inviteId, squadId],
  );
  if (result.rowCount === 0) {
    throw new SquadError(404, 'Invite not found or already revoked');
  }
}

/** OWNER only — an invite token is a credential, so members at large must not read them. */
export async function listInvites(userId: string, squadId: string): Promise<SquadInvite[]> {
  await assertOwner(userId, squadId);
  const result = await pgClient.query<SquadInvite>(
    `SELECT id, "squadId", token, role, "expiresAt", "maxUses", "usedCount", "revokedAt", "createdAt"
     FROM squad_invites WHERE "squadId" = $1 ORDER BY "createdAt" DESC`,
    [squadId],
  );
  return result.rows;
}

/**
 * Resolves a token for the pre-auth landing page. Returns null for anything unusable —
 * missing, revoked, expired, or exhausted — so a visitor cannot distinguish "wrong token"
 * from "expired token", and cannot probe which tokens exist.
 */
export async function getInvitePreview(token: string): Promise<InvitePreview | null> {
  const result = await pgClient.query<InvitePreview>(
    `SELECT s.id AS "squadId", s.name AS "squadName", u.name AS "invitedByName",
            (SELECT COUNT(*)::int FROM squad_members m WHERE m."squadId" = s.id) AS "memberCount",
            (SELECT COUNT(*)::int FROM games g WHERE g."squadId" = s.id) AS "gameCount"
     FROM squad_invites i
     JOIN squads s ON s.id = i."squadId"
     JOIN users u ON u.id = i."createdByUserId"
     WHERE i.token = $1
       AND i."revokedAt" IS NULL
       AND i."expiresAt" > NOW()
       AND (i."maxUses" = 0 OR i."usedCount" < i."maxUses")`,
    [token],
  );
  return result.rows[0] ?? null;
}

export interface AcceptInviteResult {
  squadId: string;
  squadName: string;
  /** False when the user was already in the squad — the call is idempotent, not an error. */
  joined: boolean;
}

/**
 * Joins the caller to the squad behind `token` and makes it their active squad.
 *
 * Joining is never gated on a data decision: it either succeeds or the token is unusable.
 * Contributing existing games and claiming a roster entry are separate, skippable steps.
 *
 * Re-accepting a token you have already used is a no-op that still switches you into the
 * squad, because the realistic cause is a double-click or a re-opened link.
 */
export async function acceptInvite(userId: string, token: string): Promise<AcceptInviteResult> {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    const inviteResult = await client.query<{ id: string; squadId: string; squadName: string }>(
      `SELECT i.id, i."squadId", s.name AS "squadName"
       FROM squad_invites i JOIN squads s ON s.id = i."squadId"
       WHERE i.token = $1`,
      [token],
    );
    const invite = inviteResult.rows[0];
    if (!invite) throw new SquadError(404, 'This invite link is not valid');

    const already = await getMembership(userId, invite.squadId, client);
    if (already) {
      // Do NOT consume a use — the invite was already spent on this person.
      await client.query(`UPDATE users SET "activeSquadId" = $1, "updatedAt" = NOW() WHERE id = $2`, [
        invite.squadId,
        userId,
      ]);
      await client.query('COMMIT');
      return { squadId: invite.squadId, squadName: invite.squadName, joined: false };
    }

    // Atomic check-and-consume. Doing the validity checks in the UPDATE's WHERE clause is
    // what makes a `maxUses: 1` link safe against two people clicking it simultaneously —
    // a read-then-write would let both through.
    const consumed = await client.query(
      `UPDATE squad_invites SET "usedCount" = "usedCount" + 1
       WHERE id = $1
         AND "revokedAt" IS NULL
         AND "expiresAt" > NOW()
         AND ("maxUses" = 0 OR "usedCount" < "maxUses")`,
      [invite.id],
    );
    if (consumed.rowCount === 0) {
      throw new SquadError(410, 'This invite link has expired or is no longer available');
    }

    await client.query(
      `INSERT INTO squad_members (id, "squadId", "userId", role, "joinedAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'MEMBER', NOW())`,
      [invite.squadId, userId],
    );
    await client.query(`UPDATE users SET "activeSquadId" = $1, "updatedAt" = NOW() WHERE id = $2`, [
      invite.squadId,
      userId,
    ]);

    await client.query('COMMIT');
    return { squadId: invite.squadId, squadName: invite.squadName, joined: true };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error({ err: rollbackErr }, 'Rollback failed while accepting a squad invite');
    }
    throw error;
  } finally {
    client.release();
  }
}

// ── Identify yourself on the roster ──────────────────────────────────────────────

export interface RosterEntry {
  id: string;
  gamertag: string;
  displayName: string;
  linkedUserId: string | null;
  /** True when the linked user is the caller. */
  isYou: boolean;
}

/** The squad's roster, marking which entries are already claimed. */
export async function listRoster(
  userId: string,
  squadId: string,
  db: Queryable = pgClient,
): Promise<RosterEntry[]> {
  await assertMember(userId, squadId, db);
  const result = await db.query<RosterEntry>(
    `SELECT id, gamertag, "displayName", "linkedUserId", ("linkedUserId" = $2) AS "isYou"
     FROM player_mappings WHERE "squadId" = $1
     ORDER BY "displayName" ASC`,
    [squadId, userId],
  );
  return result.rows;
}

/**
 * Claims an existing roster entry as the caller, or creates one for them.
 *
 * This is the only thing that links an app user to their player rows, so it is what makes
 * the cross-squad career view possible later. It is skippable — a member who never
 * identifies themselves simply has no career data for this squad.
 *
 * Re-claiming moves the link rather than failing: a member who picked the wrong entry
 * should be able to correct it without an admin.
 */
export async function claimRosterEntry(
  userId: string,
  squadId: string,
  target: { mappingId?: string; gamertag?: string; displayName?: string },
): Promise<RosterEntry> {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await assertMember(userId, squadId, client);

    // Release any entry this user already holds in this squad. Without this the
    // [squadId, linkedUserId] unique index would reject the new claim.
    await client.query(
      `UPDATE player_mappings SET "linkedUserId" = NULL, "updatedAt" = NOW()
       WHERE "squadId" = $1 AND "linkedUserId" = $2`,
      [squadId, userId],
    );

    let row: RosterEntry | undefined;

    if (target.mappingId) {
      const claimed = await client.query<RosterEntry>(
        `UPDATE player_mappings SET "linkedUserId" = $3, "updatedAt" = NOW()
         WHERE id = $1 AND "squadId" = $2 AND "linkedUserId" IS NULL
         RETURNING id, gamertag, "displayName", "linkedUserId", true AS "isYou"`,
        [target.mappingId, squadId, userId],
      );
      if (claimed.rowCount === 0) {
        // Either it isn't in this squad, or someone else already claimed it. Both resolve
        // to the same user-facing situation: pick a different entry.
        throw new SquadError(409, 'That roster entry is already claimed by another member');
      }
      row = claimed.rows[0]!;
    } else {
      const gamertag = target.gamertag?.trim();
      const displayName = target.displayName?.trim() || gamertag;
      if (!gamertag) {
        throw new SquadError(400, 'Provide either an existing roster entry or a gamertag');
      }
      const created = await client.query<RosterEntry>(
        `INSERT INTO player_mappings (id, "squadId", gamertag, "displayName", "linkedUserId", "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT ("squadId", gamertag) DO NOTHING
         RETURNING id, gamertag, "displayName", "linkedUserId", true AS "isYou"`,
        [squadId, gamertag, displayName, userId],
      );
      if (created.rowCount === 0) {
        // The gamertag already exists in this squad — claim it instead of creating a
        // duplicate, which is what the user meant.
        const existing = await client.query<RosterEntry>(
          `UPDATE player_mappings SET "linkedUserId" = $3, "updatedAt" = NOW()
           WHERE "squadId" = $1 AND gamertag = $2 AND "linkedUserId" IS NULL
           RETURNING id, gamertag, "displayName", "linkedUserId", true AS "isYou"`,
          [squadId, gamertag, userId],
        );
        if (existing.rowCount === 0) {
          throw new SquadError(409, 'That gamertag is already claimed by another member');
        }
        row = existing.rows[0]!;
      } else {
        row = created.rows[0]!;
      }
    }

    await client.query('COMMIT');
    return row!;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error({ err: rollbackErr }, 'Rollback failed while claiming a roster entry');
    }
    throw error;
  } finally {
    client.release();
  }
}
