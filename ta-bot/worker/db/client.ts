import postgres, { type JSONValue } from "postgres";
import { loadConfig } from "../config.ts";

let instance: ReturnType<typeof postgres> | undefined;

/** Wrap any serialisable value as a jsonb parameter. */
export function jsonb(v: unknown) {
  return db().json(v as JSONValue);
}

/** Shared postgres.js client. numeric → number, timestamptz → Date. */
export function db() {
  if (instance) return instance;
  const cfg = loadConfig();
  instance = postgres(cfg.DATABASE_URL, {
    ssl: "require",
    max: 4,
    idle_timeout: 60,
    connect_timeout: 30,
    prepare: false, // required when going through Supavisor transaction pooler
    types: {
      numeric: { to: 1700, from: [1700], serialize: (x: number | string) => String(x), parse: (x: string) => Number(x) },
    },
  });
  return instance;
}

export type Sql = ReturnType<typeof db>;

export async function closeDb(): Promise<void> {
  if (!instance) return;
  await instance.end({ timeout: 5 });
  instance = undefined;
}
