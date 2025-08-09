-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "appleId" TEXT,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "homeScore" INTEGER NOT NULL,
    "awayScore" INTEGER NOT NULL,
    "screenshotUrl" TEXT,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "games_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "position" TEXT,
    "minutes" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "rebounds" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "steals" INTEGER NOT NULL DEFAULT 0,
    "blocks" INTEGER NOT NULL DEFAULT 0,
    "turnovers" INTEGER NOT NULL DEFAULT 0,
    "fouls" INTEGER NOT NULL DEFAULT 0,
    "fgMade" INTEGER NOT NULL DEFAULT 0,
    "fgAttempted" INTEGER NOT NULL DEFAULT 0,
    "fgPercentage" REAL DEFAULT 0,
    "threeMade" INTEGER NOT NULL DEFAULT 0,
    "threeAttempted" INTEGER NOT NULL DEFAULT 0,
    "threePercentage" REAL DEFAULT 0,
    "ftMade" INTEGER NOT NULL DEFAULT 0,
    "ftAttempted" INTEGER NOT NULL DEFAULT 0,
    "ftPercentage" REAL DEFAULT 0,
    "plusMinus" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "players_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "players_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "fgPercentage" REAL DEFAULT 0,
    "threeMade" INTEGER NOT NULL DEFAULT 0,
    "threeAttempted" INTEGER NOT NULL DEFAULT 0,
    "threePercentage" REAL DEFAULT 0,
    "ftMade" INTEGER NOT NULL DEFAULT 0,
    "ftAttempted" INTEGER NOT NULL DEFAULT 0,
    "ftPercentage" REAL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "teams_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "teams_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "player_stats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerName" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "avgPoints" REAL NOT NULL DEFAULT 0,
    "avgRebounds" REAL NOT NULL DEFAULT 0,
    "avgAssists" REAL NOT NULL DEFAULT 0,
    "avgSteals" REAL NOT NULL DEFAULT 0,
    "avgBlocks" REAL NOT NULL DEFAULT 0,
    "avgTurnovers" REAL NOT NULL DEFAULT 0,
    "avgFouls" REAL NOT NULL DEFAULT 0,
    "avgFgPercentage" REAL NOT NULL DEFAULT 0,
    "avgThreePercentage" REAL NOT NULL DEFAULT 0,
    "avgFtPercentage" REAL NOT NULL DEFAULT 0,
    "avgPlusMinus" REAL NOT NULL DEFAULT 0,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "totalRebounds" INTEGER NOT NULL DEFAULT 0,
    "totalAssists" INTEGER NOT NULL DEFAULT 0,
    "totalSteals" INTEGER NOT NULL DEFAULT 0,
    "totalBlocks" INTEGER NOT NULL DEFAULT 0,
    "totalTurnovers" INTEGER NOT NULL DEFAULT 0,
    "totalFouls" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "player_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
CREATE UNIQUE INDEX "player_stats_userId_playerName_team_key" ON "player_stats"("userId", "playerName", "team");
