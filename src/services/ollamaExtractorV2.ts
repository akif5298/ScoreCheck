/**
 * Ollama extraction pipeline — V2.
 *
 * Same as ollamaExtractor.ts but adds per-row retry when a team half returns
 * fewer than 5 players.  Per-row crops are tiny, so qwen2.5vl handles them
 * reliably even when the half-table crop occasionally drops a player.
 *
 * Primary path:
 *   1. Extract Team A half (embedded header) and Team B half (composited header) in parallel.
 *   2. If either team returns < 5 players → retry those 5 row-crops individually in parallel.
 *   3. Use whichever attempt returned more players for that team.
 *   4. If total < 8 → fall back to full-image extractRaw (last resort).
 */

import sharp from 'sharp';
import { OLLAMA_BASE_URL, OLLAMA_EXTRACTION_MODEL } from '@/constants';

export const DEFAULT_MODEL = OLLAMA_EXTRACTION_MODEL;
const TIMEOUT_MS = 600_000;

// ── Coordinate constants (calibrated to 4K / 3840x2160 screenshots) ───────────

const REF_W = 3840;
const REF_H = 2160;

type Rect = { x1: number; y1: number; x2: number; y2: number };

const TABLE_CROP  = { x1: 1218, y1:  434, x2: 3525, y2: 1542 };
const HEADER_CROP = { x1: 1218, y1:  434, x2: 3525, y2:  516 };
// Team A: column headers + 5 player rows (header embedded).
// Team B: Team B section header + 5 player rows — HEADER_CROP composited on top produces
//         a double-header that qwen2.5vl reads reliably.
const TEAM_A_CROP = { x1: 1218, y1:  434, x2: 3525, y2:  923 };
const TEAM_B_CROP = { x1: 1218, y1: 1058, x2: 3525, y2: 1545 };

// Per-row fallback crops — one 82px slice per player.
// Team A players start at y=516 (below header at y=434-516).
// Team B players start at y=1140 (below Team B section header at y=1058-1140).
const ROW_H = 82;
const TEAM_A_ROW_CROPS: Rect[] = Array.from({ length: 5 }, (_, i) => ({
  x1: 1218, y1: 516  + i * ROW_H, x2: 3525, y2: 516  + (i + 1) * ROW_H,
}));
const TEAM_B_ROW_CROPS: Rect[] = Array.from({ length: 5 }, (_, i) => ({
  x1: 1218, y1: 1140 + i * ROW_H, x2: 3525, y2: 1140 + (i + 1) * ROW_H,
}));

// ── Image helpers ─────────────────────────────────────────────────────────────

async function cropRegion(buffer: Buffer, region: Rect): Promise<Buffer> {
  const meta   = await sharp(buffer).metadata();
  const imgW   = meta.width  ?? REF_W;
  const imgH   = meta.height ?? REF_H;
  const sx     = imgW / REF_W;
  const sy     = imgH / REF_H;
  const left   = Math.max(0, Math.round(region.x1 * sx));
  const top    = Math.max(0, Math.round(region.y1 * sy));
  const right  = Math.min(Math.round(region.x2 * sx), imgW);
  const bottom = Math.min(Math.round(region.y2 * sy), imgH);
  return sharp(buffer).extract({ left, top, width: right - left, height: bottom - top }).toBuffer();
}

async function compositeWithHeader(headerBuffer: Buffer, bodyBuffer: Buffer): Promise<Buffer> {
  const [hMeta, bMeta] = await Promise.all([
    sharp(headerBuffer).metadata(),
    sharp(bodyBuffer).metadata(),
  ]);
  const w  = hMeta.width  ?? 0;
  const hH = hMeta.height ?? 0;
  const bH = bMeta.height ?? 0;
  return sharp({
    create: { width: w, height: hH + bH, channels: 3, background: { r: 20, g: 20, b: 20 } },
  })
    .composite([
      { input: headerBuffer, top: 0,  left: 0 },
      { input: bodyBuffer,   top: hH, left: 0 },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}

// ── Prompts ───────────────────────────────────────────────────────────────────

export const EXTRACTION_PROMPT = `You are analyzing a screenshot of an NBA 2K basketball game box score.

Extract ALL player statistics from the box score table. There are exactly 10 players (5 per team), listed top to bottom.

The columns are:
- Player name (the gamertag/username)
- Grade (teammate grade: A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, or F)
- PTS (points)
- REB (rebounds)
- AST (assists)
- STL (steals)
- BLK (blocks)
- PF (personal fouls)
- TO (turnovers)
- FGM/FGA (field goals made / attempted)
- 3PM/3PA (three-pointers made / attempted)
- FTM/FTA (free throws made / attempted)

Return ONLY valid JSON — no markdown, no explanation, no code fences:
{
  "players": [
    {
      "name": "PLAYER_NAME",
      "grade": "A",
      "points": 0,
      "rebounds": 0,
      "assists": 0,
      "steals": 0,
      "blocks": 0,
      "turnovers": 0,
      "fouls": 0,
      "fgMade": 0,
      "fgAttempted": 0,
      "threeMade": 0,
      "threeAttempted": 0,
      "ftMade": 0,
      "ftAttempted": 0
    }
  ]
}`;

const TEAM_HALF_PROMPT = `You are analyzing a cropped section of an NBA 2K basketball game box score.

Extract ALL player statistics from the visible rows. There are exactly 5 players in this section.

IMPORTANT — gamertag format rules:
- 3–16 characters, first character is always a letter (A–Z or a–z)
- Allowed characters: letters (A–Z, a–z), digits (0–9), hyphens (-), underscores (_)
- NO spaces, NO special characters (!, @, #, $, etc.), NO emojis
- NO non-Latin scripts — never output Chinese, Cyrillic, Arabic, kana, Hangul, or any other non-ASCII characters
- Respond in English only

The columns are:
- Player name (the gamertag/username)
- Grade (teammate grade: A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, or F)
- PTS (points)
- REB (rebounds)
- AST (assists)
- STL (steals)
- BLK (blocks)
- PF (personal fouls)
- TO (turnovers)
- FGM/FGA (field goals made / attempted)
- 3PM/3PA (three-pointers made / attempted)
- FTM/FTA (free throws made / attempted)

Return ONLY valid JSON — no markdown, no explanation, no code fences:
{
  "players": [
    {
      "name": "PLAYER_NAME",
      "grade": "A",
      "points": 0,
      "rebounds": 0,
      "assists": 0,
      "steals": 0,
      "blocks": 0,
      "turnovers": 0,
      "fouls": 0,
      "fgMade": 0,
      "fgAttempted": 0,
      "threeMade": 0,
      "threeAttempted": 0,
      "ftMade": 0,
      "ftAttempted": 0
    }
  ]
}`;

const SINGLE_PLAYER_PROMPT = `This image shows ONE row from an NBA 2K box score table.
Extract the player name and all stats from this single row.
Columns left to right: name | PTS | REB | AST | STL | BLK | PF | TO | FG | 3PT | FT
FG, 3PT, FT are shown as "made/attempted" (e.g. 8/15 → fgMade=8, fgAttempted=15).
Columns left to right: name | GRADE | PTS | REB | AST | STL | BLK | PF | TO | FG | 3PT | FT
GRADE is the teammate grade (A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F).
FG, 3PT, FT are shown as "made/attempted" (e.g. 8/15 → fgMade=8, fgAttempted=15).
IMPORTANT — gamertag format rules: 3–16 chars, first char is a letter, only letters/digits/hyphens/underscores allowed, no spaces, no special chars, no non-Latin scripts.
Return ONLY valid JSON, no markdown:
{"players": [{"name": "PLAYER_NAME", "grade": "A", "points": 0, "rebounds": 0, "assists": 0, "steals": 0, "blocks": 0, "fouls": 0, "turnovers": 0, "fgMade": 0, "fgAttempted": 0, "threeMade": 0, "threeAttempted": 0, "ftMade": 0, "ftAttempted": 0}]}`;

// ── Public types ──────────────────────────────────────────────────────────────

export interface ExtractedPlayer {
  name: string;
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

export interface OllamaExtractionResult {
  players: ExtractedPlayer[];
  rawModelOutput: string;
  latencyMs: number;
  model: string;
}

export class OllamaExtractionError extends Error {
  rawOutput: string;
  constructor(message: string, rawOutput: string) {
    super(message);
    this.name = 'OllamaExtractionError';
    this.rawOutput = rawOutput;
  }
}

// ── JSON / player helpers ─────────────────────────────────────────────────────

function extractJSON(raw: string): unknown {
  try { return JSON.parse(raw); } catch { /* continue */ }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse((fenced[1] ?? '').trim()); } catch { /* continue */ }
  }

  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch { /* continue */ }
  }

  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try { return JSON.parse(arrayMatch[0]); } catch { /* continue */ }
  }

  const truncStart = raw.search(/[[{]/);
  if (truncStart !== -1) {
    const fragment = raw.slice(truncStart);
    const opens  = (fragment.match(/[[{]/g) ?? []).length;
    const closes = (fragment.match(/[\]}]/g) ?? []).length;
    const tail   = '}'.repeat(Math.max(0, opens - closes));
    try { return JSON.parse(fragment + tail); } catch { /* continue */ }
  }

  throw new OllamaExtractionError('Model output is not parseable JSON', raw);
}

function toNum(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function parsePlayer(raw: unknown): ExtractedPlayer {
  if (!raw || typeof raw !== 'object') {
    throw new OllamaExtractionError('Invalid player object', JSON.stringify(raw));
  }
  const p = raw as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const k of keys) if (p[k] !== undefined) return toNum(p[k]);
    return 0;
  };
  return {
    name:           String(p['name'] ?? p['player'] ?? p['playerName'] ?? ''),
    points:         pick('points', 'pts', 'PTS'),
    rebounds:       pick('rebounds', 'reb', 'REB'),
    assists:        pick('assists', 'ast', 'AST'),
    steals:         pick('steals', 'stl', 'STL'),
    blocks:         pick('blocks', 'blk', 'BLK'),
    turnovers:      pick('turnovers', 'to', 'TO', 'tov', 'TOV'),
    fouls:          pick('fouls', 'pf', 'PF', 'personalFouls'),
    fgMade:         pick('fgMade', 'fgm', 'FGM', 'fg_made'),
    fgAttempted:    pick('fgAttempted', 'fga', 'FGA', 'fg_attempted'),
    threeMade:      pick('threeMade', 'tpm', 'TPM', '3pm', 'threePointMade', 'fg3m'),
    threeAttempted: pick('threeAttempted', 'tpa', 'TPA', '3pa', 'threePointAttempted', 'fg3a'),
    ftMade:         pick('ftMade', 'ftm', 'FTM', 'ft_made'),
    ftAttempted:    pick('ftAttempted', 'fta', 'FTA', 'ft_attempted'),
  };
}

// ── Warmup / unload ───────────────────────────────────────────────────────────

export async function warmupModel(model = DEFAULT_MODEL, keepAlive: string | number = '30m'): Promise<void> {
  const body = JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], stream: false, keep_alive: keepAlive });
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await res.json();
  } catch (err) {
    console.warn(`[Ollama] Warmup failed for ${model} (${err instanceof Error ? err.message : String(err)}) -- continuing anyway`);
  }
}

export async function unloadModel(model = DEFAULT_MODEL): Promise<void> {
  const body = JSON.stringify({ model, prompt: '', keep_alive: 0, stream: false });
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      signal: AbortSignal.timeout(30_000),
    });
    await res.json().catch(() => null);
  } catch { /* best-effort */ }
}

// ── Low-level HTTP call ───────────────────────────────────────────────────────

async function ollamaChat(
  imageB64: string,
  prompt: string,
  model: string,
  opts: { timeoutMs?: number; numPredict?: number; format?: unknown } = {},
): Promise<string> {
  const timeoutMs  = opts.timeoutMs  ?? TIMEOUT_MS;
  const numPredict = opts.numPredict ?? 2048;
  const format     = opts.format ?? null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: 'user', content: prompt, images: [imageB64] }],
      stream: false,
      options: { num_predict: numPredict, num_ctx: 4096 },
    };
    if (format !== null) body['format'] = format;

    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new OllamaExtractionError(`Ollama HTTP ${response.status}`, errBody);
    }

    const resp = (await response.json()) as { message?: { content?: string } };
    const raw  = (resp.message?.content ?? '').trim();
    if (!raw) throw new OllamaExtractionError('Empty response from model', '');
    return raw;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof OllamaExtractionError) throw err;
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    throw new OllamaExtractionError(
      isTimeout
        ? `Timed out after ${timeoutMs / 1000}s`
        : `Ollama unreachable: ${err instanceof Error ? err.message : String(err)}`,
      '',
    );
  }
}

// ── Team-half extraction ──────────────────────────────────────────────────────

async function extractTeamHalf(
  imageBuffer: Buffer,
  teamCrop: Rect,
  model: string,
  headerBuffer?: Buffer,
): Promise<ExtractedPlayer[]> {
  const teamBuf  = await cropRegion(imageBuffer, teamCrop);
  const inputBuf = headerBuffer
    ? await compositeWithHeader(headerBuffer, teamBuf)
    : teamBuf;

  const raw = await ollamaChat(inputBuf.toString('base64'), TEAM_HALF_PROMPT, model, {
    timeoutMs:  TIMEOUT_MS,
    numPredict: 1024,
  });
  const parsed = extractJSON(raw);
  let playersRaw: unknown[];
  if (Array.isArray(parsed)) {
    playersRaw = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>)['players'])) {
    playersRaw = (parsed as Record<string, unknown>)['players'] as unknown[];
  } else {
    throw new OllamaExtractionError('Model JSON missing "players" array', raw);
  }
  return playersRaw.map(parsePlayer);
}

// ── Per-row extraction (used as fallback when a team half is short) ───────────

async function extractPlayerRow(imageBuffer: Buffer, crop: Rect, model: string): Promise<ExtractedPlayer> {
  const buf  = await cropRegion(imageBuffer, crop);
  const raw  = await ollamaChat(buf.toString('base64'), SINGLE_PLAYER_PROMPT, model, {
    timeoutMs:  TIMEOUT_MS,
    numPredict: 256,
  });
  const parsed     = extractJSON(raw);
  const playersRaw = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>)['players'])
      ? (parsed as Record<string, unknown>)['players'] as unknown[]
      : [parsed];
  const first = playersRaw[0];
  if (!first) throw new OllamaExtractionError('No player in row response', raw);
  return parsePlayer(first);
}

async function extractTeamPerRow(
  imageBuffer: Buffer,
  rowCrops: Rect[],
  model: string,
): Promise<ExtractedPlayer[]> {
  const results = await Promise.allSettled(
    rowCrops.map(crop => extractPlayerRow(imageBuffer, crop, model)),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<ExtractedPlayer> => r.status === 'fulfilled')
    .map(r => r.value);
}

// ── Full-image fallback ───────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAY = 30_000;

async function extractRaw(
  imageBuffer: Buffer,
  model: string,
  startTime: number,
): Promise<OllamaExtractionResult> {
  const b64 = imageBuffer.toString('base64');
  let lastError: OllamaExtractionError | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const rawModelOutput = await ollamaChat(b64, EXTRACTION_PROMPT, model, {
        timeoutMs:  TIMEOUT_MS,
        numPredict: 4096,
      });
      const parsed = extractJSON(rawModelOutput);
      let playersRaw: unknown[];
      if (Array.isArray(parsed)) {
        playersRaw = parsed;
      } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>)['players'])) {
        playersRaw = (parsed as Record<string, unknown>)['players'] as unknown[];
      } else {
        throw new OllamaExtractionError('Model JSON missing "players" array', rawModelOutput);
      }
      return { players: playersRaw.map(parsePlayer), rawModelOutput, latencyMs: Date.now() - startTime, model };
    } catch (err) {
      lastError = err instanceof OllamaExtractionError ? err : new OllamaExtractionError(String(err), '');
      if (err instanceof OllamaExtractionError && err.message.includes('Timed out')) throw err;
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, RETRY_DELAY));
    }
  }

  throw lastError ?? new OllamaExtractionError('Max retries exceeded', '');
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function extractBoxScore(
  imageBuffer: Buffer,
  model = DEFAULT_MODEL,
): Promise<OllamaExtractionResult> {
  const start = Date.now();

  try {
    const headerBuf = await cropRegion(imageBuffer, HEADER_CROP);

    // Step 1: Team-half extraction (2 parallel calls).
    let [teamAPlayers, teamBPlayers] = await Promise.all([
      extractTeamHalf(imageBuffer, TEAM_A_CROP, model).catch(() => [] as ExtractedPlayer[]),
      extractTeamHalf(imageBuffer, TEAM_B_CROP, model, headerBuf).catch(() => [] as ExtractedPlayer[]),
    ]);

    // Step 2: Per-row retry for any team that came back short.
    if (teamAPlayers.length < 5) {
      console.warn(`[Ollama V2] Team A returned ${teamAPlayers.length}/5 — retrying per-row`);
      const rowResult = await extractTeamPerRow(imageBuffer, TEAM_A_ROW_CROPS, model);
      if (rowResult.length > teamAPlayers.length) teamAPlayers = rowResult;
    }
    if (teamBPlayers.length < 5) {
      console.warn(`[Ollama V2] Team B returned ${teamBPlayers.length}/5 — retrying per-row`);
      const rowResult = await extractTeamPerRow(imageBuffer, TEAM_B_ROW_CROPS, model);
      if (rowResult.length > teamBPlayers.length) teamBPlayers = rowResult;
    }

    const players = [...teamAPlayers, ...teamBPlayers];
    if (players.length >= 8) {
      return {
        players,
        rawModelOutput: JSON.stringify({ players }),
        latencyMs: Date.now() - start,
        model,
      };
    }
  } catch (err) {
    console.warn('[Ollama V2] Extraction failed, falling back to full-image', err instanceof Error ? err.message : String(err));
  }

  return extractRaw(imageBuffer, model, start);
}
