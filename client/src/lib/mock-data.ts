export type Player = {
  id: string;
  name: string;
  team: "Home" | "Away";
  teamName: string;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  to: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  min: number;
  plusMinus: number;
};

export type Game = {
  id: string;
  date: string;
  home: { name: string; score: number; abbr: string };
  away: { name: string; score: number; abbr: string };
  uploadedBy: string;
  ocrConfidence: number;
  status: "verified" | "pending" | "review";
  players: Player[];
};

const mk = (name: string, team: "Home" | "Away", teamName: string, s: Partial<Player>): Player => ({
  id: crypto.randomUUID(),
  name,
  team,
  teamName,
  pts: 0,
  reb: 0,
  ast: 0,
  stl: 0,
  blk: 0,
  to: 0,
  fgm: 0,
  fga: 0,
  tpm: 0,
  tpa: 0,
  ftm: 0,
  fta: 0,
  min: 0,
  plusMinus: 0,
  ...s,
});

export const recentGames: Game[] = [
  {
    id: "g1",
    date: "2026-06-22",
    home: { name: "Lakers", abbr: "LAL", score: 118 },
    away: { name: "Celtics", abbr: "BOS", score: 112 },
    uploadedBy: "marcus",
    ocrConfidence: 99.2,
    status: "verified",
    players: [
      mk("L. James", "Home", "Lakers", {
        pts: 34,
        reb: 9,
        ast: 11,
        stl: 2,
        blk: 1,
        to: 3,
        fgm: 12,
        fga: 21,
        tpm: 4,
        tpa: 8,
        ftm: 6,
        fta: 7,
        min: 38,
        plusMinus: 14,
      }),
      mk("A. Davis", "Home", "Lakers", {
        pts: 28,
        reb: 14,
        ast: 3,
        stl: 1,
        blk: 4,
        to: 2,
        fgm: 10,
        fga: 17,
        tpm: 0,
        tpa: 1,
        ftm: 8,
        fta: 9,
        min: 36,
        plusMinus: 9,
      }),
      mk("A. Reaves", "Home", "Lakers", {
        pts: 19,
        reb: 4,
        ast: 6,
        stl: 1,
        blk: 0,
        to: 1,
        fgm: 7,
        fga: 13,
        tpm: 3,
        tpa: 6,
        ftm: 2,
        fta: 2,
        min: 33,
        plusMinus: 6,
      }),
      mk("J. Tatum", "Away", "Celtics", {
        pts: 31,
        reb: 8,
        ast: 5,
        stl: 0,
        blk: 1,
        to: 4,
        fgm: 11,
        fga: 24,
        tpm: 4,
        tpa: 11,
        ftm: 5,
        fta: 6,
        min: 39,
        plusMinus: -6,
      }),
      mk("J. Brown", "Away", "Celtics", {
        pts: 26,
        reb: 6,
        ast: 3,
        stl: 2,
        blk: 0,
        to: 2,
        fgm: 10,
        fga: 19,
        tpm: 3,
        tpa: 8,
        ftm: 3,
        fta: 4,
        min: 36,
        plusMinus: -4,
      }),
      mk("D. White", "Away", "Celtics", {
        pts: 17,
        reb: 3,
        ast: 7,
        stl: 1,
        blk: 1,
        to: 1,
        fgm: 6,
        fga: 11,
        tpm: 3,
        tpa: 5,
        ftm: 2,
        fta: 2,
        min: 32,
        plusMinus: -3,
      }),
    ],
  },
  {
    id: "g2",
    date: "2026-06-20",
    home: { name: "Warriors", abbr: "GSW", score: 124 },
    away: { name: "Suns", abbr: "PHX", score: 119 },
    uploadedBy: "jess",
    ocrConfidence: 100,
    status: "verified",
    players: [
      mk("S. Curry", "Home", "Warriors", {
        pts: 41,
        reb: 5,
        ast: 8,
        stl: 3,
        blk: 0,
        to: 2,
        fgm: 13,
        fga: 22,
        tpm: 8,
        tpa: 14,
        ftm: 7,
        fta: 7,
        min: 37,
        plusMinus: 11,
      }),
      mk("K. Thompson", "Home", "Warriors", {
        pts: 22,
        reb: 4,
        ast: 2,
        stl: 1,
        blk: 0,
        to: 1,
        fgm: 8,
        fga: 16,
        tpm: 6,
        tpa: 11,
        ftm: 0,
        fta: 0,
        min: 33,
        plusMinus: 7,
      }),
      mk("K. Durant", "Away", "Suns", {
        pts: 36,
        reb: 7,
        ast: 5,
        stl: 1,
        blk: 2,
        to: 3,
        fgm: 13,
        fga: 23,
        tpm: 3,
        tpa: 7,
        ftm: 7,
        fta: 8,
        min: 38,
        plusMinus: -8,
      }),
      mk("D. Booker", "Away", "Suns", {
        pts: 29,
        reb: 4,
        ast: 7,
        stl: 0,
        blk: 0,
        to: 4,
        fgm: 10,
        fga: 21,
        tpm: 4,
        tpa: 9,
        ftm: 5,
        fta: 6,
        min: 36,
        plusMinus: -5,
      }),
    ],
  },
  {
    id: "g3",
    date: "2026-06-18",
    home: { name: "Nuggets", abbr: "DEN", score: 109 },
    away: { name: "Heat", abbr: "MIA", score: 114 },
    uploadedBy: "marcus",
    ocrConfidence: 97.4,
    status: "review",
    players: [
      mk("N. Jokic", "Home", "Nuggets", {
        pts: 32,
        reb: 16,
        ast: 12,
        stl: 1,
        blk: 1,
        to: 5,
        fgm: 12,
        fga: 20,
        tpm: 2,
        tpa: 5,
        ftm: 6,
        fta: 7,
        min: 39,
        plusMinus: -2,
      }),
      mk("J. Murray", "Home", "Nuggets", {
        pts: 24,
        reb: 4,
        ast: 7,
        stl: 2,
        blk: 0,
        to: 3,
        fgm: 9,
        fga: 19,
        tpm: 3,
        tpa: 7,
        ftm: 3,
        fta: 3,
        min: 36,
        plusMinus: -4,
      }),
      mk("J. Butler", "Away", "Heat", {
        pts: 28,
        reb: 7,
        ast: 6,
        stl: 3,
        blk: 1,
        to: 2,
        fgm: 9,
        fga: 17,
        tpm: 1,
        tpa: 3,
        ftm: 9,
        fta: 11,
        min: 38,
        plusMinus: 5,
      }),
      mk("B. Adebayo", "Away", "Heat", {
        pts: 22,
        reb: 11,
        ast: 4,
        stl: 1,
        blk: 2,
        to: 1,
        fgm: 9,
        fga: 14,
        tpm: 0,
        tpa: 0,
        ftm: 4,
        fta: 5,
        min: 36,
        plusMinus: 7,
      }),
    ],
  },
];

export type Aggregate = {
  player: string;
  team: string;
  games: number;
  ppg: number;
  rpg: number;
  apg: number;
  fgPct: number;
  tpPct: number;
};

export function aggregatePlayers(): Aggregate[] {
  const map = new Map<string, { p: Player[]; team: string }>();
  for (const g of recentGames) {
    for (const p of g.players) {
      const key = p.name;
      if (!map.has(key)) map.set(key, { p: [], team: p.teamName });
      map.get(key)!.p.push(p);
    }
  }
  return Array.from(map.entries())
    .map(([player, { p, team }]) => {
      const n = p.length;
      const sum = (k: keyof Player) => p.reduce((a, x) => a + (x[k] as number), 0);
      return {
        player,
        team,
        games: n,
        ppg: +(sum("pts") / n).toFixed(1),
        rpg: +(sum("reb") / n).toFixed(1),
        apg: +(sum("ast") / n).toFixed(1),
        fgPct: +((sum("fgm") / Math.max(1, sum("fga"))) * 100).toFixed(1),
        tpPct: +((sum("tpm") / Math.max(1, sum("tpa"))) * 100).toFixed(1),
      };
    })
    .sort((a, b) => b.ppg - a.ppg);
}

export const adminStats = {
  totalUsers: 12,
  totalGames: 147,
  totalScreenshots: 163,
  avgConfidence: 98.6,
  pendingReview: 3,
};
