import { z } from 'zod';

const emptyToUndefined = (v: unknown): unknown => (v === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const bool = (fallback: boolean) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1' || v === true),
    z.boolean(),
  );

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_BASE_URL: z.url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1).default('pglite://.data/dev'),
  SESSION_SECRET: optionalString,
  // There is no live mode: any other value fails at boot.
  PAYPAL_ENV: z.literal('sandbox', { error: 'PAYPAL_ENV must be exactly "sandbox"' }),
  PAYPAL_CLIENT_ID: optionalString,
  PAYPAL_CLIENT_SECRET: optionalString,
  PAYPAL_WEBHOOK_ID: optionalString,
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
  GEMINI_DAILY_REQUEST_LIMIT: z.coerce.number().int().min(0).default(450),
  CHECK_RUNNER: z.enum(['inline', 'render']).default('inline'),
  RENDER_API_KEY: optionalString,
  RENDER_WORKFLOW_SLUG: z.string().min(1).default('bountyline-checks'),
  JUDGE_MODE: bool(false),
  DEMO_MANAGER_EMAIL: z.preprocess(emptyToUndefined, z.email().default('manager@bountyline.demo')),
  DEMO_MANAGER_PASSWORD: optionalString,
  DEMO_CLAIMANT_PAYPAL_EMAIL: z.preprocess(emptyToUndefined, z.email().optional()),
  VITE_AG_STUDIO_LICENSE_KEY: optionalString,
  VITE_DESK_ASSISTANT: bool(false),
});

export type RawEnv = z.infer<typeof EnvSchema>;

export interface AppConfig extends RawEnv {
  /** Always the sandbox host; derived, never configurable . */
  readonly paypalBaseUrl: string;
  readonly isProduction: boolean;
}

export const PAYPAL_SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Parses environment variables; throws a readable ConfigError when invalid. */
export function parseEnv(source: Record<string, string | undefined>): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`Invalid environment:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)) {
    throw new ConfigError(
      'Invalid environment:\n  SESSION_SECRET: at least 32 characters in production',
    );
  }
  return Object.freeze({
    ...env,
    paypalBaseUrl: PAYPAL_SANDBOX_BASE_URL,
    isProduction: env.NODE_ENV === 'production',
  });
}

/** Reads the process environment. The only place in the repo that touches process.env. */
export function loadEnv(): AppConfig {
  return parseEnv(process.env);
}

/** Names of every variable we know, with set or missing; never values. */
export function envReport(
  source: Record<string, string | undefined>,
): { name: string; set: boolean }[] {
  return Object.keys(EnvSchema.shape).map((name) => ({
    name,
    set: typeof source[name] === 'string' && source[name] !== '',
  }));
}

/** envReport over the process environment (`pnpm env:check`). */
export function processEnvReport(): { name: string; set: boolean }[] {
  return envReport(process.env);
}

/** Reads one process variable by name for tooling scripts (base URLs and flags, never secrets). */
export function readProcessVar(name: string): string | undefined {
  return process.env[name];
}
