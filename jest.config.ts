import type { Config } from 'jest';

// Shared by both projects so module resolution cannot drift between them.
const shared = {
  preset: 'ts-jest',
  testEnvironment: 'node' as const,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};

const config: Config = {
  projects: [
    {
      ...shared,
      displayName: 'unit',
      roots: ['<rootDir>/src'],
      testMatch: ['**/__tests__/**/*.test.ts'],
    },
    {
      ...shared,
      displayName: 'integration',
      // Lives outside src/ deliberately: tsconfig.json sets rootDir to ./src, so a test
      // under src/ importing a helper from test/ would fail `npm run build:api`.
      roots: ['<rootDir>/test/integration'],
      testMatch: ['**/*.test.ts'],
      // setup-env must run before any test module is imported: supabase.ts builds its
      // pg.Pool from DATABASE_URL at module scope. See that file's header.
      setupFiles: ['<rootDir>/test/integration/setup-env.ts'],
      setupFilesAfterEnv: ['<rootDir>/test/integration/setup-db.ts'],
      globalSetup: '<rootDir>/test/integration/global-setup.ts',
    },
  ],

  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/__tests__/**',
    '!src/**/__integration__/**',
    // Generated Supabase row types — declarations only, nothing executable.
    '!src/types/supabase.ts',
  ],

  // Floors, not targets. Set a shade under what the suite actually reaches (96.73 statements /
  // 90.38 branches / 96.29 functions / 97.39 lines) so ordinary refactoring has room to move
  // while a whole file landing untested fails the build.
  //
  // These actuals dipped slightly when the seven dead player_stats/player_totals aggregate
  // helpers were deleted: they were fully covered, so removing them removed more covered
  // code than uncovered. Branches has the least headroom (0.38) — if a change trips that
  // floor, check it is genuinely new uncovered branching before touching the number.
  //
  // Only enforced when coverage is collected, which is why CI runs `test:coverage` rather than
  // plain `jest` — a bare `npm test` still passes on an uncovered file, by design, so the
  // fast local loop stays fast.
  coverageThreshold: {
    global: {
      statements: 96,
      branches: 90,
      functions: 96,
      lines: 97,
    },
  },

  // pino's file-transport worker thread keeps Jest workers alive after tests complete
  forceExit: true,
};

export default config;
