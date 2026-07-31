/**
 * The save pipeline for a reviewed box score.
 *
 * Extracted from the body of POST /api/screenshots/save, which had grown to ~330 lines —
 * a third of its route file. Everything here is what happens between "the user confirmed
 * the stats" and "the squad's aggregates reflect them"; the route is left owning only
 * request validation and the mapping of an outcome to a status code.
 *
 * Three invariants live here and must not drift:
 *
 *   1. The pending perceptual hash is cleared only on a TERMINAL outcome. A save that
 *      throws leaves it in place so a retry still persists it — deleting it up front once
 *      left retried games with a null imageHash, permanently invisible to duplicate
 *      detection. See services/pendingHashes.ts.
 *
 *   2. Losing the save-time dedup race is a SUCCESS, not a failure. The game the user was
 *      saving is in the squad; reporting 500 would tell them it was lost when it was not.
 *
 *   3. A failed aggregate rebuild must not fail the save. The game is already committed by
 *      then, and the rebuild is idempotent, so the next write in the squad repairs it.
 *
 * The three outcomes are kept distinct rather than collapsed into created/duplicate because
 * the route answers them with different cache headers — see the handler.
 */
import { randomUUID } from 'node:crypto';
import supabaseService, { DuplicateGameError } from '@/services/supabase';
import { UploadExpiredError } from '@/errors';
import { pendingHashes } from '@/services/pendingHashes';
import { Game, Player } from '@/types';
import { extractImageNumber } from '@/utils/imageNumber';
import logger from '@/utils/logger';

/** Incoming player data shape from the review UI (all fields optional until validated). */
export interface IncomingPlayerData {
  id?: string;
  name?: string;
  team?: string;
  teammateGrade?: string;
  points?: number;
  rebounds?: number;
  assists?: number;
  steals?: number;
  blocks?: number;
  turnovers?: number;
  fouls?: number;
  fgMade?: number;
  fgAttempted?: number;
  threeMade?: number;
  threeAttempted?: number;
  ftMade?: number;
  ftAttempted?: number;
}

export interface ReviewedGameData {
  date?: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}

export interface SaveReviewedGameInput {
  squadId: string;
  /** Attribution + delete/move rights. Distinct from squadId, which controls access. */
  userId: string;
  gameData: ReviewedGameData;
  playersData: IncomingPlayerData[];
  imageUrl: string;
  // Explicitly `| undefined`: tsconfig sets exactOptionalPropertyTypes, so an optional
  // property does not otherwise accept an explicitly-passed undefined, which is exactly
  // what destructuring an absent field off the request body produces.
  originalFileName?: string | undefined;
}

export type SaveReviewedGameResult =
  /** Written by this request. */
  | { outcome: 'created'; game: Game; players: Player[] }
  /** This screenshot was already saved in the squad; nothing was written. */
  | { outcome: 'existing'; game: Game; players: Player[] }
  /** Another member committed the same screenshot while this one sat in review. */
  | { outcome: 'raceLost'; game: Game; players: Player[] };

// json_agg yields [null] for a game with no player rows, so strip nulls rather than
// surfacing them to the client.
function stripNullPlayers(players: unknown): Player[] {
  return ((players ?? []) as (Player | null)[]).filter((p): p is Player => p != null);
}

function pct(made: number, attempted: number): number {
  return attempted > 0 ? Math.round((made / attempted) * 100 * 100) / 100 : 0.0;
}

function getPositionFromPlayerNumber(playerNum: string): string {
  const num = parseInt(playerNum);
  if (num === 0 || num === 5) return 'PG';
  if (num === 1 || num === 6) return 'SG';
  if (num === 2 || num === 7) return 'SF';
  if (num === 3 || num === 8) return 'PF';
  if (num === 4 || num === 9) return 'C';
  return 'Unknown';
}

type TeamTotals = Record<
  | 'rebounds' | 'assists' | 'steals' | 'blocks' | 'turnovers' | 'fouls'
  | 'fgMade' | 'fgAttempted' | 'threeMade' | 'threeAttempted' | 'ftMade' | 'ftAttempted',
  number
>;

function sumTeamTotals(players: IncomingPlayerData[]): TeamTotals {
  const add = (key: keyof IncomingPlayerData) =>
    players.reduce((sum, p) => sum + ((p[key] as number) || 0), 0);
  return {
    rebounds: add('rebounds'),
    assists: add('assists'),
    steals: add('steals'),
    blocks: add('blocks'),
    turnovers: add('turnovers'),
    fouls: add('fouls'),
    fgMade: add('fgMade'),
    fgAttempted: add('fgAttempted'),
    threeMade: add('threeMade'),
    threeAttempted: add('threeAttempted'),
    ftMade: add('ftMade'),
    ftAttempted: add('ftAttempted'),
  };
}

function buildTeamInput(
  totals: TeamTotals,
  opts: { imageNumber: string; name: string; isHome: boolean; points: number; gameId: string; squadId: string },
) {
  return {
    id: `team_${opts.imageNumber}_${opts.isHome ? 'home' : 'away'}_${Math.random().toString(36).substr(2, 5)}`,
    name: opts.name,
    isHome: opts.isHome,
    points: opts.points,
    rebounds: totals.rebounds,
    assists: totals.assists,
    steals: totals.steals,
    blocks: totals.blocks,
    turnovers: totals.turnovers,
    fouls: totals.fouls,
    fgMade: totals.fgMade,
    fgAttempted: totals.fgAttempted,
    threeMade: totals.threeMade,
    threeAttempted: totals.threeAttempted,
    ftMade: totals.ftMade,
    ftAttempted: totals.ftAttempted,
    fg_percentage: pct(totals.fgMade, totals.fgAttempted),
    three_percentage: pct(totals.threeMade, totals.threeAttempted),
    ft_percentage: pct(totals.ftMade, totals.ftAttempted),
    gameId: opts.gameId,
    squadId: opts.squadId,
  };
}

export async function saveReviewedGame(
  input: SaveReviewedGameInput,
): Promise<SaveReviewedGameResult> {
  const { squadId, userId, gameData, playersData, imageUrl, originalFileName } = input;

  // Check if a game with this image URL already exists to prevent duplicates
  const existingGame = await supabaseService.getGameByScreenshotUrl(imageUrl, squadId);
  if (existingGame) {
    logger.info({ gameId: existingGame.id }, 'Duplicate save request — returning existing game');
    // Return this game's own players.
    const existingFull = await supabaseService.getGameById(existingGame.id, squadId);
    return {
      outcome: 'existing',
      game: existingGame,
      players: stripNullPlayers(existingFull?.players),
    };
  }

  // Pre-generate a stable ID so players and teams can reference the game
  // before the transaction commits, then save everything atomically.
  // UUID rather than Date.now(): two saves in the same millisecond collided, which
  // becomes far more likely once several people upload into a shared squad.
  const gameId = `game_${randomUUID()}`;

  // Extract image number from the original filename for gameIdFromFile
  const playerImageNumber = extractImageNumber(originalFileName);

  // Pre-compute all player write inputs (no DB calls yet)
  const playerInputs = playersData.map((playerData: IncomingPlayerData, index: number) => {
    const playerNumMatch = playerData.id?.match(/_(\d+)_/);
    const playerNumber = playerNumMatch?.[1] ?? (index + 1).toString();
    const playerId = `${playerImageNumber}_P${playerNumber}`;
    const position = getPositionFromPlayerNumber(playerNumber);
    const fgMade = Number(playerData.fgMade) || 0;
    const fgAttempted = Number(playerData.fgAttempted) || 0;
    const threeMade = Number(playerData.threeMade) || 0;
    const threeAttempted = Number(playerData.threeAttempted) || 0;
    const ftMade = Number(playerData.ftMade) || 0;
    const ftAttempted = Number(playerData.ftAttempted) || 0;
    return {
      id: playerData.id || `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: playerData.name || 'Unknown Player',
      team: playerData.team || 'Unknown Team',
      teammateGrade: playerData.teammateGrade || 'N/A',
      gameIdFromFile: playerImageNumber,
      playerId,
      position,
      points: playerData.points || 0,
      rebounds: playerData.rebounds || 0,
      assists: playerData.assists || 0,
      steals: playerData.steals || 0,
      blocks: playerData.blocks || 0,
      turnovers: playerData.turnovers || 0,
      fouls: playerData.fouls || 0,
      fgMade,
      fgAttempted,
      threeMade,
      threeAttempted,
      ftMade,
      ftAttempted,
      fg_percentage: pct(fgMade, fgAttempted),
      three_percentage: pct(threeMade, threeAttempted),
      ft_percentage: pct(ftMade, ftAttempted),
      gameId,
      squadId,
    };
  });

  // Pre-compute team totals from player data
  const homeTeamTotals = sumTeamTotals(playersData.filter((p) => p.team === gameData.homeTeam));
  const awayTeamTotals = sumTeamTotals(playersData.filter((p) => p.team === gameData.awayTeam));

  const homeTeamInput = buildTeamInput(homeTeamTotals, {
    imageNumber: playerImageNumber,
    name: gameData.homeTeam,
    isHome: true,
    points: gameData.homeScore,
    gameId,
    squadId,
  });

  const awayTeamInput = buildTeamInput(awayTeamTotals, {
    imageNumber: playerImageNumber,
    name: gameData.awayTeam,
    isHome: false,
    points: gameData.awayScore,
    gameId,
    squadId,
  });

  // Refuse a save whose upload has timed out, rather than quietly storing the game with no
  // perceptual hash. `expired` is only ever reported for a key the bridge actually held and
  // watched lapse, so a direct save — or one whose upload predates a restart — still falls
  // through to the null-hash path below exactly as before.
  if (pendingHashes.status(imageUrl) === 'expired') {
    logger.info({ squadId, imageUrl }, 'Save refused: the upload behind it has expired');
    throw new UploadExpiredError();
  }

  // Retrieve the perceptual hash stored at upload time (null if upload route not used).
  // Deliberately NOT removed from the map yet — if the save below throws, the entry must
  // survive so a retry still persists the hash. Deleting it up front left any retried game
  // with a null imageHash, i.e. permanently invisible to duplicate detection.
  const savedImageHash = pendingHashes.get(imageUrl) ?? null;

  // Atomic save: game + players + teams in a single transaction on a dedicated
  // pooled client, which also re-checks for a perceptual duplicate under an advisory lock
  // (see SupabaseService.assertNotDuplicateInSquad).
  let saveResult: { game: any; players: Player[] };
  try {
    saveResult = await supabaseService.saveGameWithStats(
      {
        id: gameId,
        date: gameData.date || new Date().toISOString(),
        homeTeam: gameData.homeTeam,
        awayTeam: gameData.awayTeam,
        homeScore: gameData.homeScore,
        awayScore: gameData.awayScore,
        screenshotUrl: imageUrl,
        imageHash: savedImageHash,
        processed: true,
        squadId,
        // Attribution + delete/move rights. Distinct from squadId, which controls access.
        uploadedByUserId: userId,
      },
      playerInputs,
      homeTeamInput,
      awayTeamInput,
    );
  } catch (saveError) {
    if (!(saveError instanceof DuplicateGameError)) throw saveError;

    // Lost the save-time dedup race: another member committed the same screenshot while
    // this one sat in review. Not a failure — the game the user was saving is in the
    // squad, so respond as the imageUrl-duplicate path above does. A 500 here would
    // tell the user their game was lost when it demonstrably was not.
    logger.info(
      { gameId: saveError.existingGameId, squadId },
      'Concurrent save of the same screenshot — returning the game that won the race',
    );

    // Terminal outcome, so the upload→save bridge for this image is done with. Leaving
    // it would pin the entry in the map for the process's lifetime.
    pendingHashes.delete(imageUrl);

    const winner = await supabaseService.getGameById(saveError.existingGameId, squadId);
    if (!winner) {
      // The winning game vanished between the aborted save and this read — only possible
      // if it was deleted in that window. Reporting a duplicate would point the client at
      // a game that no longer exists, so surface it as the failure it is and let the user
      // retry, which will now succeed.
      throw saveError;
    }
    // Drop the aggregate fields so the shape matches the other duplicate path.
    const { players: winnerPlayers, teams: _teams, ...winnerGame } = winner as any;
    return {
      outcome: 'raceLost',
      game: winnerGame as Game,
      players: stripNullPlayers(winnerPlayers),
    };
  }

  const { game, players: savedPlayers } = saveResult;

  // Save committed — the upload→save hash bridge for this image is now consumed.
  pendingHashes.delete(imageUrl);

  // Rebuild aggregates for this squad from the rows just written. Replaces the previous
  // per-player incremental accumulation, which had no decrement path and let totals
  // drift away from the underlying games.
  //
  // The game itself is already committed at this point, so a failure here must not be
  // reported as a failed save. It is logged loudly rather than swallowed, and because
  // the rebuild is idempotent and derived entirely from `players`, the next save or edit
  // in this squad repairs it — unlike the old incremental path, where a lost update was
  // permanent.
  try {
    await supabaseService.recomputeSquadAggregates(squadId);
  } catch (aggregateErr) {
    logger.error(
      { err: aggregateErr, gameId: game.id, squadId },
      'Game saved but squad aggregate rebuild failed — totals are stale until the next write',
    );
  }

  return {
    outcome: 'created',
    game,
    // The rows just written by saveGameWithStats — previously this returned the user's
    // whole game list under a field typed Player[].
    players: savedPlayers,
  };
}
