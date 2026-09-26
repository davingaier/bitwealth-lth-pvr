import { z } from "zod";
import { TIMEFRAMES, type Timeframe } from "./exchange/types.ts";

const tfList = z.string().transform((s) =>
  s.split(",").map((x) => x.trim()).filter(Boolean) as Timeframe[]
).pipe(z.array(z.enum(TIMEFRAMES)));

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  TA_BOT_ORG_ID: z.string().uuid(),
  TA_BOT_WORKER_ID: z.string().default("worker-1"),
  BYBIT_PUBLIC_ENV: z.enum(["mainnet", "testnet"]).default("mainnet"),
  TA_BOT_TIMEFRAMES: tfList.default("1m,5m,15m,1h,4h,1d"),
  TA_BOT_BACKFILL_DAYS: z.string().default('{"1m":7,"5m":30,"15m":90,"1h":365,"4h":730,"1d":1825}')
    .transform((s) => JSON.parse(s) as Record<string, number>)
    .pipe(z.record(z.enum(TIMEFRAMES), z.number().positive())),
  BYBIT_TESTNET_API_KEY: z.string().optional(),
  BYBIT_TESTNET_API_SECRET: z.string().optional(),
  HEALTH_PORT: z.coerce.number().int().default(8080),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof EnvSchema>;

let cached: Config | undefined;

export function loadConfig(): Config {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(Deno.env.toObject());
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const WORKER_VERSION = "0.1.0";
