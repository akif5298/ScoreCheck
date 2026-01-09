-- CreateTable
CREATE TABLE "player_totals" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "player_name" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "total_games" INTEGER NOT NULL DEFAULT 1,
    "total_points" INTEGER NOT NULL DEFAULT 0,
    "total_assists" INTEGER NOT NULL DEFAULT 0,
    "total_rebounds" INTEGER NOT NULL DEFAULT 0,
    "total_steals" INTEGER NOT NULL DEFAULT 0,
    "total_blocks" INTEGER NOT NULL DEFAULT 0,
    "total_fouls" INTEGER NOT NULL DEFAULT 0,
    "total_turnovers" INTEGER NOT NULL DEFAULT 0,
    "total_fgm" INTEGER NOT NULL DEFAULT 0,
    "total_fga" INTEGER NOT NULL DEFAULT 0,
    "total_3pm" INTEGER NOT NULL DEFAULT 0,
    "total_3pa" INTEGER NOT NULL DEFAULT 0,
    "total_ftm" INTEGER NOT NULL DEFAULT 0,
    "total_fta" INTEGER NOT NULL DEFAULT 0,
    "fg_percentage" DOUBLE PRECISION NOT NULL DEFAULT 0.00,
    "three_percentage" DOUBLE PRECISION NOT NULL DEFAULT 0.00,
    "ft_percentage" DOUBLE PRECISION NOT NULL DEFAULT 0.00,
    "createdat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userid" TEXT NOT NULL,

    CONSTRAINT "player_totals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "player_totals_player_name_team_userid_key" ON "player_totals"("player_name", "team", "userid");

-- AddForeignKey
ALTER TABLE "player_totals" ADD CONSTRAINT "player_totals_userid_fkey" FOREIGN KEY ("userid") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
