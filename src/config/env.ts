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
  })
  .superRefine((val, ctx) => {
    if (!val.SUPABASE_PUBLISHABLE_KEY && !val.SUPABASE_ANON_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Set SUPABASE_PUBLISHABLE_KEY (or legacy SUPABASE_ANON_KEY)',
        path: ['SUPABASE_PUBLISHABLE_KEY'],
      });
    }
    if (!val.SUPABASE_SECRET_KEY && !val.SUPABASE_SERVICE_ROLE_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Set SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)',
        path: ['SUPABASE_SECRET_KEY'],
      });
    }
  });

const parsed = rawSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\nInvalid environment configuration:\n${issues}\n`);
  process.exit(1);
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
