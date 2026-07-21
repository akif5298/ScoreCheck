/**
 * Integration coverage for squadService against a real Postgres.
 *
 * The unit suites mock this module wholesale, so its SQL — the constraints, the
 * transaction boundaries, and the 404-not-403 disclosure rule — has never actually
 * executed under test. Everything here runs the real statements.
 */
import {
  SquadError,
  createPersonalSquad,
  createSquad,
  seedRosterFromPersonal,
  getMembership,
  assertMember,
  assertOwner,
  listSquadsForUser,
  setActiveSquad,
  listMembers,
  resolveSquadId,
  createInvite,
  revokeInvite,
  listInvites,
  getInvitePreview,
  acceptInvite,
  listRoster,
  claimRosterEntry,
} from '@/services/squadService';
import { pgPool } from '@/services/supabase';
import { makeUser, makeMapping, getActiveSquadId, countRows } from './factories';

/**
 * Days until an invite expires, computed in SQL.
 *
 * `squad_invites.expiresAt` is `timestamp without time zone`: Postgres writes it in the
 * server's zone and node-postgres reads it back as local time, so subtracting `Date.now()`
 * in JS is off by the UTC offset. The service does every expiry comparison in SQL, so
 * measuring here the same way tests the behaviour that actually ships.
 */
async function daysUntilExpiry(inviteId: string): Promise<number> {
  const { rows } = await pgPool.query<{ days: string }>(
    `SELECT EXTRACT(EPOCH FROM ("expiresAt" - NOW())) / 86400 AS days
     FROM squad_invites WHERE id = $1`,
    [inviteId],
  );
  return Number(rows[0]!.days);
}

describe('createPersonalSquad', () => {
  it('creates the squad, an OWNER membership, and points activeSquadId at it', async () => {
    const user = await makeUser();

    const squad = await createPersonalSquad(user.id);

    expect(squad.isPersonal).toBe(true);
    expect(squad.name).toBe('Personal');
    expect(squad.createdByUserId).toBe(user.id);

    const membership = await getMembership(user.id, squad.id);
    expect(membership).toEqual({ squadId: squad.id, userId: user.id, role: 'OWNER' });

    await expect(getActiveSquadId(user.id)).resolves.toBe(squad.id);
  });

  it('gives each user a distinct personal squad', async () => {
    const a = await makeUser();
    const b = await makeUser();

    const squadA = await createPersonalSquad(a.id);
    const squadB = await createPersonalSquad(b.id);

    expect(squadA.id).not.toBe(squadB.id);
    await expect(getMembership(a.id, squadB.id)).resolves.toBeNull();
  });
});

describe('createSquad', () => {
  it('creates a non-personal squad with the creator as OWNER', async () => {
    const user = await makeUser();

    const squad = await createSquad(user.id, 'Tuesday Crew');

    expect(squad.isPersonal).toBe(false);
    expect(squad.name).toBe('Tuesday Crew');
    await expect(getMembership(user.id, squad.id)).resolves.toMatchObject({ role: 'OWNER' });
  });

  it('seeds the new squad roster from the creator personal mappings', async () => {
    const user = await makeUser();
    const personal = await createPersonalSquad(user.id);
    await makeMapping(personal.id, 'akif2k', 'Akif');
    await makeMapping(personal.id, 'nillan', 'Nillan');

    const squad = await createSquad(user.id, 'Shared');

    await expect(countRows('player_mappings', squad.id)).resolves.toBe(2);
  });

  it('does not copy linkedUserId into the seeded roster', async () => {
    const user = await makeUser();
    const personal = await createPersonalSquad(user.id);
    const mappingId = await makeMapping(personal.id, 'akif2k', 'Akif');
    await pgPool.query('UPDATE player_mappings SET "linkedUserId" = $1 WHERE id = $2', [
      user.id,
      mappingId,
    ]);

    const squad = await createSquad(user.id, 'Shared');

    const { rows } = await pgPool.query<{ linkedUserId: string | null }>(
      'SELECT "linkedUserId" FROM player_mappings WHERE "squadId" = $1',
      [squad.id],
    );
    expect(rows).toHaveLength(1);
    // The identity link is per-squad and must be re-claimed through the identify step.
    expect(rows[0]!.linkedUserId).toBeNull();
  });
});

describe('seedRosterFromPersonal', () => {
  it('is a no-op when the target roster is already populated', async () => {
    const user = await makeUser();
    const personal = await createPersonalSquad(user.id);
    await makeMapping(personal.id, 'akif2k', 'Akif');

    const target = await createSquad(user.id, 'Established');
    // createSquad already seeded one row; a second call must not duplicate it.
    const copied = await seedRosterFromPersonal(user.id, target.id);

    expect(copied).toBe(0);
    await expect(countRows('player_mappings', target.id)).resolves.toBe(1);
  });

  it('copies nothing when the personal roster is empty', async () => {
    const user = await makeUser();
    await createPersonalSquad(user.id);
    const target = await createSquad(user.id, 'Empty');

    await expect(seedRosterFromPersonal(user.id, target.id)).resolves.toBe(0);
  });

  it('degrades safely when the driver returns no count row and a null rowCount', async () => {
    // Real Postgres never does this — COUNT(*) always yields exactly one row, and an
    // INSERT always reports a numeric rowCount. The `?? 0` fallbacks exist anyway, and
    // this drives them through the injectable Queryable rather than by mocking internals.
    const db = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: null }),
    };

    await expect(seedRosterFromPersonal('user', 'squad', db as never)).resolves.toBe(0);
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});

describe('assertMember / assertOwner', () => {
  it('assertMember resolves for a member', async () => {
    const user = await makeUser();
    const squad = await createPersonalSquad(user.id);

    await expect(assertMember(user.id, squad.id)).resolves.toBeDefined();
  });

  it('assertMember throws 404 — not 403 — for a non-member', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const squad = await createPersonalSquad(owner.id);

    // 404 rather than 403 so the response cannot confirm the squad exists.
    await expect(assertMember(outsider.id, squad.id)).rejects.toMatchObject({
      name: 'SquadError',
      status: 404,
    });
  });

  it('assertOwner rejects a plain MEMBER', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');
    await pgPool.query(
      `INSERT INTO squad_members (id, "squadId", "userId", role, "joinedAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'MEMBER', NOW())`,
      [squad.id, member.id],
    );

    await expect(assertOwner(member.id, squad.id)).rejects.toBeInstanceOf(SquadError);
    await expect(assertOwner(owner.id, squad.id)).resolves.toBeDefined();
  });
});

describe('listSquadsForUser', () => {
  it('returns only squads the user belongs to, flagging the active one', async () => {
    const user = await makeUser();
    const other = await makeUser();
    const personal = await createPersonalSquad(user.id);
    const shared = await createSquad(user.id, 'Crew');
    await createPersonalSquad(other.id);

    const squads = await listSquadsForUser(user.id);

    expect(squads.map((s) => s.id).sort()).toEqual([personal.id, shared.id].sort());
    expect(squads.find((s) => s.id === personal.id)?.isActive).toBe(true);
    expect(squads.find((s) => s.id === shared.id)?.isActive).toBe(false);
  });
});

describe('setActiveSquad', () => {
  it('moves activeSquadId to another squad the user is in', async () => {
    const user = await makeUser();
    await createPersonalSquad(user.id);
    const shared = await createSquad(user.id, 'Crew');

    await setActiveSquad(user.id, shared.id);

    await expect(getActiveSquadId(user.id)).resolves.toBe(shared.id);
  });

  it('refuses a squad the user is not a member of', async () => {
    const user = await makeUser();
    const stranger = await makeUser();
    await createPersonalSquad(user.id);
    const foreign = await createSquad(stranger.id, 'Not Yours');

    await expect(setActiveSquad(user.id, foreign.id)).rejects.toBeInstanceOf(SquadError);
  });
});

describe('listMembers', () => {
  it('lists members with their roles', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');
    await pgPool.query(
      `INSERT INTO squad_members (id, "squadId", "userId", role, "joinedAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'MEMBER', NOW())`,
      [squad.id, member.id],
    );

    const members = await listMembers(owner.id, squad.id);

    expect(members).toHaveLength(2);
    expect(members.find((m) => m.userId === owner.id)?.role).toBe('OWNER');
    expect(members.find((m) => m.userId === member.id)?.role).toBe('MEMBER');
    // uploadedGames drives the leave/remove warning, so it must be a number not a string.
    expect(members.every((m) => typeof m.uploadedGames === 'number')).toBe(true);
  });

  it('rejects a non-member', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');

    await expect(listMembers(outsider.id, squad.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('createSquad rollback', () => {
  it('rolls back and leaves no squad behind when the transaction fails', async () => {
    // No such user, so the createdByUserId foreign key rejects the INSERT.
    const before = await countRows('squads');

    await expect(createSquad('user-that-does-not-exist', 'Doomed')).rejects.toThrow();

    await expect(countRows('squads')).resolves.toBe(before);
  });
});

describe('resolveSquadId', () => {
  it('returns the requested squad when the caller is a member', async () => {
    const user = await makeUser();
    await createPersonalSquad(user.id);
    const shared = await createSquad(user.id, 'Crew');

    await expect(resolveSquadId(user.id, shared.id)).resolves.toBe(shared.id);
  });

  it('rejects a requested squad the caller is not in', async () => {
    const user = await makeUser();
    const stranger = await makeUser();
    await createPersonalSquad(user.id);
    const foreign = await createSquad(stranger.id, 'Not Yours');

    await expect(resolveSquadId(user.id, foreign.id)).rejects.toMatchObject({ status: 404 });
  });

  it('falls back to activeSquadId when nothing is requested', async () => {
    const user = await makeUser();
    await createPersonalSquad(user.id);
    const shared = await createSquad(user.id, 'Crew');
    await setActiveSquad(user.id, shared.id);

    await expect(resolveSquadId(user.id)).resolves.toBe(shared.id);
  });

  it('repairs a stale activeSquadId by falling back to the personal squad', async () => {
    const user = await makeUser();
    const personal = await createPersonalSquad(user.id);
    const shared = await createSquad(user.id, 'Crew');
    await setActiveSquad(user.id, shared.id);
    // Simulate having been removed from the squad the pointer still names.
    await pgPool.query('DELETE FROM squad_members WHERE "squadId" = $1 AND "userId" = $2', [
      shared.id,
      user.id,
    ]);

    await expect(resolveSquadId(user.id)).resolves.toBe(personal.id);
    // The pointer is repaired, not just worked around.
    await expect(getActiveSquadId(user.id)).resolves.toBe(personal.id);
  });

  it('throws 500 when the user somehow has no personal squad', async () => {
    const user = await makeUser();
    // Only a shared squad, and createSquad does not set activeSquadId.
    await createSquad(user.id, 'Orphaned');

    await expect(resolveSquadId(user.id)).rejects.toMatchObject({ status: 500 });
  });
});

describe('createInvite', () => {
  it('creates an invite defaulting to 7 days and unlimited uses', async () => {
    const owner = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');

    const invite = await createInvite(owner.id, squad.id);

    expect(invite.squadId).toBe(squad.id);
    expect(invite.maxUses).toBe(0);
    expect(invite.usedCount).toBe(0);
    expect(invite.revokedAt).toBeNull();
    expect(invite.role).toBe('MEMBER');
    // 192 bits, base64url — 24 bytes encodes to 32 chars.
    expect(invite.token).toHaveLength(32);
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]+$/);

    // Measured in SQL rather than JS. `expiresAt` is `timestamp without time zone`, so
    // node-postgres parses it as local time while Postgres wrote it in the server's zone —
    // a JS-side comparison is skewed by the UTC offset. Every expiry check in the service
    // is done in SQL, so this asserts the invariant where it actually holds.
    await expect(daysUntilExpiry(invite.id)).resolves.toBeCloseTo(7, 1);
  });

  it('honours explicit expiry and maxUses', async () => {
    const owner = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');

    const invite = await createInvite(owner.id, squad.id, { expiresInDays: 1, maxUses: 3 });

    expect(invite.maxUses).toBe(3);
    await expect(daysUntilExpiry(invite.id)).resolves.toBeCloseTo(1, 1);
  });

  it('refuses to share a personal squad', async () => {
    const user = await makeUser();
    const personal = await createPersonalSquad(user.id);

    // Sharing a personal squad would silently turn the user's whole history into
    // group data; creating a real squad is the explicit path.
    await expect(createInvite(user.id, personal.id)).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a plain member', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');
    await pgPool.query(
      `INSERT INTO squad_members (id, "squadId", "userId", role, "joinedAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'MEMBER', NOW())`,
      [squad.id, member.id],
    );

    await expect(createInvite(member.id, squad.id)).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    ['zero days', { expiresInDays: 0 }],
    ['negative days', { expiresInDays: -1 }],
    ['beyond the 30-day cap', { expiresInDays: 31 }],
    ['fractional days', { expiresInDays: 1.5 }],
    ['negative maxUses', { maxUses: -1 }],
    ['fractional maxUses', { maxUses: 2.5 }],
  ])('rejects %s', async (_label, options) => {
    const owner = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');

    await expect(createInvite(owner.id, squad.id, options)).rejects.toMatchObject({ status: 400 });
  });

  it('issues a distinct token each time', async () => {
    const owner = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');

    const a = await createInvite(owner.id, squad.id);
    const b = await createInvite(owner.id, squad.id);

    expect(a.token).not.toBe(b.token);
  });
});

describe('revokeInvite', () => {
  it('revokes an active invite', async () => {
    const owner = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');
    const invite = await createInvite(owner.id, squad.id);

    await revokeInvite(owner.id, squad.id, invite.id);

    const [listed] = await listInvites(owner.id, squad.id);
    expect(listed!.revokedAt).not.toBeNull();
  });

  it('404s when already revoked — revocation is permanent', async () => {
    const owner = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');
    const invite = await createInvite(owner.id, squad.id);
    await revokeInvite(owner.id, squad.id, invite.id);

    await expect(revokeInvite(owner.id, squad.id, invite.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('404s for an invite belonging to another squad', async () => {
    const owner = await makeUser();
    const squadA = await createSquad(owner.id, 'A');
    const squadB = await createSquad(owner.id, 'B');
    const invite = await createInvite(owner.id, squadA.id);

    await expect(revokeInvite(owner.id, squadB.id, invite.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('rejects a plain member', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');
    const invite = await createInvite(owner.id, squad.id);
    await pgPool.query(
      `INSERT INTO squad_members (id, "squadId", "userId", role, "joinedAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'MEMBER', NOW())`,
      [squad.id, member.id],
    );

    await expect(revokeInvite(member.id, squad.id, invite.id)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('listInvites', () => {
  it('returns the squad invites newest first', async () => {
    const owner = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');
    const first = await createInvite(owner.id, squad.id);
    await pgPool.query(`UPDATE squad_invites SET "createdAt" = NOW() - interval '1 hour'`);
    const second = await createInvite(owner.id, squad.id);

    const invites = await listInvites(owner.id, squad.id);

    expect(invites.map((i) => i.id)).toEqual([second.id, first.id]);
  });

  it('rejects a plain member — a token is a credential', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');
    await pgPool.query(
      `INSERT INTO squad_members (id, "squadId", "userId", role, "joinedAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'MEMBER', NOW())`,
      [squad.id, member.id],
    );

    await expect(listInvites(member.id, squad.id)).rejects.toMatchObject({ status: 403 });
  });
});

describe('getInvitePreview', () => {
  it('returns squad details for a usable token', async () => {
    const owner = await makeUser();
    const squad = await createSquad(owner.id, 'Tuesday Crew');
    const invite = await createInvite(owner.id, squad.id);

    const preview = await getInvitePreview(invite.token);

    expect(preview).toMatchObject({
      squadId: squad.id,
      squadName: 'Tuesday Crew',
      memberCount: 1,
      gameCount: 0,
    });
  });

  it('returns null for an unknown token', async () => {
    await expect(getInvitePreview('no-such-token')).resolves.toBeNull();
  });

  it('returns null for a revoked token', async () => {
    const owner = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');
    const invite = await createInvite(owner.id, squad.id);
    await revokeInvite(owner.id, squad.id, invite.id);

    await expect(getInvitePreview(invite.token)).resolves.toBeNull();
  });

  it('returns null for an expired token', async () => {
    const owner = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');
    const invite = await createInvite(owner.id, squad.id);
    await pgPool.query(`UPDATE squad_invites SET "expiresAt" = NOW() - interval '1 day'`);

    await expect(getInvitePreview(invite.token)).resolves.toBeNull();
  });

  it('returns null for an exhausted token', async () => {
    const owner = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');
    const invite = await createInvite(owner.id, squad.id, { maxUses: 1 });
    await pgPool.query(`UPDATE squad_invites SET "usedCount" = 1`);

    // Unknown, revoked, expired and exhausted all return null so a visitor cannot
    // tell them apart or probe which tokens exist.
    await expect(getInvitePreview(invite.token)).resolves.toBeNull();
  });
});

describe('acceptInvite', () => {
  it('joins the caller as MEMBER, switches their active squad, and consumes one use', async () => {
    const owner = await makeUser();
    const joiner = await makeUser();
    await createPersonalSquad(joiner.id);
    const squad = await createSquad(owner.id, 'Crew');
    const invite = await createInvite(owner.id, squad.id, { maxUses: 2 });

    const result = await acceptInvite(joiner.id, invite.token);

    expect(result).toEqual({ squadId: squad.id, squadName: 'Crew', joined: true });
    await expect(getMembership(joiner.id, squad.id)).resolves.toMatchObject({ role: 'MEMBER' });
    await expect(getActiveSquadId(joiner.id)).resolves.toBe(squad.id);

    const [listed] = await listInvites(owner.id, squad.id);
    expect(listed!.usedCount).toBe(1);
  });

  it('is idempotent for an existing member and does not consume a use', async () => {
    const owner = await makeUser();
    const joiner = await makeUser();
    await createPersonalSquad(joiner.id);
    const squad = await createSquad(owner.id, 'Crew');
    const invite = await createInvite(owner.id, squad.id, { maxUses: 1 });
    await acceptInvite(joiner.id, invite.token);

    // A double-click or a re-opened link must not fail, and must not burn a use.
    const again = await acceptInvite(joiner.id, invite.token);

    expect(again.joined).toBe(false);
    const [listed] = await listInvites(owner.id, squad.id);
    expect(listed!.usedCount).toBe(1);
  });

  it('404s for an unknown token', async () => {
    const joiner = await makeUser();

    await expect(acceptInvite(joiner.id, 'no-such-token')).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    ['revoked', `UPDATE squad_invites SET "revokedAt" = NOW()`],
    ['expired', `UPDATE squad_invites SET "expiresAt" = NOW() - interval '1 day'`],
    ['exhausted', `UPDATE squad_invites SET "maxUses" = 1, "usedCount" = 1`],
  ])('410s for a %s token', async (_label, sql) => {
    const owner = await makeUser();
    const joiner = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');
    const invite = await createInvite(owner.id, squad.id);
    await pgPool.query(sql);

    await expect(acceptInvite(joiner.id, invite.token)).rejects.toMatchObject({ status: 410 });
    await expect(getMembership(joiner.id, squad.id)).resolves.toBeNull();
  });

  it('lets a maxUses:1 link admit exactly one of two joiners', async () => {
    const owner = await makeUser();
    const first = await makeUser();
    const second = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');
    const invite = await createInvite(owner.id, squad.id, { maxUses: 1 });

    await acceptInvite(first.id, invite.token);
    await expect(acceptInvite(second.id, invite.token)).rejects.toMatchObject({ status: 410 });

    const members = await listMembers(owner.id, squad.id);
    expect(members).toHaveLength(2);
  });
});

describe('listRoster', () => {
  it('lists entries alphabetically and flags the caller own entry', async () => {
    const user = await makeUser();
    const squad = await createSquad(user.id, 'Crew');
    await makeMapping(squad.id, 'zed', 'Zed');
    const mine = await makeMapping(squad.id, 'akif2k', 'Akif');
    await pgPool.query('UPDATE player_mappings SET "linkedUserId" = $1 WHERE id = $2', [
      user.id,
      mine,
    ]);

    const roster = await listRoster(user.id, squad.id);

    expect(roster.map((r) => r.displayName)).toEqual(['Akif', 'Zed']);
    expect(roster.find((r) => r.id === mine)?.isYou).toBe(true);
    expect(roster.find((r) => r.gamertag === 'zed')?.isYou).toBeNull();
  });

  it('rejects a non-member', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');

    await expect(listRoster(outsider.id, squad.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('claimRosterEntry', () => {
  it('claims an existing unclaimed entry by id', async () => {
    const user = await makeUser();
    const squad = await createSquad(user.id, 'Crew');
    const mappingId = await makeMapping(squad.id, 'akif2k', 'Akif');

    const claimed = await claimRosterEntry(user.id, squad.id, { mappingId });

    expect(claimed).toMatchObject({ id: mappingId, gamertag: 'akif2k', linkedUserId: user.id });
  });

  it('409s when the entry is already claimed by someone else', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');
    const mappingId = await makeMapping(squad.id, 'akif2k', 'Akif');
    await pgPool.query('UPDATE player_mappings SET "linkedUserId" = $1 WHERE id = $2', [
      other.id,
      mappingId,
    ]);

    await expect(claimRosterEntry(owner.id, squad.id, { mappingId })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('409s for a mappingId belonging to another squad', async () => {
    const user = await makeUser();
    const squad = await createSquad(user.id, 'Crew');
    const otherSquad = await createSquad(user.id, 'Other');
    const foreign = await makeMapping(otherSquad.id, 'ghost', 'Ghost');

    await expect(
      claimRosterEntry(user.id, squad.id, { mappingId: foreign }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('creates a new entry when only a gamertag is given', async () => {
    const user = await makeUser();
    const squad = await createSquad(user.id, 'Crew');

    const claimed = await claimRosterEntry(user.id, squad.id, {
      gamertag: '  newguy  ',
      displayName: '  New Guy  ',
    });

    // Both fields are trimmed before insert.
    expect(claimed).toMatchObject({
      gamertag: 'newguy',
      displayName: 'New Guy',
      linkedUserId: user.id,
    });
  });

  it('falls back to the gamertag when no displayName is given', async () => {
    const user = await makeUser();
    const squad = await createSquad(user.id, 'Crew');

    const claimed = await claimRosterEntry(user.id, squad.id, { gamertag: 'solo' });

    expect(claimed.displayName).toBe('solo');
  });

  it('claims the existing entry when the gamertag is already on the roster', async () => {
    const user = await makeUser();
    const squad = await createSquad(user.id, 'Crew');
    const existing = await makeMapping(squad.id, 'akif2k', 'Akif');

    const claimed = await claimRosterEntry(user.id, squad.id, { gamertag: 'akif2k' });

    // Claim it rather than creating a duplicate — that is what the user meant.
    expect(claimed.id).toBe(existing);
    await expect(countRows('player_mappings', squad.id)).resolves.toBe(1);
  });

  it('409s when that gamertag is claimed by another member', async () => {
    const user = await makeUser();
    const other = await makeUser();
    const squad = await createSquad(user.id, 'Crew');
    const taken = await makeMapping(squad.id, 'akif2k', 'Akif');
    await pgPool.query('UPDATE player_mappings SET "linkedUserId" = $1 WHERE id = $2', [
      other.id,
      taken,
    ]);

    await expect(
      claimRosterEntry(user.id, squad.id, { gamertag: 'akif2k' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    ['nothing at all', {}],
    ['a blank gamertag', { gamertag: '   ' }],
  ])('400s when given %s', async (_label, target) => {
    const user = await makeUser();
    const squad = await createSquad(user.id, 'Crew');

    await expect(claimRosterEntry(user.id, squad.id, target)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('re-claiming moves the link and releases the previous entry', async () => {
    const user = await makeUser();
    const squad = await createSquad(user.id, 'Crew');
    const first = await makeMapping(squad.id, 'wrong', 'Wrong');
    const second = await makeMapping(squad.id, 'right', 'Right');
    await claimRosterEntry(user.id, squad.id, { mappingId: first });

    const claimed = await claimRosterEntry(user.id, squad.id, { mappingId: second });

    // A member who picked the wrong entry must be able to self-correct.
    expect(claimed.id).toBe(second);
    const roster = await listRoster(user.id, squad.id);
    expect(roster.find((r) => r.id === first)?.linkedUserId).toBeNull();
    expect(roster.find((r) => r.id === second)?.linkedUserId).toBe(user.id);
  });

  it('rejects a non-member', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const squad = await createSquad(owner.id, 'Crew');

    await expect(
      claimRosterEntry(outsider.id, squad.id, { gamertag: 'sneaky' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

/**
 * The three transactional helpers each wrap their ROLLBACK in its own try/catch, so a
 * connection that dies mid-transaction cannot mask the real failure. That path can only
 * be reached by making ROLLBACK itself throw, which needs a stubbed pool client.
 *
 * The behaviour being pinned is not "a log line happens" — it is that the ORIGINAL error
 * propagates. If a future refactor let the rollback error escape instead, the caller would
 * see a meaningless "rollback failed" in place of the actual cause.
 */
describe('rollback failures do not mask the original error', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stubClientFailing(failOn: RegExp) {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (/^\s*ROLLBACK/i.test(sql)) throw new Error('connection lost during rollback');
        if (failOn.test(sql)) throw new Error('original failure');
        // Membership lookups must succeed, or assertMember short-circuits with a 404
        // before execution ever reaches the statement this test aims to fail.
        if (/FROM squad_members/i.test(sql)) {
          return {
            rows: [{ squadId: 'some-squad', userId: 'anyone', role: 'OWNER' }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    };
    jest.spyOn(pgPool, 'connect').mockResolvedValue(client as never);
    return client;
  }

  it('createSquad rethrows the original error and still releases the client', async () => {
    const client = stubClientFailing(/INSERT INTO squads/i);

    await expect(createSquad('anyone', 'Doomed')).rejects.toThrow('original failure');
    expect(client.release).toHaveBeenCalled();
  });

  it('acceptInvite rethrows the original error and still releases the client', async () => {
    const client = stubClientFailing(/FROM squad_invites/i);

    await expect(acceptInvite('anyone', 'some-token')).rejects.toThrow('original failure');
    expect(client.release).toHaveBeenCalled();
  });

  it('claimRosterEntry rethrows the original error and still releases the client', async () => {
    const client = stubClientFailing(/UPDATE player_mappings/i);

    await expect(
      claimRosterEntry('anyone', 'some-squad', { gamertag: 'x' }),
    ).rejects.toThrow('original failure');
    expect(client.release).toHaveBeenCalled();
  });
});
