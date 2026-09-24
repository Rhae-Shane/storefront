import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();
dotenv.config({ path: '.env.local', override: true });

const postgresUrl = z
  .string()
  .min(1)
  .refine(
    (value) =>
      value.startsWith('postgresql://') || value.startsWith('postgres://'),
    'must be a postgresql:// connection string',
  );

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3002),
  BASE_URL: z.url().default('http://localhost:3002'),
  DATABASE_URL: postgresUrl,
  DIRECT_URL: postgresUrl,
  API_KEY: z.string().min(8, 'API_KEY must be at least 8 characters'),
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z
    .string()
    .regex(/^\d+[smhd]$/, 'JWT_ACCESS_EXPIRES_IN must look like 15m, 1h, 7d')
    .default('15m'),
  JWT_REFRESH_EXPIRES_DAYS: z.coerce.number().int().positive().default(30),
  JWT_ISSUER: z.string().min(1).default('shopping-cart'),
  JWT_AUDIENCE: z.string().min(1).default('shopping-cart-api'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WRITE_MAX: z.coerce.number().int().positive().default(30),
  /** When unset: seed on start in development only (never in production). */
  SEED_ON_START: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      return v === 'true' || v === '1';
    }),
  // Supabase Storage (S3-compatible) — optional at boot; required for image sync
  SUPABASE_URL: z.url().optional(),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).default('product-images'),
  // Upstash Redis (REST) — shared rate limits + short-lived product cache
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  /** Soft stock hold TTL in Redis (seconds). Default 15 minutes. */
  STOCK_HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(900),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
    .join('\n');
  console.error('Invalid environment configuration:\n' + details);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  nodeEnv: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  port: env.PORT,
  baseUrl: env.BASE_URL,
  databaseUrl: env.DATABASE_URL,
  directUrl: env.DIRECT_URL,
  apiKey: env.API_KEY,
  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresDays: env.JWT_REFRESH_EXPIRES_DAYS,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  },
  logLevel: env.LOG_LEVEL,
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    writeMax: env.RATE_LIMIT_WRITE_MAX,
  },
  seedOnStart:
    env.SEED_ON_START ??
    (env.NODE_ENV === 'development' || env.NODE_ENV === 'test'),
  storage: {
    supabaseUrl: env.SUPABASE_URL ?? 'https://pjzkjfhuxfnvhdcrbznz.supabase.co',
    endpoint:
      env.S3_ENDPOINT ??
      'https://pjzkjfhuxfnvhdcrbznz.storage.supabase.co/storage/v1/s3',
    region: env.S3_REGION ?? 'ap-northeast-1',
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    bucket: env.S3_BUCKET,
    publicObjectBase: `${env.SUPABASE_URL ?? 'https://pjzkjfhuxfnvhdcrbznz.supabase.co'}/storage/v1/object/public/${env.S3_BUCKET}`,
  },
  redis: {
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  },
  /** Soft cart reservations in Redis (Postgres still wins at checkout). */
  stockHold: {
    ttlSeconds: env.STOCK_HOLD_TTL_SECONDS,
  },
} as const;
