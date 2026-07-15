/**
 * Ollama extraction pipeline.
 *
 * Primary path: 2 parallel team-half crops → parse 5 players each.
 * Per-row retry: if either team returns < 5 players, re-extract each row individually.
 * Fallback: full-image extraction (last resort).
 *
 * Eval: npm run eval -- --pipeline=ollama
 *       npm run eval:bench
 */

import sharp from 'sharp';
import { OLLAMA_BASE_URL, OLLAMA_EXTRACTION_MODEL } from '@/constants';

export const DEFAULT_MODEL = OLLAMA_EXTRACTION_MODEL;
const TIMEOUT_MS = 600_000;

// ── Coordinate constants (calibrated to 4K / 3840x2160 screenshots) ───────────
// Scale automatically to any resolution at runtime.

const REF_W = 3840;
const REF_H = 2160;

type Rect = { x1: number; y1: number; x2: number; y2: number };

// Coordinates are top-left (x1,y1) and bottom-right (x2,y2), calibrated to REF_W×REF_H.
// Full table: header + both teams + totals, no game graphics
const TABLE_CROP  = { x1: 1218, y1:  434, x2: 3525, y2: 1542 };
// Column header row only (PTS REB AST STL BLK PF TO FGM/FGA 3PM/3PA FTM/FTA)
const HEADER_CROP = { x1: 1218, y1:  434, x2: 3525, y2:  516 };
// Team A: column headers + 5 player rows (header embedded).
// Team B: Team B section header + 5 player rows — HEADER_CROP is composited on top,
//         producing a double-header composite that qwen2.5vl reads reliably.
const TEAM_A_CROP = { x1: 1218, y1:  434, x2: 3525, y2:  923 };
const TEAM_B_CROP = { x1: 1218, y1: 1058, x2: 3525, y2: 1545 };

// Per-row fallback — one 82px slice per player, used when team-half returns < 5.
const ROW_H = 82;
const TEAM_A_ROW_CROPS: Rect[] = Array.from({ length: 5 }, (_, i) => ({
  x1: 1218, y1: 516  + i * ROW_H, x2: 3525, y2: 516  + (i + 1) * ROW_H,
}));
const TEAM_B_ROW_CROPS: Rect[] = Array.from({ length: 5 }, (_, i) => ({
  x1: 1218, y1: 1140 + i * ROW_H, x2: 3525, y2: 1140 + (i + 1) * ROW_H,
}));

async function cropRegion(
  buffer: Buffer,
  region: { x1: number; y1: number; x2: number; y2: number },
): Promise<Buffer> {
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
- FOULS / PF (personal fouls)
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
      "fouls": 0,
      "turnovers": 0,
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
Columns left to right: name | GRADE | PTS | REB | AST | STL | BLK | FOULS | TO | FG | 3PT | FT
GRADE is the teammate grade (A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F).
FG, 3PT, FT are shown as "made/attempted" (e.g. 8/15 → fgMade=8, fgAttempted=15).
IMPORTANT — gamertag format rules: 3–16 chars, first char is a letter, only letters/digits/hyphens/underscores allowed, no spaces, no special chars, no non-Latin scripts.
Return ONLY valid JSON, no markdown:
{"players": [{"name": "PLAYER_NAME", "grade": "A", "points": 0, "rebounds": 0, "assists": 0, "steals": 0, "blocks": 0, "fouls": 0, "turnovers": 0, "fgMade": 0, "fgAttempted": 0, "threeMade": 0, "threeAttempted": 0, "ftMade": 0, "ftAttempted": 0}]}`;

// Used for team-half crops (Team A already has headers; Team B gets them prepended via compositeWithHeader).
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
- FOULS / PF (personal fouls)
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
      "fouls": 0,
      "turnovers": 0,
      "fgMade": 0,
      "fgAttempted": 0,
      "threeMade": 0,
      "threeAttempted": 0,
      "ftMade": 0,
      "ftAttempted": 0
    }
  ]
}`;


// ── Public types ──────────────────────────────────────────────────────────────

export interface ExtractedPlayer {
  name: string;
  grade: string;
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

// ── JSON extraction helpers ───────────────────────────────────────────────────

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
    grade:          String(p['grade'] ?? p['teammateGrade'] ?? p['teamGrade'] ?? ''),
    points:         pick('points', 'pts', 'PTS'),
    rebounds:       pick('rebounds', 'reb', 'REB'),
    assists:        pick('assists', 'ast', 'AST'),
    steals:         pick('steals', 'stl', 'STL'),
    blocks:         pick('blocks', 'blk', 'BLK'),
    turnovers:      pick('turnovers', 'to', 'TO', 'tov', 'TOV'),
    fouls:          pick('fouls', 'pf', 'PF', 'personalFouls', 'FOULS', 'Fouls'),
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
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
    keep_alive: keepAlive,
  });
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    await res.json().catch(() => null);
  } catch {
    // best-effort
  }
}

// ── Low-level HTTP call ───────────────────────────────────────────────────────

async function ollamaChat(
  imageB64: string,
  prompt: string,
  model: string,
  opts: { timeoutMs?: number; numPredict?: number; format?: unknown; numCtx?: number | undefined } = {},
): Promise<string> {
  const timeoutMs  = opts.timeoutMs  ?? TIMEOUT_MS;
  const numPredict = opts.numPredict ?? 2048;
  const numCtx     = opts.numCtx     ?? 4096;
  // format is opt-in: pass null/undefined to skip (needed for qwen2.5vl Ollama 0.30.x grammar bug)
  const format     = opts.format ?? null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: 'user', content: prompt, images: [imageB64] }],
      stream: false,
      options: { num_predict: numPredict, num_ctx: numCtx },
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
// Crop each team's half of the table and extract 5 players per call.
// Team A crop already includes the column header row.
// Team B crop does not — pass headerBuffer to prepend the header row so both
// halves look identical from the model's perspective.

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

// ── Per-row fallback ──────────────────────────────────────────────────────────
// Sends a single 82px-tall row crop and parses one player. Used when team-half
// returns fewer than 5 players (rare dropout, typically first player in Team A).

async function extractPlayerRow(
  imageBuffer: Buffer,
  crop: Rect,
  model: string,
): Promise<ExtractedPlayer> {
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

// ── Full-image fallback (original single-call behaviour with retries) ─────────

const MAX_RETRIES   = 3;
const RETRY_DELAY   = 30_000;

async function extractRaw(
  imageBuffer: Buffer,
  model: string,
  startTime: number,
  opts: { resizeLongestEdge?: number; numCtx?: number; prompt?: string } = {},
): Promise<OllamaExtractionResult> {
  // Optionally resize to match the fine-tuned model's training distribution
  // (--img-size in scripts/finetune.py). Also keeps image token count within
  // the context window: native-res screenshots produce ~3800 image tokens.
  // PNG (lossless): training feeds raw resized pixels, so JPEG re-encoding at
  // inference would add compression artifacts to exactly the small text that
  // matters most (gamertags).
  const inputBuffer = opts.resizeLongestEdge
    ? await sharp(imageBuffer)
        .resize(opts.resizeLongestEdge, opts.resizeLongestEdge, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer()
    : imageBuffer;
  const b64 = inputBuffer.toString('base64');
  let lastError: OllamaExtractionError | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const rawModelOutput = await ollamaChat(b64, opts.prompt ?? EXTRACTION_PROMPT, model, {
        timeoutMs:  TIMEOUT_MS,
        numPredict: 4096,
        numCtx:     opts.numCtx,
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

      return {
        players:        playersRaw.map(parsePlayer),
        rawModelOutput,
        latencyMs:      Date.now() - startTime,
        model,
      };
    } catch (err) {
      lastError = err instanceof OllamaExtractionError
        ? err
        : new OllamaExtractionError(String(err), '');

      if (err instanceof OllamaExtractionError && err.message.includes('Timed out')) throw err;
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, RETRY_DELAY));
    }
  }

  throw lastError ?? new OllamaExtractionError('Max retries exceeded', '');
}

// ── Main export ───────────────────────────────────────────────────────────────

// Fine-tuned models are trained on FULL screenshots at 1280px longest edge
// (scripts/finetune.py --img-size), so single-pass full-image inference is
// their in-distribution path — measured 90.7% field accuracy vs 78.9% through
// the crop pipeline on the 10-image holdout set, at ~24s vs ~41s.
const FINE_TUNED_MODEL_PREFIX = 'scorecheck-ocr';
// MUST match --img-size used in scripts/finetune.py for the deployed model.
// Current model (round 2) was trained at 1280; 6 GB VRAM cannot train larger —
// a 1536 model needs a cloud GPU (Kaggle P100), then update this to match.
const FINE_TUNED_IMG_EDGE     = 1280;
const FINE_TUNED_NUM_CTX      = 8192;
// Flip to true ONLY when the deployed model was trained with --table-crop
// (scripts/finetune.py). Cropping at inference against a model trained on
// full screenshots — or vice versa — is a train/test distribution mismatch.
const FINE_TUNED_TABLE_CROP   = false;

// MUST stay byte-identical to EXTRACTION_PROMPT in scripts/export_dataset.py —
// the fine-tuned model is prompt-sensitive and was trained on exactly this
// text. (Note: no Grade column; the training data does not include grades.)
const FINE_TUNED_PROMPT = `You are analyzing a screenshot of an NBA 2K basketball game box score.

Extract ALL player statistics from the box score table. There are exactly 10 players (5 per team), listed top to bottom.

The columns are:
- Player name (the gamertag/username)
- PTS (points)
- REB (rebounds)
- AST (assists)
- STL (steals)
- BLK (blocks)
- TO (turnovers)
- PF (personal fouls)
- FGM/FGA (field goals made / attempted)
- 3PM/3PA (three-pointers made / attempted)
- FTM/FTA (free throws made / attempted)

Return ONLY valid JSON — no markdown, no explanation, no code fences:
{
  "players": [
    {
      "name": "PLAYER_NAME",
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

export async function extractBoxScore(
  imageBuffer: Buffer,
  model = DEFAULT_MODEL,
): Promise<OllamaExtractionResult> {
  const start = Date.now();

  // Full-image first for the fine-tuned model; fall through to the crop
  // pipeline only when a row goes missing (rare, ~1/10 images).
  if (model.startsWith(FINE_TUNED_MODEL_PREFIX)) {
    try {
      const fineTunedInput = FINE_TUNED_TABLE_CROP
        ? await cropRegion(imageBuffer, TABLE_CROP)
        : imageBuffer;
      const result = await extractRaw(fineTunedInput, model, start, {
        resizeLongestEdge: FINE_TUNED_IMG_EDGE,
        numCtx:            FINE_TUNED_NUM_CTX,
        prompt:            FINE_TUNED_PROMPT,
      });
      if (result.players.length >= 10) return result;
      console.warn(`[Ollama] Full-image returned ${result.players.length}/10 — falling back to crop pipeline`);
    } catch (err) {
      console.warn('[Ollama] Full-image extraction failed — falling back to crop pipeline', err instanceof Error ? err.message : String(err));
    }
  }

  try {
    const headerBuf = await cropRegion(imageBuffer, HEADER_CROP);

    // Step 1: Team-half extraction (2 parallel calls).
    let [teamAPlayers, teamBPlayers] = await Promise.all([
      extractTeamHalf(imageBuffer, TEAM_A_CROP, model).catch(() => [] as ExtractedPlayer[]),
      extractTeamHalf(imageBuffer, TEAM_B_CROP, model, headerBuf).catch(() => [] as ExtractedPlayer[]),
    ]);

    // Step 2: Per-row retry for any team that came back short.
    if (teamAPlayers.length < 5) {
      console.warn(`[Ollama] Team A returned ${teamAPlayers.length}/5 — retrying per-row`);
      const rowResult = await extractTeamPerRow(imageBuffer, TEAM_A_ROW_CROPS, model);
      if (rowResult.length > teamAPlayers.length) teamAPlayers = rowResult;
    }
    if (teamBPlayers.length < 5) {
      console.warn(`[Ollama] Team B returned ${teamBPlayers.length}/5 — retrying per-row`);
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
    console.warn('[Ollama] Extraction failed, falling back to full-image', err instanceof Error ? err.message : String(err));
  }

  return extractRaw(imageBuffer, model, start);
}