/**
 * Unit tests for the Prisma client singleton.
 *
 * Fourteen lines, but the globalThis cache is the whole point: without it a dev server
 * that re-evaluates modules on reload constructs a new PrismaClient each time, and each
 * one opens its own connection pool until Postgres refuses new connections. The cache is
 * deliberately skipped in production, where modules are evaluated once.
 */
const constructed: object[] = [];

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => {
    const client = { id: constructed.length + 1 };
    constructed.push(client);
    return client;
  }),
}));

import { PrismaClient } from '@prisma/client';

const MockedPrismaClient = PrismaClient as unknown as jest.Mock;

/**
 * database.ts already declares `var prisma: PrismaClient | undefined` on the global scope,
 * so the cache is reached through a cast rather than a second ambient declaration — two
 * declarations of one global must agree on type, and the mock's stand-in client does not.
 */
const globalCache = globalThis as { prisma?: unknown };

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  constructed.length = 0;
  MockedPrismaClient.mockClear();
  delete globalCache.prisma;
});

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  delete globalCache.prisma;
});

/** Loads a fresh copy of the module, as a reload or a second entrypoint would. */
async function loadModule() {
  let mod!: typeof import('@/services/database');
  await jest.isolateModulesAsync(async () => {
    mod = await import('@/services/database');
  });
  return mod;
}

describe('outside production', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  it('constructs a client when none is cached', async () => {
    const { prisma } = await loadModule();

    expect(MockedPrismaClient).toHaveBeenCalledTimes(1);
    expect(prisma).toBe(constructed[0]);
  });

  it('caches the client on globalThis', async () => {
    const { prisma } = await loadModule();

    expect(globalCache.prisma).toBe(prisma);
  });

  it('reuses the cached client on a reload instead of opening a second pool', async () => {
    const first = await loadModule();
    const second = await loadModule();

    // One construction across two module evaluations — this is the connection leak fix.
    expect(MockedPrismaClient).toHaveBeenCalledTimes(1);
    expect(second.prisma).toBe(first.prisma);
  });

  it('adopts a client another module already cached', async () => {
    const preexisting = { id: 'set-up-elsewhere' };
    globalCache.prisma = preexisting;

    const { prisma } = await loadModule();

    expect(MockedPrismaClient).not.toHaveBeenCalled();
    expect(prisma).toBe(preexisting);
  });
});

describe('in production', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });

  it('constructs a client without caching it', async () => {
    const { prisma } = await loadModule();

    expect(prisma).toBe(constructed[0]);
    // Nothing reloads modules in production, so the global would be pure leaked state.
    expect(globalCache.prisma).toBeUndefined();
  });
});

describe('the module contract', () => {
  it('exports the same client as both the named and default export', async () => {
    const mod = await loadModule();

    // Both spellings are used across the codebase; they must not diverge.
    expect(mod.default).toBe(mod.prisma);
  });
});
