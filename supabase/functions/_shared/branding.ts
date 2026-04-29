// _shared/branding.ts
// Single source of truth for BitWealth brand asset URLs used in PDFs, emails and
// any other server-rendered surface. To swap the logo at runtime, simply replace
// the file in the `branding` Storage bucket — no edge function redeploy is needed.

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL") ?? "";

function publicAsset(path: string): string {
  // Strip trailing slash defensively.
  const base = SUPABASE_URL.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/branding/${path}`;
}

export const BRAND = {
  navy: "#032C48",
  gold: "#C9A04A",
  // Logos
  logoTransparentSvg: publicAsset("bitwealth_logo_transparent.svg"),
  logoWhiteSvg: publicAsset("bitwealth_logo_white.svg"),
  // Org details
  legalName: "BitWealth (Pty) Ltd",
  websiteUrl: Deno.env.get("WEBSITE_URL") ?? "https://bitwealth.co.za",
  supportEmail: "support@bitwealth.co.za",
} as const;
