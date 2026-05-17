/**
 * Strongly-typed env loading.
 *
 * NEVER reach for `process.env` outside this module. All consumers must
 * import `env` from here so missing/misformatted values fail at boot, not
 * in the middle of a money movement.
 */
import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Lightweight .env loader (dev convenience only). Walks up from cwd looking
 * for `.env`; first hit wins. In production, container env / vault inject the
 * vars and this function is a no-op.
 */
function loadDotEnvIfPresent(): void {
  if (process.env.NODE_ENV === 'production') return;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const p = resolve(dir, '.env');
    if (existsSync(p)) {
      const content = readFileSync(p, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        if (process.env[key] !== undefined) continue;
        const val = trimmed.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
        process.env[key] = val;
      }
      return;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
}
loadDotEnvIfPresent();

const HexKey32 = z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 32 bytes hex (64 chars)');
const NonEmpty = z.string().min(1);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  API_PUBLIC_URL: NonEmpty,
  WEB_PUBLIC_URL: NonEmpty,
  CORS_ORIGINS: z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),

  DATABASE_URL: NonEmpty,
  REDIS_URL: NonEmpty,

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  PII_ENCRYPTION_KEY: HexKey32,
  QUOTE_SIGNING_KEY: z.string().min(32),
  WEBHOOK_SIGNING_SECRET: z.string().min(32),

  WEBAUTHN_RP_ID: NonEmpty,
  WEBAUTHN_RP_NAME: NonEmpty,
  WEBAUTHN_ORIGIN: NonEmpty,

  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  RATE_LIMIT_GLOBAL_PER_MIN: z.coerce.number().int().positive().default(600),
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().positive().default(10),

  WITHDRAWAL_AUTO_APPROVE_USD: z.coerce.number().nonnegative().default(1000),
  WITHDRAWAL_MANUAL_REVIEW_USD: z.coerce.number().nonnegative().default(5000),
  QUOTE_TTL_SECONDS: z.coerce.number().int().positive().default(45),

  // Provider secrets — all optional so dev works without them, but required
  // by individual provider adapters when used.
  MPESA_BASE_URL: z.string().optional(),
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),

  MTN_MOMO_BASE_URL: z.string().optional(),
  MTN_MOMO_API_KEY: z.string().optional(),
  MTN_MOMO_SUBSCRIPTION_KEY: z.string().optional(),

  ORANGE_MONEY_BASE_URL: z.string().optional(),
  ORANGE_MONEY_CLIENT_ID: z.string().optional(),
  ORANGE_MONEY_CLIENT_SECRET: z.string().optional(),

  AIRTEL_MONEY_BASE_URL: z.string().optional(),
  AIRTEL_MONEY_CLIENT_ID: z.string().optional(),
  AIRTEL_MONEY_CLIENT_SECRET: z.string().optional(),

  FLUTTERWAVE_BASE_URL: z.string().optional(),
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  FLUTTERWAVE_WEBHOOK_SECRET: z.string().optional(),

  PAYSTACK_BASE_URL: z.string().optional(),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_WEBHOOK_SECRET: z.string().optional(),

  EVM_ETHEREUM_RPC_URL: z.string().optional(),
  EVM_POLYGON_RPC_URL: z.string().optional(),
  EVM_BASE_RPC_URL: z.string().optional(),
  SOLANA_RPC_URL: z.string().optional(),
  STELLAR_HORIZON_URL: z.string().optional(),

  USDC_ETHEREUM: z.string().optional(),
  USDC_POLYGON: z.string().optional(),
  USDC_BASE: z.string().optional(),
  USDT_ETHEREUM: z.string().optional(),
  USDT_POLYGON: z.string().optional(),

  PRICE_FEED_PROVIDER: z.enum(['coingecko', 'chainlink', 'internal']).default('coingecko'),
  PRICE_FEED_API_KEY: z.string().optional(),

  SANCTIONS_PROVIDER_URL: z.string().optional(),
  SANCTIONS_PROVIDER_API_KEY: z.string().optional(),
  KYC_PROVIDER_URL: z.string().optional(),
  KYC_PROVIDER_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

/** For tests: reset the cached env. */
export function _resetEnvForTests(): void {
  cached = undefined;
}
