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

  // pino's file-transport worker thread keeps Jest workers alive after tests complete
  forceExit: true,
};

export default config;
