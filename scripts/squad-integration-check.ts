/**
 * Integration harness for squad authorization and the join flow.
 *
 * NOT run by `npm test` — it needs a real Postgres. The unit suites mock squadService, so
 * the rules that actually protect a squad's data (owner-only invites, member-only reads,
 * uploader-or-owner deletes, atomic invite consumption) are only ever executed here.
 *
 * To run:
 *   docker run -d --rm --name sc-int -e POSTGRES_PASSWORD=int -p 55434:5432 postgres:17
 *   pg_dump --schema-only --no-owner "$PROD_DATABASE_URL" | docker exec -i sc-int psql -U postgres
 *   DATABASE_URL="postgresql://postgres:int@localhost:55434/postgres" \
 *     SUPABASE_URL=http://localhost:1 SUPABASE_PUBLISHABLE_KEY=x SUPABASE_SECRET_KEY=y \
 *     npx ts-node -r tsconfig-paths/register scripts/squad-integration-check.ts
 *
 * It TRUNCATEs application tables between scenarios — never point it at production.
 */
import { randomUUID } from 'node:crypto';
import { pgPool } from '@/services/supabase';
import supabaseService from '@/services/supabase';
import {
  SquadError,
  createPersonalSquad,
  createSquad,
  createInvite,
  revokeInvite,
  getInvitePreview,
  acceptInvite,
  listMembers,
  listRoster,
  claimRosterEntry,
  listSquadsForUser,
} from '@/services/squadService';
import { moveGamesToSquad } from '@/services/gameMoveService';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label} → ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`,
  );
}

/** Runs `fn` and reports the SquadError status it threw, or 'no-throw'. */
async function statusOf(fn: () => Promise<unknown>): Promise<number | string> {
  try {
    await fn();
    return 'no-throw';
  } catch (e) {
    if (e instanceof SquadError) return e.status;
    return `unexpected: ${(e as Error).message}`;
  }
}

async function makeUser(name: string): Promise<string> {
  const id = randomUUID();
  await pgPool.query(
    `INSERT INTO users (id, email, name, role, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'USER', NOW(), NOW())`,
    [id, `${name}-${id.slice(0, 8)}@example.com`, name],
  );
  return id;
}

async function makeGame(squadId: string, uploaderId: string): Promise<string> {
  const id = `game_${randomUUID()}`;
  await pgPool.query(
    `INSERT INTO games (id, date, "homeTeam", "awayTeam", "homeScore", "awayScore",
       "screenshotUrl", processed, "createdAt", "updatedAt", "squadId", "uploadedByUserId")
     VALUES ($1, NOW(), 'A', 'B', 95, 87, 'obj/x.jpg', true, NOW(), NOW(), $2, $3)`,
    [id, squadId, uploaderId],
  );
  await pgPool.query(
    `INSERT INTO players (id, name, team, "gameIdFromFile", "playerId", position,
       points, rebounds, assists, steals, blocks, fouls, turnovers,
       "fgMade", "fgAttempted", "threeMade", "threeAttempted", "ftMade", "ftAttempted",
       "createdAt", "updatedAt", "gameId", "squadId")
     VALUES ($1,'Akif','A','1','1_1_A','PG',20,5,3,1,0,3,2,8,15,2,5,2,2,NOW(),NOW(),$2,$3)`,
    [`player_${randomUUID()}`, id, squadId],
  );
  await pgPool.query(
    `INSERT INTO teams (id, name, "isHome", points, rebounds, assists, steals, blocks,
       turnovers, fouls, "fgMade", "fgAttempted", "threeMade", "threeAttempted",
       "ftMade", "ftAttempted", "createdAt", "updatedAt", "gameId", "squadId")
     VALUES ($1,'A',true,95,40,20,5,3,10,15,35,70,8,20,17,20,NOW(),NOW(),$2,$3)`,
    [`team_${randomUUID()}`, id, squadId],
  );
  return id;
}

/**
 * A game with realistic composite lineup names, so the move path's rewrite is exercised
 * against the shape the join in lineupEfficiency.ts actually depends on:
 * players.team must equal games."homeTeam" or games."awayTeam", exactly.
 */
async function makeRichGame(
  squadId: string,
  uploaderId: string,
  opts: { player: string; imageHash?: string | null },
): Promise<string> {
  const id = `game_${randomUUID()}`;
  const homeTeam = `${opts.player} (PG) + AI (SG)`;
  const awayTeam = 'Random (PG) + Random (SG)';

  await pgPool.query(
    `INSERT INTO games (id, date, "homeTeam", "awayTeam", "homeScore", "awayScore",
       "screenshotUrl", processed, "createdAt", "updatedAt", "squadId", "uploadedByUserId", "imageHash")
     VALUES ($1, NOW(), $4, $5, 95, 87, 'obj/x.jpg', true, NOW(), NOW(), $2, $3, $6)`,
    [id, squadId, uploaderId, homeTeam, awayTeam, opts.imageHash ?? null],
  );

  for (const [name, playerId] of [
    [opts.player, '1_1_A'],
    ['AI Player', '1_2_A'],
  ] as [string, string][]) {
    await pgPool.query(
      `INSERT INTO players (id, name, team, "gameIdFromFile", "playerId", position,
         points, rebounds, assists, steals, blocks, fouls, turnovers,
         "fgMade", "fgAttempted", "threeMade", "threeAttempted", "ftMade", "ftAttempted",
         "createdAt", "updatedAt", "gameId", "squadId")
       VALUES ($1,$4,$5,'1',$6,'PG',20,5,3,1,0,3,2,8,15,2,5,2,2,NOW(),NOW(),$2,$3)`,
      [`player_${randomUUID()}`, id, squadId, name, homeTeam, playerId],
    );
  }

  for (const [name, isHome] of [
    [homeTeam, true],
    [awayTeam, false],
  ] as [string, boolean][]) {
    await pgPool.query(
      `INSERT INTO teams (id, name, "isHome", points, rebounds, assists, steals, blocks,
         turnovers, fouls, "fgMade", "fgAttempted", "threeMade", "threeAttempted",
         "ftMade", "ftAttempted", "createdAt", "updatedAt", "gameId", "squadId")
       VALUES ($1,$4,$5,95,40,20,5,3,10,15,35,70,8,20,17,20,NOW(),NOW(),$2,$3)`,
      [`team_${randomUUID()}`, id, squadId, name, isHome],
    );
  }
  return id;
}

/** A user plus their personal squad — the state signup actually produces. */
async function makeUserWithPersonal(name: string): Promise<{ id: string; personalId: string }> {
  const id = await makeUser(name);
  const squad = await createPersonalSquad(id);
  return { id, personalId: squad.id };
}

async function addMapping(squadId: string, gamertag: string, displayName: string): Promise<void> {
  await pgPool.query(
    `INSERT INTO player_mappings (id, "squadId", gamertag, "displayName", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, NOW(), NOW())`,
    [squadId, gamertag, displayName],
  );
}

const scalar = async (sql: string, params: unknown[] = []): Promise<any> =>
  (await pgPool.query(sql, params as any[])).rows[0]?.v;

/** The invariant the lineup join depends on. Must be 0 for every squad, always. */
const orphanedLineups = (squadId: string) =>
  scalar(
    `SELECT COUNT(*)::int AS v FROM players p JOIN games g ON g.id = p."gameId"
     WHERE p."squadId" = $1 AND p.team <> g."homeTeam" AND p.team <> g."awayTeam"`,
    [squadId],
  );

const reset = () =>
  pgPool.query(
    'TRUNCATE games, players, teams, player_mappings, player_stats, player_totals, squad_invites, squad_members, squads, users CASCADE',
  );

(async () => {
  // ── Authorization: who can do what ─────────────────────────────────────────────
  await reset();
  {
    const owner = await makeUser('owner');
    const member = await makeUser('member');
    const outsider = await makeUser('outsider');
    await createPersonalSquad(owner);
    await createPersonalSquad(member);
    await createPersonalSquad(outsider);
    const squad = await createSquad(owner, 'Tuesday Run');

    const invite = await createInvite(owner, squad.id);
    await acceptInvite(member, invite.token);

    check('member can list members', (await listMembers(member, squad.id)).length, 2);
    check('outsider listing members → 404', await statusOf(() => listMembers(outsider, squad.id)), 404);
    check('member creating an invite → 403', await statusOf(() => createInvite(member, squad.id)), 403);
    check(
      'outsider creating an invite → 404 (membership not disclosed)',
      await statusOf(() => createInvite(outsider, squad.id)),
      404,
    );
    check(
      'member revoking an invite → 403',
      await statusOf(() => revokeInvite(member, squad.id, invite.id)),
      403,
    );
    check('outsider reading roster → 404', await statusOf(() => listRoster(outsider, squad.id)), 404);

    const personal = (await listSquadsForUser(owner)).find(s => s.isPersonal)!;
    check(
      'a personal squad cannot be shared → 400',
      await statusOf(() => createInvite(owner, personal.id)),
      400,
    );
  }

  // ── Invite lifecycle ───────────────────────────────────────────────────────────
  await reset();
  {
    const owner = await makeUser('owner');
    const joiner = await makeUser('joiner');
    await createPersonalSquad(owner);
    await createPersonalSquad(joiner);
    const squad = await createSquad(owner, 'Squad');

    const revoked = await createInvite(owner, squad.id);
    await revokeInvite(owner, squad.id, revoked.id);
    check('revoked token has no preview', await getInvitePreview(revoked.token), null);
    check('revoked token cannot be used → 410', await statusOf(() => acceptInvite(joiner, revoked.token)), 410);

    const good = await createInvite(owner, squad.id);
    const preview = await getInvitePreview(good.token);
    check('preview shows squad name', preview?.squadName, 'Squad');
    check('preview shows member count', preview?.memberCount, 1);
    check('unknown token has no preview', await getInvitePreview('nope'), null);

    const joined = await acceptInvite(joiner, good.token);
    check('join reports joined:true', joined.joined, true);
    check('squad now has 2 members', (await listMembers(owner, squad.id)).length, 2);

    const again = await acceptInvite(joiner, good.token);
    check('re-accepting is idempotent (joined:false)', again.joined, false);
    const used = await pgPool.query('SELECT "usedCount" FROM squad_invites WHERE id = $1', [good.id]);
    check('  …and does NOT consume a second use', used.rows[0].usedCount, 1);

    // Expiry is enforced in SQL, so push the row into the past rather than waiting.
    const expired = await createInvite(owner, squad.id);
    await pgPool.query(`UPDATE squad_invites SET "expiresAt" = NOW() - interval '1 hour' WHERE id = $1`, [
      expired.id,
    ]);
    const other = await makeUser('other');
    await createPersonalSquad(other);
    check('expired token has no preview', await getInvitePreview(expired.token), null);
    check('expired token → 410', await statusOf(() => acceptInvite(other, expired.token)), 410);
  }

  // ── The invite-consumption race ────────────────────────────────────────────────
  // A maxUses:1 link clicked by several people at once. A read-then-write would let more
  // than one through; the check lives in the UPDATE's WHERE clause precisely to stop that.
  await reset();
  {
    const owner = await makeUser('owner');
    await createPersonalSquad(owner);
    const squad = await createSquad(owner, 'Squad');
    const invite = await createInvite(owner, squad.id, { maxUses: 1 });

    const racers: string[] = [];
    for (let i = 0; i < 5; i++) {
      const u = await makeUser(`racer${i}`);
      await createPersonalSquad(u);
      racers.push(u);
    }

    const outcomes = await Promise.all(
      racers.map(u =>
        acceptInvite(u, invite.token)
          .then(() => 'joined')
          .catch(e => (e instanceof SquadError && e.status === 410 ? 'refused' : `err:${e.message}`)),
      ),
    );
    check('maxUses:1 — exactly one joined', outcomes.filter(o => o === 'joined').length, 1);
    check('maxUses:1 — the other four refused', outcomes.filter(o => o === 'refused').length, 4);
    check('maxUses:1 — squad has 2 members (owner + 1)', (await listMembers(owner, squad.id)).length, 2);
    const finalUse = await pgPool.query('SELECT "usedCount" FROM squad_invites WHERE id = $1', [invite.id]);
    check('maxUses:1 — usedCount is exactly 1', finalUse.rows[0].usedCount, 1);
  }

  // ── Roster identity ────────────────────────────────────────────────────────────
  await reset();
  {
    const owner = await makeUser('owner');
    const member = await makeUser('member');
    await createPersonalSquad(owner);
    await createPersonalSquad(member);
    const squad = await createSquad(owner, 'Squad');
    const invite = await createInvite(owner, squad.id);
    await acceptInvite(member, invite.token);

    const seeded = await pgPool.query<{ id: string }>(
      `INSERT INTO player_mappings (id, "squadId", gamertag, "displayName", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, 'akif2k', 'Akif', NOW(), NOW()) RETURNING id`,
      [squad.id],
    );
    const mappingId = seeded.rows[0]!.id;

    const claimed = await claimRosterEntry(owner, squad.id, { mappingId });
    check('owner claims a roster entry', claimed.gamertag, 'akif2k');

    check(
      'a second member cannot claim the same entry → 409',
      await statusOf(() => claimRosterEntry(member, squad.id, { mappingId })),
      409,
    );

    const created = await claimRosterEntry(member, squad.id, { gamertag: 'nil2k', displayName: 'Nillan' });
    check('member creates and claims a new entry', created.displayName, 'Nillan');

    // Re-claiming moves the link rather than failing — the [squadId, linkedUserId] unique
    // index would otherwise make correcting a mistake impossible without an admin.
    const seeded2 = await pgPool.query<{ id: string }>(
      `INSERT INTO player_mappings (id, "squadId", gamertag, "displayName", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, 'nil_alt', 'Nillan Alt', NOW(), NOW()) RETURNING id`,
      [squad.id],
    );
    const moved = await claimRosterEntry(member, squad.id, { mappingId: seeded2.rows[0]!.id });
    check('re-claiming moves the link', moved.gamertag, 'nil_alt');
    const stillLinked = await pgPool.query(
      `SELECT count(*)::int AS n FROM player_mappings WHERE "squadId" = $1 AND "linkedUserId" = $2`,
      [squad.id, member],
    );
    check('  …leaving exactly one entry linked to that member', stillLinked.rows[0].n, 1);

    // Creating with a gamertag that already exists claims it instead of erroring, which is
    // what the user meant — but only if it is unclaimed.
    check(
      'creating a duplicate gamertag claimed by another → 409',
      await statusOf(() => claimRosterEntry(member, squad.id, { gamertag: 'akif2k' })),
      409,
    );

    check('listMembers surfaces the claimed name', (await listMembers(owner, squad.id)).find(m => m.userId === owner)?.gamertag, 'akif2k');
  }

  // ── Game deletion permissions ──────────────────────────────────────────────────
  await reset();
  {
    const owner = await makeUser('owner');
    const uploader = await makeUser('uploader');
    const bystander = await makeUser('bystander');
    const outsider = await makeUser('outsider');
    for (const u of [owner, uploader, bystander, outsider]) await createPersonalSquad(u);
    const squad = await createSquad(owner, 'Squad');
    const invite = await createInvite(owner, squad.id);
    await acceptInvite(uploader, invite.token);
    await acceptInvite(bystander, invite.token);

    const g1 = await makeGame(squad.id, uploader);
    check(
      'a member who did not upload it cannot delete → forbidden',
      (await supabaseService.deleteGameForSquad(g1, squad.id, { userId: bystander, isOwner: false })).outcome,
      'forbidden',
    );
    check(
      '  …and the game is still there',
      (await pgPool.query('SELECT count(*)::int AS n FROM games WHERE id = $1', [g1])).rows[0].n,
      1,
    );
    check(
      'the uploader can delete their own',
      (await supabaseService.deleteGameForSquad(g1, squad.id, { userId: uploader, isOwner: false })).outcome,
      'deleted',
    );
    check(
      '  …and players cascade with it',
      (await pgPool.query('SELECT count(*)::int AS n FROM players WHERE "gameId" = $1', [g1])).rows[0].n,
      0,
    );
    check(
      '  …and teams cascade with it',
      (await pgPool.query('SELECT count(*)::int AS n FROM teams WHERE "gameId" = $1', [g1])).rows[0].n,
      0,
    );

    const g2 = await makeGame(squad.id, uploader);
    check(
      'the squad owner can delete a game they did not upload',
      (await supabaseService.deleteGameForSquad(g2, squad.id, { userId: owner, isOwner: true })).outcome,
      'deleted',
    );

    // A game in another scope must report not_found, never forbidden — otherwise the
    // response confirms the game exists somewhere.
    const outsiderPersonal = (await listSquadsForUser(outsider)).find(s => s.isPersonal)!;
    const g3 = await makeGame(outsiderPersonal.id, outsider);
    check(
      "another squad's game → not_found, not forbidden",
      (await supabaseService.deleteGameForSquad(g3, squad.id, { userId: owner, isOwner: true })).outcome,
      'not_found',
    );
    check(
      '  …and it survives',
      (await pgPool.query('SELECT count(*)::int AS n FROM games WHERE id = $1', [g3])).rows[0].n,
      1,
    );
    check(
      'a nonexistent game → not_found',
      (await supabaseService.deleteGameForSquad('nope', squad.id, { userId: owner, isOwner: true })).outcome,
      'not_found',
    );
  }

  // ── Phase 6: moving games between squads ───────────────────────────────────────
  await reset();
  {
    const { id: owner, personalId: personal } = await makeUserWithPersonal('owner');
    await addMapping(personal, 'GRIM_BuLLeTzZz', 'Nillan');

    // createSquad seeds an empty roster from the creator's personal mappings, so the
    // bootstrap case needs no renaming at all.
    const squad = await createSquad(owner, 'Tuesday Run');
    check(
      'creating a squad seeds its roster from personal mappings',
      await scalar('SELECT COUNT(*)::int AS v FROM player_mappings WHERE "squadId" = $1', [squad.id]),
      1,
    );

    const g1 = await makeRichGame(personal, owner, { player: 'Nillan', imageHash: 'a'.repeat(60) });
    const result = await moveGamesToSquad(owner, squad.id, [g1]);

    check('moves the game', result.moved.length, 1);
    check('  …game is re-scoped', await scalar('SELECT "squadId" AS v FROM games WHERE id = $1', [g1]), squad.id);
    check(
      '  …players are re-scoped',
      await scalar('SELECT COUNT(*)::int AS v FROM players WHERE "gameId" = $1 AND "squadId" = $2', [g1, squad.id]),
      2,
    );
    check(
      '  …teams are re-scoped',
      await scalar('SELECT COUNT(*)::int AS v FROM teams WHERE "gameId" = $1 AND "squadId" = $2', [g1, squad.id]),
      2,
    );
    check('  …no rename needed (rosters agree)', result.renamed.length, 0);
    check('  …lineup invariant holds in the target', await orphanedLineups(squad.id), 0);
    check(
      '  …source squad keeps no orphaned rows',
      await scalar('SELECT COUNT(*)::int AS v FROM players WHERE "squadId" = $1', [personal]),
      0,
    );

    // Re-running the same move is a no-op rather than an error.
    const again = await moveGamesToSquad(owner, squad.id, [g1]);
    check('re-moving an already-present game is a no-op', again.alreadyThere, [g1]);
    check('  …and moves nothing', again.moved.length, 0);

    // A perceptually identical screenshot already in the target is skipped, not duplicated.
    const dup = await makeRichGame(personal, owner, { player: 'Nillan', imageHash: 'a'.repeat(60) });
    const dupResult = await moveGamesToSquad(owner, squad.id, [dup]);
    check('a duplicate screenshot is skipped', dupResult.duplicates.length, 1);
    check('  …and stays in the source squad', await scalar('SELECT "squadId" AS v FROM games WHERE id = $1', [dup]), personal);
  }

  // ── Move: renaming through a shared gamertag ───────────────────────────────────
  await reset();
  {
    const { id: owner, personalId: personal } = await makeUserWithPersonal('owner');
    await addMapping(personal, 'GRIM_BuLLeTzZz', 'Nillan');

    // A squad that already has its own roster is NOT seeded, so the two squads disagree
    // about what to call the same gamertag — the case Phase 6 exists to reconcile.
    const squad = await createSquad(owner, 'Other Group');
    await pgPool.query('DELETE FROM player_mappings WHERE "squadId" = $1', [squad.id]);
    await addMapping(squad.id, 'GRIM_BuLLeTzZz', 'Nil');

    const moving = await makeRichGame(personal, owner, { player: 'Nillan' });
    const staying = await makeRichGame(personal, owner, { player: 'Nillan' });

    const result = await moveGamesToSquad(owner, squad.id, [moving]);

    check('renames through the shared gamertag', result.renamed, [{ from: 'Nillan', to: 'Nil' }]);
    check(
      '  …player row is renamed',
      await scalar('SELECT COUNT(*)::int AS v FROM players WHERE "gameId" = $1 AND name = $2', [moving, 'Nil']),
      1,
    );
    check(
      '  …the composite lineup string is rewritten too',
      await scalar('SELECT "homeTeam" AS v FROM games WHERE id = $1', [moving]),
      'Nil (PG) + AI (SG)',
    );
    check(
      '  …and so is the teams row',
      await scalar('SELECT COUNT(*)::int AS v FROM teams WHERE "gameId" = $1 AND name = $2', [moving, 'Nil (PG) + AI (SG)']),
      1,
    );
    check('  …lineup invariant still holds', await orphanedLineups(squad.id), 0);

    // The requirement that makes the rename safe: it is scoped to the moved games, so a
    // game left behind in the source squad keeps that squad's own naming.
    check(
      'a game left in the source squad is NOT renamed',
      await scalar('SELECT COUNT(*)::int AS v FROM players WHERE "gameId" = $1 AND name = $2', [staying, 'Nillan']),
      1,
    );
    check(
      '  …and keeps its own lineup string',
      await scalar('SELECT "homeTeam" AS v FROM games WHERE id = $1', [staying]),
      'Nillan (PG) + AI (SG)',
    );
    check('  …source lineup invariant holds', await orphanedLineups(personal), 0);

    // player_totals has no decrement path, so the source must be rebuilt or the moved
    // game stays in its totals forever.
    check(
      'aggregates rebuilt for the source scope',
      await scalar('SELECT COALESCE(SUM(total_games),0)::int AS v FROM player_totals WHERE squadid = $1', [personal]),
      1,
    );
    check(
      'aggregates rebuilt for the target scope',
      await scalar('SELECT COALESCE(SUM(total_games),0)::int AS v FROM player_totals WHERE squadid = $1', [squad.id]),
      1,
    );
  }

  // ── Move: permissions and refusals ─────────────────────────────────────────────
  await reset();
  {
    const { id: owner, personalId: ownerPersonal } = await makeUserWithPersonal('owner');
    const { id: member, personalId: memberPersonal } = await makeUserWithPersonal('member');
    const { id: outsider, personalId: outsiderPersonal } = await makeUserWithPersonal('outsider');
    const squad = await createSquad(owner, 'Squad');
    await pgPool.query(
      `INSERT INTO squad_members (id, "squadId", "userId", role, "joinedAt")
       VALUES (gen_random_uuid()::text, $1, $2, 'MEMBER', NOW())`,
      [squad.id, member],
    );

    // Moving a game OUT is a deletion from the source squad's point of view, so a plain
    // member must not be able to walk off with the group's history.
    const squadGame = await makeRichGame(squad.id, owner, { player: 'Akif' });
    check(
      "a member moving another's game out of the squad → 403",
      await statusOf(() => moveGamesToSquad(member, memberPersonal, [squadGame])),
      403,
    );
    check(
      '  …and the game does not move',
      await scalar('SELECT "squadId" AS v FROM games WHERE id = $1', [squadGame]),
      squad.id,
    );

    // But their own upload is theirs to take.
    const ownUpload = await makeRichGame(squad.id, member, { player: 'Akif' });
    check(
      'a member CAN move a game they uploaded',
      (await moveGamesToSquad(member, memberPersonal, [ownUpload])).moved.length,
      1,
    );

    // The owner may move anything out of their own squad.
    check(
      'the squad owner can move a game they did not upload',
      (await moveGamesToSquad(owner, ownerPersonal, [squadGame])).moved.length,
      1,
    );

    // A squad the caller is not in must look like it does not exist.
    const foreign = await makeRichGame(outsiderPersonal, outsider, { player: 'Akif' });
    check(
      "moving another squad's game → 404, not 403",
      await statusOf(() => moveGamesToSquad(owner, ownerPersonal, [foreign])),
      404,
    );
    check(
      'moving into a squad the caller is not in → 404',
      await statusOf(() => moveGamesToSquad(outsider, squad.id, [foreign])),
      404,
    );
    check(
      'a nonexistent game id → 404',
      await statusOf(() => moveGamesToSquad(owner, ownerPersonal, ['nope'])),
      404,
    );
    check(
      '  …and the whole batch is refused, not partially applied',
      await scalar('SELECT "squadId" AS v FROM games WHERE id = $1', [foreign]),
      outsiderPersonal,
    );
  }

  // ── Move: refusing to merge two people ─────────────────────────────────────────
  await reset();
  {
    const { id: owner, personalId: personal } = await makeUserWithPersonal('owner');
    await addMapping(personal, 'tag_a', 'Nillan');
    await addMapping(personal, 'tag_b', 'Dylan');

    const squad = await createSquad(owner, 'Merged');
    await pgPool.query('DELETE FROM player_mappings WHERE "squadId" = $1', [squad.id]);
    // The target calls BOTH tags the same thing — applying this would sum two players.
    await addMapping(squad.id, 'tag_a', 'Nil');
    await addMapping(squad.id, 'tag_b', 'Nil');

    const g = await makeRichGame(personal, owner, { player: 'Nillan' });
    await pgPool.query(
      `UPDATE players SET name = 'Dylan' WHERE "gameId" = $1 AND name = 'AI Player'`,
      [g],
    );

    check(
      'a move that would merge two players → 409',
      await statusOf(() => moveGamesToSquad(owner, squad.id, [g])),
      409,
    );
    check(
      '  …and nothing is applied',
      await scalar('SELECT "squadId" AS v FROM games WHERE id = $1', [g]),
      personal,
    );
    check(
      '  …names untouched',
      await scalar('SELECT COUNT(*)::int AS v FROM players WHERE "gameId" = $1 AND name = $2', [g, 'Nillan']),
      1,
    );
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  await pgPool.end();
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
  console.error('HARNESS ERROR:', e);
  process.exit(1);
});
