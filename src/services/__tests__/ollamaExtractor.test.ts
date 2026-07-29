/**
 * Unit tests for the Ollama extraction client.
 *
 * `fetch` is mocked because the real dependency is a GPU host that scales to zero — but
 * nothing else is: sharp really crops the buffers, and the JSON/player parsing runs for
 * real. Those parsers are the part worth testing hardest, because a vision model returns
 * prose-wrapped, fenced, or truncated JSON far more often than clean output, and every
 * repair path here exists because a real extraction hit it.
 */
import sharp from 'sharp';
import {
  ollamaHeaders,
  assertExtractionHostReachable,
  warmupModel,
  unloadModel,
  extractBoxScore,
  extractJSON,
  parsePlayer,
  OllamaExtractionError,
  DEFAULT_MODEL,
} from '@/services/ollamaExtractor';
import { ExtractionUnavailableError } from '@/errors';

/** A plain model name so extractBoxScore takes the single-pass full-image path. */
const PLAIN_MODEL = 'minicpm-v:latest';

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

/** 3840x2160 is the reference resolution; a smaller image exercises the scaling maths. */
async function screenshot(width = 384, height = 216): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 20, b: 20 } },
  })
    .png()
    .toBuffer();
}

function modelReplies(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ message: { content } }),
  };
}

/**
 * Five rows — one team half. extractBoxScore always splits the screenshot into a Team A
 * and a Team B crop and concatenates the two replies, so a reply carrying ten rows would
 * come back as twenty.
 */
function halfTeam(): unknown[] {
  return Array.from({ length: 5 }, (_, i) => ({
    name: `P${i}`,
    points: i,
    rebounds: i,
    assists: i,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    fgMade: 1,
    fgAttempted: 2,
    threeMade: 0,
    threeAttempted: 0,
    ftMade: 0,
    ftAttempted: 0,
  }));
}

beforeEach(() => {
  fetchMock.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('ollamaHeaders', () => {
  it('always sends JSON content type', () => {
    expect(ollamaHeaders()['Content-Type']).toBe('application/json');
  });

  it('omits Authorization when no key is configured', () => {
    // The local-Ollama case: plain HTTP with no auth in front of it.
    expect(ollamaHeaders()['Authorization']).toBeUndefined();
  });

  it('sends a bearer token when OLLAMA_API_KEY is set', async () => {
    // The constant is read at module load, so the module has to be re-required with the
    // variable in place rather than set afterwards.
    await jest.isolateModulesAsync(async () => {
      process.env.OLLAMA_API_KEY = 'secret-token';
      const mod = await import('@/services/ollamaExtractor');
      expect(mod.ollamaHeaders()['Authorization']).toBe('Bearer secret-token');
      delete process.env.OLLAMA_API_KEY;
    });
  });
});

describe('assertExtractionHostReachable', () => {
  it('resolves when the host answers 200', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await expect(assertExtractionHostReachable()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/tags'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws ExtractionUnavailableError on a non-OK status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });

    // A typed error, so upload routes can answer 503 rather than a generic 500.
    await expect(assertExtractionHostReachable()).rejects.toBeInstanceOf(
      ExtractionUnavailableError,
    );
  });

  it('throws ExtractionUnavailableError when the connection fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(assertExtractionHostReachable()).rejects.toBeInstanceOf(
      ExtractionUnavailableError,
    );
  });

  it('preserves the underlying failure as the cause', async () => {
    const cause = new Error('ECONNREFUSED');
    fetchMock.mockRejectedValue(cause);

    await expect(assertExtractionHostReachable()).rejects.toMatchObject({ cause });
  });
});

describe('warmupModel', () => {
  it('pokes the chat endpoint with a keep-alive', async () => {
    fetchMock.mockResolvedValue(modelReplies('hi'));

    await warmupModel(DEFAULT_MODEL, '30m');

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as { body: string }).body)).toMatchObject({
      model: DEFAULT_MODEL,
      keep_alive: '30m',
      stream: false,
    });
  });

  it('never rejects when the host is down', async () => {
    fetchMock.mockRejectedValue(new Error('host asleep'));

    // Warmup is fire-and-forget from the route; a rejection here would surface as an
    // unhandled rejection rather than a degraded-but-working upload page.
    await expect(warmupModel()).resolves.toBeUndefined();
  });

  it('never rejects on a non-OK status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

    await expect(warmupModel()).resolves.toBeUndefined();
  });
});

describe('unloadModel', () => {
  it('asks the host to drop the model from VRAM', async () => {
    fetchMock.mockResolvedValue(modelReplies(''));

    await unloadModel(DEFAULT_MODEL);

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as { body: string }).body)).toMatchObject({ keep_alive: 0 });
  });

  it('never rejects when the host is down', async () => {
    fetchMock.mockRejectedValue(new Error('gone'));

    await expect(unloadModel()).resolves.toBeUndefined();
  });
});

/** Runs fn and hands back whatever it threw, so the error object itself can be asserted on. */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (err) {
    return err;
  }
}

describe('extractJSON', () => {
  it('parses a clean object', () => {
    expect(extractJSON('{"players":[{"name":"P0"}]}')).toEqual({ players: [{ name: 'P0' }] });
  });

  it('parses a clean array', () => {
    expect(extractJSON('[{"name":"P0"},{"name":"P1"}]')).toEqual([{ name: 'P0' }, { name: 'P1' }]);
  });

  it('unwraps a ```json fence', () => {
    expect(extractJSON('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('unwraps a bare ``` fence', () => {
    expect(extractJSON('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('falls through a fence holding broken JSON to the object underneath', () => {
    // Models sometimes open a fence, emit an apology, then produce the real answer after it.
    expect(extractJSON('```json\nnot json\n```\nsorry, here: {"a":1}')).toEqual({ a: 1 });
  });

  it('digs an object out of surrounding prose', () => {
    expect(extractJSON('Sure! {"a":1} Hope that helps.')).toEqual({ a: 1 });
  });

  it('digs an array out of surrounding prose', () => {
    expect(extractJSON('Rows: [{"name":"P0"},{"name":"P1"}] done')).toEqual([
      { name: 'P0' },
      { name: 'P1' },
    ]);
  });

  it('returns the object, not the array, for a single-row array in prose', () => {
    // The brace branch runs before the array branch, and with one element the greedy
    // brace match is itself valid JSON. Recorded because the caller then reports
    // 'Model JSON missing "players" array' and falls back to per-row extraction — the
    // right outcome for the wrong reason, and a live trap if the branches are reordered.
    expect(extractJSON('Row: [{"name":"P0"}] done')).toEqual({ name: 'P0' });
  });

  it('closes an object the model was cut off part-way through', () => {
    // num_predict is 1024 for a team half; a verbose model runs out mid-object.
    expect(extractJSON('{"name":"Akif","points":24')).toEqual({ name: 'Akif', points: 24 });
  });

  it('closes several nested objects at once', () => {
    expect(extractJSON('{"game":{"home":{"score":102')).toEqual({
      game: { home: { score: 102 } },
    });
  });

  it('cannot repair a truncation that leaves an array open', () => {
    // The repair counts every unclosed bracket but closes them all with "}", so an open
    // "[" is never terminated. That is the shape the model actually emits, so truncation
    // repair rarely rescues a real reply — the caller's per-row retry does. Pinned as a
    // known limitation, not endorsed.
    const err = thrownBy(() => extractJSON('{"players":[{"name":"P0","points":1},{"name":"P1"'));

    expect(err).toBeInstanceOf(OllamaExtractionError);
  });

  it('throws when the output holds no JSON at all', () => {
    const err = thrownBy(() => extractJSON('I am unable to read this image.'));

    expect(err).toBeInstanceOf(OllamaExtractionError);
  });

  it('carries the original output on the error so the failure is diagnosable', () => {
    const raw = 'I am unable to read this image.';

    // The route logs rawOutput when extraction fails; without it a bad prompt or a model
    // regression is invisible.
    expect(thrownBy(() => extractJSON(raw))).toMatchObject({
      name: 'OllamaExtractionError',
      message: 'Model output is not parseable JSON',
      rawOutput: raw,
    });
  });
});

describe('parsePlayer', () => {
  /** Every stat absent — the shape parsePlayer produces from an empty row. */
  const zeroed = {
    points: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    fgMade: 0,
    fgAttempted: 0,
    threeMade: 0,
    threeAttempted: 0,
    ftMade: 0,
    ftAttempted: 0,
  };

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'Akif 24pts'],
    ['a number', 42],
    ['false', false],
  ])('throws on %s rather than inventing a row', (_label, raw) => {
    expect(thrownBy(() => parsePlayer(raw))).toBeInstanceOf(OllamaExtractionError);
  });

  it('treats an array row as an empty player', () => {
    // typeof [] is 'object', so the guard lets it through and every key reads undefined.
    // A silently blank row is worse than a throw here; recorded so a future guard change
    // is a deliberate one.
    expect(parsePlayer([])).toEqual({ ...zeroed, name: '', grade: '' });
  });

  it('defaults every absent stat to 0 and both strings to empty', () => {
    expect(parsePlayer({})).toEqual({ ...zeroed, name: '', grade: '' });
  });

  it.each([
    ['name', 'Akif'],
    ['player', 'Akif'],
    ['playerName', 'Akif'],
  ])('reads the name from %s', (key, expected) => {
    expect(parsePlayer({ [key]: 'Akif' }).name).toBe(expected);
  });

  it('prefers name over player over playerName', () => {
    expect(parsePlayer({ name: 'A', player: 'B', playerName: 'C' }).name).toBe('A');
    expect(parsePlayer({ player: 'B', playerName: 'C' }).name).toBe('B');
  });

  it.each(['grade', 'teammateGrade', 'teamGrade'])('reads the grade from %s', (key) => {
    expect(parsePlayer({ [key]: 'A+' }).grade).toBe('A+');
  });

  it('stringifies a non-string name rather than dropping it', () => {
    expect(parsePlayer({ name: 23 }).name).toBe('23');
  });

  // The model is free-form about key casing and abbreviation, and an unrecognised key
  // reads as 0 — a silent wrong stat, never an error. Each alias below is one the source
  // claims to accept, so a typo in that list shows up here rather than in someone's totals.
  it.each([
    ['points', 'points'], ['pts', 'points'], ['PTS', 'points'],
    ['rebounds', 'rebounds'], ['reb', 'rebounds'], ['REB', 'rebounds'],
    ['assists', 'assists'], ['ast', 'assists'], ['AST', 'assists'],
    ['steals', 'steals'], ['stl', 'steals'], ['STL', 'steals'],
    ['blocks', 'blocks'], ['blk', 'blocks'], ['BLK', 'blocks'],
    ['turnovers', 'turnovers'], ['to', 'turnovers'], ['TO', 'turnovers'],
    ['tov', 'turnovers'], ['TOV', 'turnovers'],
    ['fouls', 'fouls'], ['pf', 'fouls'], ['PF', 'fouls'],
    ['personalFouls', 'fouls'], ['FOULS', 'fouls'], ['Fouls', 'fouls'],
    ['fgMade', 'fgMade'], ['fgm', 'fgMade'], ['FGM', 'fgMade'], ['fg_made', 'fgMade'],
    ['fgAttempted', 'fgAttempted'], ['fga', 'fgAttempted'], ['FGA', 'fgAttempted'],
    ['fg_attempted', 'fgAttempted'],
    ['threeMade', 'threeMade'], ['tpm', 'threeMade'], ['TPM', 'threeMade'],
    ['3pm', 'threeMade'], ['threePointMade', 'threeMade'], ['fg3m', 'threeMade'],
    ['threeAttempted', 'threeAttempted'], ['tpa', 'threeAttempted'],
    ['TPA', 'threeAttempted'], ['3pa', 'threeAttempted'],
    ['threePointAttempted', 'threeAttempted'], ['fg3a', 'threeAttempted'],
    ['ftMade', 'ftMade'], ['ftm', 'ftMade'], ['FTM', 'ftMade'], ['ft_made', 'ftMade'],
    ['ftAttempted', 'ftAttempted'], ['fta', 'ftAttempted'], ['FTA', 'ftAttempted'],
    ['ft_attempted', 'ftAttempted'],
  ])('maps %s onto %s', (key, field) => {
    expect(parsePlayer({ [key]: 7 })).toMatchObject({ ...zeroed, [field]: 7 });
  });

  it('takes the first alias present, in the order the source lists them', () => {
    expect(parsePlayer({ points: 5, pts: 9, PTS: 13 }).points).toBe(5);
    expect(parsePlayer({ pts: 9, PTS: 13 }).points).toBe(9);
  });

  it('skips an alias explicitly set to undefined and keeps looking', () => {
    expect(parsePlayer({ points: undefined, pts: 9 }).points).toBe(9);
  });

  it.each([
    ['a numeric string', '17', 17],
    ['a dash placeholder', '--', 0],
    ['n/a', 'n/a', 0],
    ['null', null, 0],
    ['an object', {}, 0],
  ])('coerces %s to a number', (_label, value, expected) => {
    // NaN would propagate into every downstream average and serialise as null.
    expect(parsePlayer({ points: value }).points).toBe(expected);
  });

  it.each([1, 5, 10])('keeps slot %i', (slot) => {
    expect(parsePlayer({ slot })).toMatchObject({ slot });
  });

  it.each([
    ['below range', 0],
    ['above range', 11],
    ['not an integer', 2.5],
    ['not a number', 'first'],
    ['absent', undefined],
  ])('omits a slot that is %s', (_label, slot) => {
    // A bogus slot is worse than none: alignBySlots would seat the row in the wrong place.
    expect(parsePlayer({ name: 'X', slot })).not.toHaveProperty('slot');
  });

  it('accepts a slot the model sent as a string', () => {
    expect(parsePlayer({ slot: '3' })).toMatchObject({ slot: 3 });
  });
});

describe('extractBoxScore — wiring the parsers into the pipeline', () => {
  /** Every reply the model gives in this test returns the same payload. */
  function alwaysReplies(content: string) {
    fetchMock.mockResolvedValue(modelReplies(content));
  }

  it('returns the players, the model and a latency for a clean reply', async () => {
    alwaysReplies(JSON.stringify({ players: halfTeam() }));

    const result = await extractBoxScore(await screenshot(), PLAIN_MODEL);

    expect(result.players).toHaveLength(10);
    expect(result.model).toBe(PLAIN_MODEL);
    expect(result.latencyMs).toEqual(expect.any(Number));
  });

  it('recovers a fenced reply, so extractJSON is reached and not bypassed', async () => {
    alwaysReplies('Here you go:\n```json\n' + JSON.stringify({ players: halfTeam() }) + '\n```');

    const result = await extractBoxScore(await screenshot(), PLAIN_MODEL);

    expect(result.players).toHaveLength(10);
  });

  it('accepts a bare array as well as a players-keyed object', async () => {
    alwaysReplies(JSON.stringify(halfTeam()));

    const result = await extractBoxScore(await screenshot(), PLAIN_MODEL);

    expect(result.players).toHaveLength(10);
  });

  it('normalises abbreviated keys end to end', async () => {
    const abbreviated = Array.from({ length: 5 }, (_, i) => ({
      player: `Q${i}`,
      teamGrade: 'A',
      pts: 11,
      reb: 4,
      fgm: 4,
      fga: 9,
    }));
    alwaysReplies(JSON.stringify({ players: abbreviated }));

    const result = await extractBoxScore(await screenshot(), PLAIN_MODEL);

    expect(result.players[0]).toMatchObject({
      name: 'Q0',
      grade: 'A',
      points: 11,
      rebounds: 4,
      fgMade: 4,
      fgAttempted: 9,
    });
  });
});

/**
 * Which stage of the pipeline issued a call, read off the prompt in the request body.
 *
 * Routing on the prompt rather than on call order matters: the two team halves are issued
 * through Promise.all, so their fetches can land in either order, and an earlier version of
 * these tests that counted calls was pinning a race.
 */
type Stage = 'half' | 'row' | 'full';

function stageOf(init: unknown): Stage {
  const body = JSON.parse((init as { body: string }).body) as { messages: { content: string }[] };
  const prompt = body.messages[0]?.content ?? '';
  if (/ONE row/.test(prompt)) return 'row';
  if (/cropped section/.test(prompt)) return 'half';
  return 'full';
}

function stagesCalled(): Stage[] {
  return fetchMock.mock.calls.map(([, init]) => stageOf(init));
}

/** Answers every call according to the stage that made it. An unlisted stage is a failure. */
function routeByStage(replies: Partial<Record<Stage, () => unknown>>): void {
  fetchMock.mockImplementation(async (_url: unknown, init: unknown) => {
    const stage = stageOf(init);
    const reply = replies[stage];
    if (!reply) throw new Error(`no reply configured for a ${stage} call`);
    return reply();
  });
}

/** One extracted row as the model returns it, optionally slot-tagged. */
function row(name: string, slot?: number) {
  return {
    ...(slot === undefined ? {} : { slot }),
    name,
    points: 1,
    rebounds: 1,
    assists: 1,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    fgMade: 1,
    fgAttempted: 2,
    threeMade: 0,
    threeAttempted: 0,
    ftMade: 0,
    ftAttempted: 0,
  };
}

const warned = () => (console.warn as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n');

describe('extractBoxScore — the fine-tuned team-split path', () => {
  const FINE_TUNED = 'scorecheck-ocr-r5:latest';

  it('splits into two halves and concatenates them', async () => {
    routeByStage({ half: () => modelReplies(JSON.stringify({ players: halfTeam() })) });

    const result = await extractBoxScore(await screenshot(), FINE_TUNED);

    expect(result.players).toHaveLength(10);
    expect(stagesCalled()).toEqual(['half', 'half']);
  });

  it('re-extracts only the row the model skipped, not the whole half', async () => {
    // Slot 3 is missing, so alignBySlots pads it blank and fillMissingSlots targets that
    // one row crop. The half reply is a bare array here — the other accepted shape.
    routeByStage({
      half: () => modelReplies(JSON.stringify([row('P1', 1), row('P2', 2), row('P4', 4), row('P5', 5)])),
      row: () => modelReplies(JSON.stringify({ players: [row('P3')] })),
    });

    const result = await extractBoxScore(await screenshot(), FINE_TUNED);

    expect(result.players.map((p) => p.name)).toEqual(
      ['P1', 'P2', 'P3', 'P4', 'P5', 'P1', 'P2', 'P3', 'P4', 'P5'],
    );
    // The recovered row is stamped with the slot it was fetched for, not the model's.
    expect(result.players[2]).toMatchObject({ slot: 3 });
    // One targeted call per half — a blanket retry would have made five each.
    expect(stagesCalled().filter((s) => s === 'row')).toHaveLength(2);
    expect(warned()).toMatch(/skipped row/);
  });

  it('keeps the blank placeholder when the targeted retry also fails', async () => {
    routeByStage({
      half: () => modelReplies(JSON.stringify([row('P1', 1), row('P2', 2), row('P4', 4), row('P5', 5)])),
      row: () => modelReplies('still cannot read it'),
    });

    const result = await extractBoxScore(await screenshot(), FINE_TUNED);

    // A known gap beats a guess: the review UI shows an empty row rather than a shifted one.
    expect(result.players).toHaveLength(10);
    expect(result.players[2]).toMatchObject({ name: '', slot: 3, points: 0 });
  });

  it('falls back to a blanket per-row retry when the half carries no usable slots', async () => {
    // Older models emit no slot field, so alignBySlots cannot tell which row is missing.
    routeByStage({
      half: () => modelReplies(JSON.stringify({ players: [row('A'), row('B'), row('C')] })),
      row: () => modelReplies(JSON.stringify(row('R'))), // a bare object, unwrapped
    });

    const result = await extractBoxScore(await screenshot(), FINE_TUNED);

    expect(result.players.map((p) => p.name)).toEqual(Array(10).fill('R'));
    expect(stagesCalled().filter((s) => s === 'row')).toHaveLength(10);
    expect(warned()).toMatch(/returned 3\/5 — retrying per-row/);
  });

  it('keeps the shorter half when the per-row retry recovers no more rows', async () => {
    routeByStage({
      half: () => modelReplies(JSON.stringify({ players: [row('A'), row('B'), row('C'), row('D')] })),
      row: () => modelReplies('unreadable'),
    });

    const result = await extractBoxScore(await screenshot(), FINE_TUNED);

    // 8 of 10 is returned rather than discarded: a review screen with two blanks is more
    // use than a failed upload, and the full-image fallback only runs below 8.
    expect(result.players).toHaveLength(8);
    expect(warned()).toMatch(/returned 8\/10 — accepting partial result/);
    expect(stagesCalled()).not.toContain('full');
  });

  it('falls back to full-image when both halves come back empty', async () => {
    routeByStage({
      // Parseable JSON that simply is not a box score — the "missing players array" path.
      half: () => modelReplies('{"rows":[]}'),
      row: () => modelReplies('no idea'),
      full: () =>
        modelReplies(JSON.stringify(Array.from({ length: 10 }, (_, i) => row(`F${i + 1}`, i + 1)))),
    });

    const result = await extractBoxScore(await screenshot(), 'scorecheck-ocr-r5:latest');

    expect(result.players.map((p) => p.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `F${i + 1}`),
    );
    expect(warned()).toMatch(/falling back to full-image/);
  });

  it('accepts and pads a short full-image fallback rather than failing the upload', async () => {
    routeByStage({
      half: () => modelReplies('{"rows":[]}'),
      row: () => modelReplies('no idea'),
      full: () =>
        modelReplies(
          JSON.stringify({ players: Array.from({ length: 9 }, (_, i) => row(`F${i + 1}`, i + 1)) }),
        ),
    });

    const result = await extractBoxScore(await screenshot(), 'scorecheck-ocr-r5:latest');

    expect(warned()).toMatch(/Full-image fallback returned 9\/10/);
    // alignBySlots then pads slot 10, so the caller still gets ten seats.
    expect(result.players).toHaveLength(10);
    expect(result.players[9]).toMatchObject({ name: '', slot: 10 });
  });
});

describe('extractBoxScore — failure handling', () => {
  it('treats a non-OK response as an extraction failure and moves on', async () => {
    routeByStage({
      half: () => modelReplies('{"rows":[]}'),
      row: () => ({ ok: false, status: 500, text: async () => 'upstream exploded' }),
      full: () => modelReplies(JSON.stringify({ players: [...halfTeam(), ...halfTeam()] })),
    });

    const result = await extractBoxScore(await screenshot(), PLAIN_MODEL);

    expect(result.players).toHaveLength(10);
    expect(warned()).toMatch(/Team A returned 0\/5/);
  });

  it('skips straight to full-image when the screenshot cannot be cropped', async () => {
    routeByStage({ full: () => modelReplies(JSON.stringify({ players: [...halfTeam(), ...halfTeam()] })) });

    const result = await extractBoxScore(Buffer.from('this is not an image'), PLAIN_MODEL);

    expect(result.players).toHaveLength(10);
    // No half or row call was even attempted — cropping failed before the first request.
    expect(stagesCalled()).toEqual(['full']);
    expect(warned()).toMatch(/Extraction failed, falling back to full-image/);
  });

  it('gives up immediately on a timeout instead of retrying into it', async () => {
    const aborted = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    fetchMock.mockRejectedValue(aborted);

    // Every other failure is retried, but a timeout means the host is saturated: retrying
    // three times at TIMEOUT_MS each would hold the request open for minutes. This is the
    // one path that must not sleep, so it is also the one worth pinning.
    const err = await extractBoxScore(await screenshot(), PLAIN_MODEL).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OllamaExtractionError);
    expect((err as OllamaExtractionError).message).toMatch(/Timed out after \d+s/);
  });

  it('falls through to full-image when even the fine-tuned crop fails', async () => {
    routeByStage({ full: () => modelReplies(JSON.stringify({ players: [...halfTeam(), ...halfTeam()] })) });

    const result = await extractBoxScore(Buffer.from('this is not an image'), 'scorecheck-ocr-r5:latest');

    // The fine-tuned path crops twice — once per half, once for the table — and both fail
    // on an unreadable buffer, so it ends on the uncropped full-image call.
    expect(result.players).toHaveLength(10);
    expect(stagesCalled()).toEqual(['full']);
    expect(warned()).toMatch(/Full-image fallback failed/);
  });

  it('retries an unparseable full-image reply and then fails', async () => {
    // The only path that sleeps (RETRY_DELAY, 30s), so timers are faked. setImmediate is
    // left real: sharp settles on the thread pool, which no amount of timer advancing frees.
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      // First attempt returns JSON that is simply not a box score, the rest return prose —
      // the two ways a reply can be useless, both retried the same way.
      let attempt = 0;
      routeByStage({
        full: () => modelReplies(++attempt === 1 ? '{"rows":[]}' : 'not json at all'),
      });

      const settled = extractBoxScore(Buffer.from('not an image'), PLAIN_MODEL).then(
        () => null,
        (e: unknown) => e,
      );
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setImmediate(r));
        await jest.advanceTimersByTimeAsync(30_000);
      }

      expect(await settled).toBeInstanceOf(OllamaExtractionError);
      expect(stagesCalled()).toEqual(['full', 'full', 'full']);
    } finally {
      jest.useRealTimers();
    }
  }, 15_000);
});
