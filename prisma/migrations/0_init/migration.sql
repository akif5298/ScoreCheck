-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "appleId" TEXT,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "homeScore" INTEGER NOT NULL,
    "awayScore" INTEGER NOT NULL,
    "screenshotUrl" TEXT,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "imageHash" TEXT,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "teammateGrade" TEXT,
    "gameIdFromFile" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "rebounds" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "steals" INTEGER NOT NULL DEFAULT 0,
    "blocks" INTEGER NOT NULL DEFAULT 0,
    "turnovers" INTEGER NOT NULL DEFAULT 0,
    "fouls" INTEGER NOT NULL DEFAULT 0,
    "fgMade" INTEGER NOT NULL DEFAULT 0,
    "fgAttempted" INTEGER NOT NULL DEFAULT 0,
    "threeMade" INTEGER NOT NULL DEFAULT 0,
    "threeAttempted" INTEGER NOT NULL DEFAULT 0,
    "ftMade" INTEGER NOT NULL DEFAULT 0,
    "ftAttempted" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fg_percentage" DECIMAL(5,2) DEFAULT 0.00,
    "three_percentage" DECIMAL(5,2) DEFAULT 0.00,
    "ft_percentage" DECIMAL(5,2) DEFAULT 0.00,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isHome" BOOLEAN NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "rebounds" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "steals" INTEGER NOT NULL DEFAULT 0,
    "blocks" INTEGER NOT NULL DEFAULT 0,
    "turnovers" INTEGER NOT NULL DEFAULT 0,
    "fouls" INTEGER NOT NULL DEFAULT 0,
    "fgMade" INTEGER NOT NULL DEFAULT 0,
    "fgAttempted" INTEGER NOT NULL DEFAULT 0,
    "threeMade" INTEGER NOT NULL DEFAULT 0,
    "threeAttempted" INTEGER NOT NULL DEFAULT 0,
    "ftMade" INTEGER NOT NULL DEFAULT 0,
    "ftAttempted" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fg_percentage" DECIMAL(5,2) DEFAULT 0.00,
    "three_percentage" DECIMAL(5,2) DEFAULT 0.00,
    "ft_percentage" DECIMAL(5,2) DEFAULT 0.00,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_mappings" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "userId" TEXT NOT NULL,
    "gamertag" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_stats" (
    "id" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "avgPoints" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgRebounds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgAssists" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgSteals" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgBlocks" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgTurnovers" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgFouls" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgFgPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgThreePercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgFtPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgPlusMinus" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "totalRebounds" INTEGER NOT NULL DEFAULT 0,
    "totalAssists" INTEGER NOT NULL DEFAULT 0,
    "totalSteals" INTEGER NOT NULL DEFAULT 0,
    "totalBlocks" INTEGER NOT NULL DEFAULT 0,
    "totalTurnovers" INTEGER NOT NULL DEFAULT 0,
    "totalFouls" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "totalfgmade" INTEGER NOT NULL DEFAULT 0,
    "totalfgattempted" INTEGER NOT NULL DEFAULT 0,
    "totalthreemade" INTEGER NOT NULL DEFAULT 0,
    "totalthreeattempted" INTEGER NOT NULL DEFAULT 0,
    "totalftmade" INTEGER NOT NULL DEFAULT 0,
    "totalftattempted" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "player_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_totals" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "player_name" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "total_games" INTEGER DEFAULT 0,
    "total_points" INTEGER DEFAULT 0,
    "total_assists" INTEGER DEFAULT 0,
    "total_rebounds" INTEGER DEFAULT 0,
    "total_steals" INTEGER DEFAULT 0,
    "total_blocks" INTEGER DEFAULT 0,
    "total_fouls" INTEGER DEFAULT 0,
    "total_turnovers" INTEGER DEFAULT 0,
    "total_fgm" INTEGER DEFAULT 0,
    "total_fga" INTEGER DEFAULT 0,
    "total_3pm" INTEGER DEFAULT 0,
    "total_3pa" INTEGER DEFAULT 0,
    "total_ftm" INTEGER DEFAULT 0,
    "total_fta" INTEGER DEFAULT 0,
    "fg_percentage" DECIMAL DEFAULT 0.00,
    "three_percentage" DECIMAL DEFAULT 0.00,
    "ft_percentage" DECIMAL DEFAULT 0.00,
    "createdat" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedat" TIMESTAMP(6) NOT NULL,
    "userid" TEXT NOT NULL,

    CONSTRAINT "player_totals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_appleId_key" ON "users"("appleId");

-- CreateIndex
CREATE UNIQUE INDEX "players_gameId_name_team_key" ON "players"("gameId", "name", "team");

-- CreateIndex
CREATE UNIQUE INDEX "teams_gameId_name_key" ON "teams"("gameId", "name");

-- CreateIndex
CREATE INDEX "player_mappings_userid_idx" ON "player_mappings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "player_mappings_userid_gamertag_key" ON "player_mappings"("userId", "gamertag");

-- CreateIndex
CREATE UNIQUE INDEX "player_stats_userId_playerName_team_key" ON "player_stats"("userId", "playerName", "team");

-- CreateIndex
CREATE UNIQUE INDEX "player_stats_player_name_userid_unique" ON "player_stats"("playerName", "userId");

-- CreateIndex
CREATE INDEX "idx_player_totals_player_id" ON "player_totals"("player_id");

-- CreateIndex
CREATE INDEX "idx_player_totals_team" ON "player_totals"("team");

-- CreateIndex
CREATE INDEX "idx_player_totals_userid" ON "player_totals"("userid");

-- CreateIndex
CREATE UNIQUE INDEX "player_totals_player_id_unique" ON "player_totals"("player_id", "userid");

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_totals" ADD CONSTRAINT "player_totals_userid_fkey" FOREIGN KEY ("userid") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

