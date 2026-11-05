// _shared/supabaseKeys.ts — single place that resolves the project's Supabase API keys.
//
// 2026-11-05 incident: the legacy JWT `service_role` key was stolen and had to be DISABLED (it cannot be
// rotated). Supabase now injects the new opaque keys into every Edge Function as JSON maps:
//   SUPABASE_SECRET_KEYS      {"<name>": "sb_secret_..."}      (elevated — bypasses RLS)
//   SUPABASE_PUBLISHABLE_KEYS {"<name>": "sb_publishable_..."} (browser-safe)
// alongside the legacy SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY, which are dead once legacy keys are
// disabled. Every function must read keys through these helpers — never Deno.env.get("SUPABASE_SERVICE_ROLE_KEY").
//
// Resolution order (first non-empty wins):
//   secret:      SB_SECRET_KEY (manual override) → SUPABASE_SECRET_KEYS["default" | single | first]
//                → SUPABASE_SERVICE_ROLE_KEY → SECRET_KEY → "Secret Key"   (legacy fallbacks, harmless when dead)
//   publishable: SB_PUBLISHABLE_KEY → SUPABASE_PUBLISHABLE_KEYS[...] → SUPABASE_ANON_KEY → SUPABASE_PUBLISHABLE_KEY

function fromJsonMap(envName: string): string | undefined {
  const raw = Deno.env.get(envName);
  if (!raw) return undefined;
  try {
    const map = JSON.parse(raw) as Record<string, unknown>;
    const entries = Object.entries(map).filter(([, v]) => typeof v === "string" && (v as string).length > 0);
    if (!entries.length) return undefined;
    if (entries.length === 1) return entries[0][1] as string;
    const def = entries.find(([k]) => k === "default");
    return (def ?? entries[0])[1] as string;
  } catch {
    // Some runtimes may expose a bare key instead of a JSON map.
    return raw.startsWith("sb_") ? raw : undefined;
  }
}

const first = (...vals: Array<string | undefined>) => vals.find((v) => typeof v === "string" && v.length > 0);

/** The elevated (service-role equivalent) key. `undefined` when none is configured. */
export function getServiceKey(): string | undefined {
  return first(
    Deno.env.get("SB_SECRET_KEY"),
    fromJsonMap("SUPABASE_SECRET_KEYS"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    Deno.env.get("SECRET_KEY"),
    Deno.env.get("Secret Key"),
  );
}

/** The browser-safe key used to build user-context clients. */
export function getPublishableKey(): string | undefined {
  return first(
    Deno.env.get("SB_PUBLISHABLE_KEY"),
    fromJsonMap("SUPABASE_PUBLISHABLE_KEYS"),
    Deno.env.get("SUPABASE_ANON_KEY"),
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),
  );
}

/** Every value that must be treated as a privileged caller credential (for bearer/apikey comparisons). */
export function allServiceKeys(): string[] {
  const out = new Set<string>();
  const add = (v?: string) => { if (v) out.add(v); };
  add(Deno.env.get("SB_SECRET_KEY"));
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try { for (const v of Object.values(JSON.parse(raw) as Record<string, unknown>)) if (typeof v === "string") add(v); } catch { add(raw.startsWith("sb_") ? raw : undefined); }
  }
  add(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  add(Deno.env.get("SECRET_KEY"));
  add(Deno.env.get("Secret Key"));
  return [...out];
}

/** Every public (non-privileged) key — these must never authorise anything. */
export function allPublishableKeys(): string[] {
  const out = new Set<string>();
  const add = (v?: string) => { if (v) out.add(v); };
  add(Deno.env.get("SB_PUBLISHABLE_KEY"));
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (raw) {
    try { for (const v of Object.values(JSON.parse(raw) as Record<string, unknown>)) if (typeof v === "string") add(v); } catch { add(raw.startsWith("sb_") ? raw : undefined); }
  }
  add(Deno.env.get("SUPABASE_ANON_KEY"));
  add(Deno.env.get("SUPABASE_PUBLISHABLE_KEY"));
  return [...out];
}

/**
 * Headers for server-to-server calls to our own Edge Functions (cron-style). The new keys must travel in
 * `apikey`; we also send them as a bearer so `requireOrgAdmin` recognises the caller on no-verify-jwt functions.
 */
export function serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = getServiceKey() ?? "";
  return { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}`, ...extra };
}
