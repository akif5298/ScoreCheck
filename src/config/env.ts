import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env before validating. Imported first in the server entrypoint so a
// misconfigured environment fails fast with a clear message instead of a late
// runtime `undefined`.
dotenv.config();

const rawSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),

    // Database — runtime uses the pooled URL; migrations use the direct URL.
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DIRECT_DATABASE_URL: z.string().optional(),

    // Supabase (project URL + storage/service keys). Both old and new key
    // names are accepted; at least one of each pair must be present.
    SUPABASE_URL: z.string().url('SUPABASE_URL must be a URL'),
    SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
    SUPABASE_ANON_KEY: z.string().optional(),
    SUPABASE_SECRET_KEY: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

    // Auth
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_EXPIRES_IN: z.string().default('7d'),
    // Signups are disabled when unset.
    INVITE_CODE: z.string().optional(),

    // Extraction (Ollama). BASE_URL points at the fine-tuned model host;
    // API_KEY is sent as a bearer token when the host requires auth.
    OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
    OLLAMA_EXTRACTION_MODEL: z.string().optional(),
    OLLAMA_API_KEY: z.string().optional(),

    // Ops
    CORS_ORIGIN: z.string().optional(),
    LOG_LEVEL: z.string().optional(),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().optional(),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().optional(),
    EXTRACTION_DAILY_LIMIT: z.coerce.number().int().positive().default(50),
    MAX_FILE_SIZE: z.coerce.number().int().positive().optional(),
    PG_POOL_MAX: z.coerce.number().int().positive().optional(),
  });

/**
 * The two Supabase keys each accept a current or a legacy name, so "at least one of the
 * pair" is a cross-field rule rather than a per-field one.
 *
 * Deliberately not a .superRefine: zod skips refinements as soon as any field fails, so a
 * fresh deployment missing DATABASE_URL *and* both key pairs would be told only about
 * DATABASE_URL, fix it, redeploy, and only then learn about the keys. Checking the pairs
 * independently reports everything in one pass.
 */
function keyPairIssues(source: NodeJS.ProcessEnv): string[] {
  const issues: string[] = [];
  if (!source.SUPABASE_PUBLISHABLE_KEY && !source.SUPABASE_ANON_KEY) {
    issues.push('SUPABASE_PUBLISHABLE_KEY: Set SUPABASE_PUBLISHABLE_KEY (or legacy SUPABASE_ANON_KEY)');
  }
  if (!source.SUPABASE_SECRET_KEY && !source.SUPABASE_SERVICE_ROLE_KEY) {
    issues.push('SUPABASE_SECRET_KEY: Set SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)');
  }
  return issues;
}

function reportAndExit(issues: string[]): never {
  const formatted = issues.map((i) => `  - ${i}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`\nInvalid environment configuration:\n${formatted}\n`);
  process.exit(1);
}

const parsed = rawSchema.safeParse(process.env);
const pairIssues = keyPairIssues(process.env);

if (!parsed.success) {
  reportAndExit([
    ...parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    ...pairIssues,
  ]);
}

if (pairIssues.length > 0) {
  reportAndExit(pairIssues);
}

const e = parsed.data;

export const env = {
  ...e,
  // Normalized accessors so the rest of the app doesn't branch on key names.
  supabasePublishableKey: (e.SUPABASE_PUBLISHABLE_KEY || e.SUPABASE_ANON_KEY)!,
  supabaseSecretKey: (e.SUPABASE_SECRET_KEY || e.SUPABASE_SERVICE_ROLE_KEY)!,
  isProduction: e.NODE_ENV === 'production',
};

export type Env = typeof env;
