export interface User {
  id: string;
  email: string;
  appleId: string | null;
  name: string | null;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Game {
  id: string;
  date: Date;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  screenshotUrl: string | null;
  processed: boolean;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
}

export interface Player {
  id: string;
  name: string;
  team: string;
  teammateGrade: string | null;
  gameIdFromFile: string; // GAME_ID from filename (e.g., "1754" from IMG_1754.jpg)
  playerId: string; // PLAYER_ID: GAME_ID + "-" + position (e.g., "1754-1")
  position: string; // Basketball position: PG, SG, SF, PF, C
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  fgMade: number;
  fgAttempted: number;
  threeMade: number;
  threeAttempted: number;
  ftMade: number;
  ftAttempted: number;
  createdAt: Date;
  updatedAt: Date;
  gameId: string;
  userId: string;
}

export interface Team {
  id: string;
  name: string;
  isHome: boolean;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  fgMade: number;
  fgAttempted: number;
  threeMade: number;
  threeAttempted: number;
  ftMade: number;
  ftAttempted: number;
  createdAt: Date;
  updatedAt: Date;
  gameId: string;
  userId: string;
}

export interface PlayerStats {
  id: string;
  playerName: string;
  team: string;
  teams?: Set<string>; // Optional field for tracking multiple teams during processing
  gamesPlayed: number;
  avgPoints: number;
  avgRebounds: number;
  avgAssists: number;
  avgSteals: number;
  avgBlocks: number;
  avgTurnovers: number;
  avgFouls: number;
  avgFgPercentage: number;
  avgThreePercentage: number;
  avgFtPercentage: number;
  avgPlusMinus: number;
  totalPoints: number;
  totalRebounds: number;
  totalAssists: number;
  totalSteals: number;
  totalBlocks: number;
  totalTurnovers: number;
  totalFouls: number;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
}

export interface AppleAuthRequest {
  identityToken: string;
  authorizationCode: string;
  user?: {
    name?: {
      firstName?: string;
      lastName?: string;
    };
    email?: string;
  };
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}



export interface BoxScoreData {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  players: PlayerData[];
  teams: TeamData[];
  teamAQuarters?: TeamQuarterTotals;
  teamBQuarters?: TeamQuarterTotals;
}

export interface PlayerData {
  id?: string | undefined; // ✅ ID from OCR service (can be undefined)
  name: string;
  team: string;
  teammateGrade: string;
  gameIdFromFile: string; // GAME_ID from filename (e.g., "1754" from IMG_1754.jpg)
  playerId: string; // PLAYER_ID: GAME_ID + "-" + position (e.g., "1754-1")
  position: string; // Basketball position: PG, SG, SF, PF, C
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  fgMade: number;
  fgAttempted: number;
  fgPercentage: number;
  threeMade: number;
  threeAttempted: number;
  threePercentage: number;
  ftMade: number;
  ftAttempted: number;
  ftPercentage: number;
}

export interface TeamData {
  name: string;
  isHome: boolean;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  fgMade: number;
  fgAttempted: number;
  threeMade: number;
  threeAttempted: number;
  ftMade: number;
  ftAttempted: number;
}

export interface AnalyticsData {
  playerStats: PlayerStats[];
  teamStats: {
    name: string;
    gamesPlayed: number;
    avgPoints: number;
    avgRebounds: number;
    avgAssists: number;
    wins: number;
    losses: number;
  }[];
  recentGames: Game[];
  topPerformers: {
    points: PlayerStats[];
    rebounds: PlayerStats[];
    assists: PlayerStats[];
  };
  gameHighs: {
    points: any[];
    rebounds: any[];
    assists: any[];
    steals: any[];
    blocks: any[];
    threeMade: any[];
  };
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Vision API related types
export interface TextBlock {
  description: string;
  boundingPoly: {
    vertices: Array<{ x: number; y: number }>;
  };
}

export interface VisionApiResponse {
  text: string;
  confidence: number;
  boundingBox: {
    vertices: Array<{ x: number; y: number }>;
  } | null;
}

export interface ExtractedRow {
  id?: string | undefined; // ✅ ID from OCR service (can be undefined)
  playerName: string;
  team: string; // ✅ Add team property to preserve team assignments
  teammateGrade: string;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  fouls: number;
  turnovers: number;
  fgMade: number;
  fgAttempted: number;
  threeMade: number;
  threeAttempted: number;
  ftMade: number;
  ftAttempted: number;
}

export interface GameData {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  quarters: number;
}

export interface TeamQuarterTotals {
  Q1: number;
  Q2: number;
  Q3: number;
  Q4: number;
}
