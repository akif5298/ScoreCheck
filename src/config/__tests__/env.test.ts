/**
 * Unit tests for environment validation.
 *
 * This module is the app's fail-fast boundary: it runs at import time, and on a bad
 * config it prints and calls process.exit(1) rather than letting an `undefined` surface
 * as a confusing runtime error twenty files away. Both halves of that contract are worth
 * pinning — that a valid environment produces the right normalised values, and that an
 * invalid one dies loudly with a message naming the variable at fault.
 *
 * dotenv is mocked so the developer's real .env cannot leak in and make results depend on
 * whose machine is running the suite.
 */
jest.mock('dotenv', () => ({
  __esModule: true,
  default: { config: jest.fn() },
  config: jest.fn(),
}));

/** Every variable the schema reads. Cleared before each load so tests start from nothing. */
const MANAGED = [
  'NODE_ENV', 'PORT',
  'DATABASE_URL', 'DIRECT_DATABASE_URL',
  'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY',
  'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET', 'JWT_EXPIRES_IN', 'INVITE_CODE',
  'OLLAMA_BASE_URL', 'OLLAMA_EXTRACTION_MODEL', 'OLLAMA_API_KEY',
  'CORS_ORIGIN', 'LOG_LEVEL', 'RATE_LIMIT_WINDOW_MS', 'RATE_LIMIT_MAX_REQUESTS',
  'EXTRACTION_DAILY_LIMIT', 'MAX_FILE_SIZE', 'PG_POOL_MAX',
] as const;

/** The smallest environment the schema accepts. */
const MINIMAL: Record<string, string> = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/scorecheck',
  SUPABASE_URL: 'http://localhost:1',
  SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
  SUPABASE_SECRET_KEY: 'secret-key',
  JWT_SECRET: 'a'.repeat(32),
};

const ORIGINAL_ENV = process.env;
let exitSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  for (const key of MANAGED) delete process.env[key];

  // process.exit does not return, so the module never reaches `parsed.data`. Throwing
  // reproduces that control flow; mocking it as a no-op would let execution fall into a
  // TypeError and hide which check actually fired.
  exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.restoreAllMocks();
});

/** Loads a fresh copy of the module under the given environment. */
async function loadEnv(vars: Record<string, string> = MINIMAL) {
  Object.assign(process.env, vars);
  let mod!: typeof import('@/config/env');
  await jest.isolateModulesAsync(async () => {
    mod = await import('@/config/env');
  });
  return mod.env;
}

/** Loads under a bad environment and hands back what was printed before exiting. */
async function loadExpectingExit(vars: Record<string, string>): Promise<string> {
  await expect(loadEnv(vars)).rejects.toThrow('process.exit(1)');
  expect(exitSpy).toHaveBeenCalledWith(1);
  return errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
}

describe('a valid environment', () => {
  it('applies every default so an unset optional never reads as undefined', async () => {
    const env = await loadEnv();

    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3001,
      JWT_EXPIRES_IN: '7d',
      OLLAMA_BASE_URL: 'http://localhost:11434',
      EXTRACTION_DAILY_LIMIT: 50,
    });
  });

  it('coerces numeric variables out of their string form', async () => {
    const env = await loadEnv({
      ...MINIMAL,
      PORT: '4000',
      RATE_LIMIT_WINDOW_MS: '60000',
      RATE_LIMIT_MAX_REQUESTS: '10',
      EXTRACTION_DAILY_LIMIT: '5',
      MAX_FILE_SIZE: '1048576',
      PG_POOL_MAX: '3',
    });

    // Every one of these is used in arithmetic or passed to a library expecting a number.
    expect(env).toMatchObject({
      PORT: 4000,
      RATE_LIMIT_WINDOW_MS: 60000,
      RATE_LIMIT_MAX_REQUESTS: 10,
      EXTRACTION_DAILY_LIMIT: 5,
      MAX_FILE_SIZE: 1048576,
      PG_POOL_MAX: 3,
    });
  });

  it('leaves INVITE_CODE undefined when unset, which is what disables signups', async () => {
    expect((await loadEnv()).INVITE_CODE).toBeUndefined();
  });

  it.each([
    ['development', false],
    ['test', false],
    ['production', true],
  ])('sets isProduction to %s -> %s', async (nodeEnv, expected) => {
    expect((await loadEnv({ ...MINIMAL, NODE_ENV: nodeEnv })).isProduction).toBe(expected);
  });
});

describe('normalising the two generations of Supabase key names', () => {
  it('prefers the current publishable key', async () => {
    const env = await loadEnv({
      ...MINIMAL,
      SUPABASE_PUBLISHABLE_KEY: 'current',
      SUPABASE_ANON_KEY: 'legacy',
    });

    expect(env.supabasePublishableKey).toBe('current');
  });

  it('falls back to the legacy anon key', async () => {
    const { SUPABASE_PUBLISHABLE_KEY: _drop, ...rest } = MINIMAL;
    const env = await loadEnv({ ...rest, SUPABASE_ANON_KEY: 'legacy' });

    expect(env.supabasePublishableKey).toBe('legacy');
  });

  it('prefers the current secret key', async () => {
    const env = await loadEnv({
      ...MINIMAL,
      SUPABASE_SECRET_KEY: 'current',
      SUPABASE_SERVICE_ROLE_KEY: 'legacy',
    });

    expect(env.supabaseSecretKey).toBe('current');
  });

  it('falls back to the legacy service-role key', async () => {
    const { SUPABASE_SECRET_KEY: _drop, ...rest } = MINIMAL;
    const env = await loadEnv({ ...rest, SUPABASE_SERVICE_ROLE_KEY: 'legacy' });

    expect(env.supabaseSecretKey).toBe('legacy');
  });
});

describe('an invalid environment', () => {
  it('names the missing DATABASE_URL', async () => {
    const { DATABASE_URL: _drop, ...rest } = MINIMAL;

    // Zod's own "Required" — the schema's custom message only applies to a value that is
    // present but empty, which is the next case.
    expect(await loadExpectingExit(rest)).toMatch(/DATABASE_URL: Required/);
  });

  it('rejects a DATABASE_URL set to an empty string', async () => {
    // A variable defined-but-blank in a dashboard is the likelier misconfiguration of the
    // two, and it is the one that reaches the schema's own message.
    const printed = await loadExpectingExit({ ...MINIMAL, DATABASE_URL: '' });

    expect(printed).toMatch(/DATABASE_URL: DATABASE_URL is required/);
  });

  it('rejects a JWT_SECRET short enough to brute force', async () => {
    const printed = await loadExpectingExit({ ...MINIMAL, JWT_SECRET: 'a'.repeat(31) });

    expect(printed).toMatch(/JWT_SECRET must be at least 32 characters/);
  });

  it('accepts a JWT_SECRET of exactly 32 characters', async () => {
    // The boundary either way: 31 exits above, 32 must not.
    await expect(loadEnv({ ...MINIMAL, JWT_SECRET: 'a'.repeat(32) })).resolves.toBeDefined();
  });

  it('rejects a SUPABASE_URL that is not a URL', async () => {
    const printed = await loadExpectingExit({ ...MINIMAL, SUPABASE_URL: 'not-a-url' });

    expect(printed).toMatch(/SUPABASE_URL must be a URL/);
  });

  it('rejects an unknown NODE_ENV rather than silently treating it as development', async () => {
    const printed = await loadExpectingExit({ ...MINIMAL, NODE_ENV: 'staging' });

    expect(printed).toMatch(/NODE_ENV/);
  });

  it.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['not a number', 'http'],
  ])('rejects a PORT that is %s', async (_label, port) => {
    expect(await loadExpectingExit({ ...MINIMAL, PORT: port })).toMatch(/PORT/);
  });

  it('demands a publishable key under either name', async () => {
    const { SUPABASE_PUBLISHABLE_KEY: _drop, ...rest } = MINIMAL;

    // The superRefine pair: neither name present is the only failing combination.
    expect(await loadExpectingExit(rest)).toMatch(
      /SUPABASE_PUBLISHABLE_KEY: Set SUPABASE_PUBLISHABLE_KEY \(or legacy SUPABASE_ANON_KEY\)/,
    );
  });

  it('demands a secret key under either name', async () => {
    const { SUPABASE_SECRET_KEY: _drop, ...rest } = MINIMAL;

    expect(await loadExpectingExit(rest)).toMatch(
      /SUPABASE_SECRET_KEY: Set SUPABASE_SECRET_KEY \(or legacy SUPABASE_SERVICE_ROLE_KEY\)/,
    );
  });

  it('reports field and cross-field problems together in one pass', async () => {
    // Deploying against a fresh environment usually means several are wrong at once, and
    // fixing them one boot at a time is the failure mode this avoids. The key-pair checks
    // are deliberately not a zod refinement, because zod skips refinements as soon as any
    // field fails — which used to hide them behind a missing DATABASE_URL.
    const printed = await loadExpectingExit({ SUPABASE_URL: 'http://localhost:1' });

    expect(printed).toMatch(/DATABASE_URL/);
    expect(printed).toMatch(/JWT_SECRET/);
    expect(printed).toMatch(/SUPABASE_PUBLISHABLE_KEY/);
    expect(printed).toMatch(/SUPABASE_SECRET_KEY/);
  });

  it('reports the key pairs on their own when every field is valid', async () => {
    const { SUPABASE_PUBLISHABLE_KEY: _pk, SUPABASE_SECRET_KEY: _sk, ...rest } = MINIMAL;

    const printed = await loadExpectingExit(rest);

    expect(printed).toMatch(/SUPABASE_PUBLISHABLE_KEY/);
    expect(printed).toMatch(/SUPABASE_SECRET_KEY/);
    expect(printed).not.toMatch(/DATABASE_URL/);
  });
});
