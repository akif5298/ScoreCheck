-- Squad ownership model.
--
-- Moves the access-control key of every data table from userId to squadId. Every existing
-- user gets an auto-created personal squad (a squad of one) and all their rows are
-- reassigned to it, so this migration is BEHAVIOUR-NEUTRAL: each user still sees exactly
-- the data they saw before.
--
-- Written by hand. `prisma migrate diff` proposes
--     ALTER TABLE "games" DROP COLUMN "userId", ADD COLUMN "squadId" TEXT NOT NULL;
-- which drops the ownership data and then fails on existing rows. The pattern below is
-- add-nullable → backfill → assert → set-not-null → drop-old.
--
-- Authored with `prisma migrate diff` for the CREATE TABLE / index / FK statements; Supabase
-- has no shadow DB so `migrate dev` is never used here (see DEV_HANDOFF §10).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. New tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "squads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isPersonal" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "squads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "squad_members" (
    "id" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "squad_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "squad_invites" (
    "id" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 0,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "squad_invites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "game_edit_locks" (
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_edit_locks_pkey" PRIMARY KEY ("gameId")
);

CREATE TABLE "squad_audit_log" (
    "id" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "squad_audit_log_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Give every existing user a personal squad and make it active
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "users" ADD COLUMN "activeSquadId" TEXT;

INSERT INTO "squads" ("id", "name", "isPersonal", "createdByUserId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Personal', true, u."id", NOW(), NOW()
FROM "users" u;

INSERT INTO "squad_members" ("id", "squadId", "userId", "role", "joinedAt")
SELECT gen_random_uuid()::text, s."id", s."createdByUserId", 'OWNER', NOW()
FROM "squads" s
WHERE s."isPersonal" = true;

UPDATE "users" u
SET "activeSquadId" = s."id"
FROM "squads" s
WHERE s."createdByUserId" = u."id" AND s."isPersonal" = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Add the new scope columns as NULLABLE, then backfill from the owning user
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "games"           ADD COLUMN "squadId" TEXT;
ALTER TABLE "players"         ADD COLUMN "squadId" TEXT;
ALTER TABLE "teams"           ADD COLUMN "squadId" TEXT;
ALTER TABLE "player_stats"    ADD COLUMN "squadId" TEXT;
ALTER TABLE "player_mappings" ADD COLUMN "squadId" TEXT;
ALTER TABLE "player_mappings" ADD COLUMN "linkedUserId" TEXT;
-- player_totals uses lowercase column names throughout; kept consistent within that table.
ALTER TABLE "player_totals"   ADD COLUMN "squadid" TEXT;

UPDATE "games" g           SET "squadId" = s."id" FROM "squads" s WHERE s."createdByUserId" = g."userId"  AND s."isPersonal" = true;
UPDATE "players" p         SET "squadId" = s."id" FROM "squads" s WHERE s."createdByUserId" = p."userId"  AND s."isPersonal" = true;
UPDATE "teams" t           SET "squadId" = s."id" FROM "squads" s WHERE s."createdByUserId" = t."userId"  AND s."isPersonal" = true;
UPDATE "player_stats" ps   SET "squadId" = s."id" FROM "squads" s WHERE s."createdByUserId" = ps."userId" AND s."isPersonal" = true;
UPDATE "player_mappings" pm SET "squadId" = s."id" FROM "squads" s WHERE s."createdByUserId" = pm."userId" AND s."isPersonal" = true;
UPDATE "player_totals" pt  SET "squadid" = s."id" FROM "squads" s WHERE s."createdByUserId" = pt."userid" AND s."isPersonal" = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Abort loudly rather than silently orphaning rows
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE orphans INTEGER;
BEGIN
  SELECT
    (SELECT COUNT(*) FROM "games"           WHERE "squadId" IS NULL)
  + (SELECT COUNT(*) FROM "players"         WHERE "squadId" IS NULL)
  + (SELECT COUNT(*) FROM "teams"           WHERE "squadId" IS NULL)
  + (SELECT COUNT(*) FROM "player_stats"    WHERE "squadId" IS NULL)
  + (SELECT COUNT(*) FROM "player_mappings" WHERE "squadId" IS NULL)
  + (SELECT COUNT(*) FROM "player_totals"   WHERE "squadid" IS NULL)
  INTO orphans;

  IF orphans > 0 THEN
    RAISE EXCEPTION 'squad backfill incomplete: % row(s) still have a NULL squad scope', orphans;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Rename games.userId → uploadedByUserId (value preserved: attribution + delete rights)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "games" DROP CONSTRAINT "games_userId_fkey";
ALTER TABLE "games" RENAME COLUMN "userId" TO "uploadedByUserId";

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Lock the new columns down
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "games"           ALTER COLUMN "squadId" SET NOT NULL;
ALTER TABLE "players"         ALTER COLUMN "squadId" SET NOT NULL;
ALTER TABLE "teams"           ALTER COLUMN "squadId" SET NOT NULL;
ALTER TABLE "player_stats"    ALTER COLUMN "squadId" SET NOT NULL;
ALTER TABLE "player_mappings" ALTER COLUMN "squadId" SET NOT NULL;
ALTER TABLE "player_totals"   ALTER COLUMN "squadid" SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Retire the old user-scoped constraints, indexes and columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "players"       DROP CONSTRAINT "players_userId_fkey";
ALTER TABLE "teams"         DROP CONSTRAINT "teams_userId_fkey";
ALTER TABLE "player_stats"  DROP CONSTRAINT "player_stats_userId_fkey";
ALTER TABLE "player_totals" DROP CONSTRAINT "player_totals_userid_fkey";

-- These six objects are UNIQUE CONSTRAINTS on some databases and plain INDEXES on others:
-- the live schema was `db pull`-ed and baselined, so prisma/migrations/0_init does not
-- reproduce production DDL exactly. A bare DROP INDEX fails on a constraint-backed index
-- ("cannot drop index ... because constraint ... requires it"), so detect and use the
-- right statement for whichever shape is actually present.
DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('player_mappings', 'player_mappings_userid_gamertag_key'),
      ('player_mappings', 'player_mappings_userid_idx'),
      ('player_stats',    'player_stats_player_name_userid_unique'),
      ('player_stats',    'player_stats_userId_playerName_team_key'),
      ('player_totals',   'idx_player_totals_userid'),
      ('player_totals',   'player_totals_player_id_unique')
    ) AS t(tbl, obj)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = rec.obj AND connamespace = 'public'::regnamespace
    ) THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', rec.tbl, rec.obj);
    ELSE
      EXECUTE format('DROP INDEX IF EXISTS %I', rec.obj);
    END IF;
  END LOOP;
END $$;

ALTER TABLE "players"         DROP COLUMN "userId";
ALTER TABLE "teams"           DROP COLUMN "userId";
ALTER TABLE "player_stats"    DROP COLUMN "userId";
ALTER TABLE "player_mappings" DROP COLUMN "userId";
ALTER TABLE "player_totals"   DROP COLUMN "userid";

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. New indexes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX "squads_createdByUserId_idx" ON "squads"("createdByUserId");
CREATE INDEX "squad_members_userId_idx" ON "squad_members"("userId");
CREATE UNIQUE INDEX "squad_members_squadId_userId_key" ON "squad_members"("squadId", "userId");
CREATE UNIQUE INDEX "squad_invites_token_key" ON "squad_invites"("token");
CREATE INDEX "squad_invites_squadId_idx" ON "squad_invites"("squadId");
CREATE INDEX "game_edit_locks_expiresAt_idx" ON "game_edit_locks"("expiresAt");
CREATE INDEX "squad_audit_log_squadId_createdAt_idx" ON "squad_audit_log"("squadId", "createdAt");
CREATE INDEX "squad_audit_log_entityId_idx" ON "squad_audit_log"("entityId");

CREATE INDEX "games_squadId_idx" ON "games"("squadId");
-- Serves the squad-scoped perceptual-hash duplicate check on upload.
CREATE INDEX "games_squadId_imageHash_idx" ON "games"("squadId", "imageHash");
CREATE INDEX "players_squadId_idx" ON "players"("squadId");
CREATE INDEX "teams_squadId_idx" ON "teams"("squadId");

CREATE INDEX "player_mappings_squadid_idx" ON "player_mappings"("squadId");
CREATE UNIQUE INDEX "player_mappings_squadid_gamertag_key" ON "player_mappings"("squadId", "gamertag");
-- One roster entry per user per squad: stops two people claiming the same identity.
CREATE UNIQUE INDEX "player_mappings_squadid_linkeduserid_key" ON "player_mappings"("squadId", "linkedUserId");

CREATE UNIQUE INDEX "player_stats_squadId_playerName_team_key" ON "player_stats"("squadId", "playerName", "team");
CREATE UNIQUE INDEX "player_stats_player_name_squadid_unique" ON "player_stats"("playerName", "squadId");

CREATE INDEX "idx_player_totals_squadid" ON "player_totals"("squadid");
CREATE UNIQUE INDEX "player_totals_player_id_unique" ON "player_totals"("player_id", "squadid");

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Foreign keys
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "users" ADD CONSTRAINT "users_activeSquadId_fkey" FOREIGN KEY ("activeSquadId") REFERENCES "squads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "squads" ADD CONSTRAINT "squads_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "squad_members" ADD CONSTRAINT "squad_members_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "squads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "squad_members" ADD CONSTRAINT "squad_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "squad_invites" ADD CONSTRAINT "squad_invites_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "squads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "squad_invites" ADD CONSTRAINT "squad_invites_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_edit_locks" ADD CONSTRAINT "game_edit_locks_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_edit_locks" ADD CONSTRAINT "game_edit_locks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "squad_audit_log" ADD CONSTRAINT "squad_audit_log_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "squads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "squad_audit_log" ADD CONSTRAINT "squad_audit_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "games" ADD CONSTRAINT "games_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "squads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "games" ADD CONSTRAINT "games_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "players" ADD CONSTRAINT "players_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "squads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "squads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "player_mappings" ADD CONSTRAINT "player_mappings_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "squads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "player_mappings" ADD CONSTRAINT "player_mappings_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "squads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "player_totals" ADD CONSTRAINT "player_totals_squadid_fkey" FOREIGN KEY ("squadid") REFERENCES "squads"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
