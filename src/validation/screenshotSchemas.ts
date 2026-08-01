/**
 * Request-body schemas for the screenshot routes.
 *
 * These are the app's largest untrusted payloads: POST /save and PUT /games/:gameId each
 * accept an arbitrary array of player rows straight from the review UI, and every element
 * becomes an INSERT or UPDATE inside one transaction. Until now both routes checked only
 * that the fields were *present* — `players` could be a string, or a hundred thousand
 * objects, and the route would take it.
 *
 * Deliberately a GUARD, not a parser. The handlers keep reading `req.body` exactly as
 * before and the parsed output is discarded, so nothing downstream changes shape or gains a
 * coercion it did not have. That keeps this a pure hardening step: the set of *accepted*
 * requests shrinks to the sane ones, and the handling of accepted requests is untouched.
 *
 * Bounds come from the domain rather than round numbers:
 *   - NBA 2K is 5v5, so a box score carries 10 player rows. 30 leaves generous room for
 *     malformed-but-honest extractions while capping what one request can write.
 *   - Team names are composite lineup strings ("Akif (PG) / Nillan (SG) / ..."), so they
 *     need far more than a typical name field — 300 covers a full five-man lineup.
 *   - Stat fields are permissive about TYPE because the handlers already coerce with
 *     `Number(x) || 0`; tightening that would reject payloads the app accepts today.
 */
import { z } from 'zod';

/** One request may not write more player rows than this. */
export const MAX_PLAYERS_PER_GAME = 30;

const LINEUP_NAME_MAX = 300;
const PLAYER_NAME_MAX = 120;

/** A stat cell: any finite number, bounded well beyond any real box score. */
const statValue = z.number().finite().min(-10_000).max(10_000);

/**
 * Passthrough on purpose: the review UI sends fields this schema does not enumerate, and
 * rejecting them would break the client for no security gain. What matters is that the
 * fields we DO read are the right type and length.
 */
const incomingPlayer = z
  .object({
    id: z.string().max(200).optional(),
    name: z.string().max(PLAYER_NAME_MAX).optional(),
    team: z.string().max(LINEUP_NAME_MAX).optional(),
    teammateGrade: z.string().max(20).optional(),
    points: statValue.optional(),
    rebounds: statValue.optional(),
    assists: statValue.optional(),
    steals: statValue.optional(),
    blocks: statValue.optional(),
    turnovers: statValue.optional(),
    fouls: statValue.optional(),
    fgMade: statValue.optional(),
    fgAttempted: statValue.optional(),
    threeMade: statValue.optional(),
    threeAttempted: statValue.optional(),
    ftMade: statValue.optional(),
    ftAttempted: statValue.optional(),
  })
  .passthrough();

const playerList = z
  .array(incomingPlayer)
  .max(MAX_PLAYERS_PER_GAME, `A game cannot have more than ${MAX_PLAYERS_PER_GAME} players`);

const teamScore = z.number().finite().min(0).max(1000);

/** POST /save — shape and bounds only; presence is checked by the route first. */
export const saveBodySchema = z.object({
  gameData: z.object({
    date: z.string().max(100).optional(),
    homeTeam: z.string().min(1).max(LINEUP_NAME_MAX),
    awayTeam: z.string().min(1).max(LINEUP_NAME_MAX),
    homeScore: teamScore,
    awayScore: teamScore,
  }),
  playersData: playerList,
  // Storage object path, not a URL the user supplies freely — but still bounded.
  imageUrl: z.string().min(1).max(500),
  originalFileName: z.string().max(300).optional(),
});

/** PUT /games/:gameId — the edit path, same payload risk as save. */
export const updateGameBodySchema = z.object({
  homeTeam: z.string().min(1).max(LINEUP_NAME_MAX),
  awayTeam: z.string().min(1).max(LINEUP_NAME_MAX),
  homeScore: teamScore,
  awayScore: teamScore,
  date: z.string().min(1).max(100),
  players: playerList,
});

/** POST /generate-team-names — read-only, but the array is still unbounded without this. */
export const generateTeamNamesBodySchema = z.object({
  players: playerList,
});

/**
 * Turns a ZodError into one short sentence naming the first offending field.
 *
 * A flattened dump of every issue would leak the schema's shape to a caller and read as
 * noise in a toast; the first problem is what the user needs to fix.
 */
export function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request body';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}
