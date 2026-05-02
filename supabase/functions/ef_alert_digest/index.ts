// index.ts – ef_alert_digest
// Sends an email for NEW open error/critical alerts (notified_at IS NULL)

import { getServiceClient } from "./client.ts";
import { sendTextEmail } from "../_shared/smtp.ts";

type AlertRow = {
  alert_id: string;
  created_at: string;
  first_seen_at: string | null;
  last_seen_at: string | null;
  occurrence_count: number | null;
  severity: string;
  component: string;
  message: string;
};

async function sendEmail(subject: string, text: string) {
  const from = Deno.env.get("ALERT_EMAIL_FROM") || "admin@bitwealth.co.za";
  const to = Deno.env.get("ALERT_EMAIL_TO") || "admin@bitwealth.co.za";

  const result = await sendTextEmail(to, from, subject, text);

  if (!result.success) {
    throw new Error(`SMTP error: ${result.error}`);
  }
}

Deno.serve(async (req: Request) => {
  try {
    const sb = getServiceClient();

    // Optional override via JSON payload, e.g. for manual tests
    let body: any = {};
    try { body = await req.json(); } catch (_) { body = {}; }

    const org_id =
      (typeof body.org_id === "string" && body.org_id) ||
      Deno.env.get("ORG_ID") ||
      null;

    if (!org_id) {
      return new Response("ORG_ID missing", { status: 500 });
    }

  // 1) Load NEW open error/critical alerts (never notified)
  const { data, error } = await sb
    .schema("public")
    .from("alert_events")
    .select("alert_id, created_at, first_seen_at, last_seen_at, occurrence_count, severity, component, message")
    .eq("org_id", org_id)
    .in("severity", ["error", "critical"])
    .is("resolved_at", null)
    .is("notified_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("ef_alert_digest: select error", error);
    return new Response(error.message, { status: 500 });
  }

  const alerts = data ?? [];
  if (alerts.length === 0) {
    console.log("ef_alert_digest: no new alerts to notify");
    return new Response("no new alerts", { status: 200 });
  }

  // 2) Build email text
  const lines: string[] = [];
  lines.push(`Hi Dav,`);
  lines.push("");
  lines.push(`There are ${alerts.length} NEW open alert(s) for org_id=${org_id}:`);
  lines.push("");

  for (const a of alerts) {
    const first = new Date(a.first_seen_at ?? a.created_at).toISOString();
    const last  = new Date(a.last_seen_at  ?? a.created_at).toISOString();
    const count = Number(a.occurrence_count ?? 1);
    const countStr = count > 1 ? ` (×${count})` : "";
    lines.push(
      `• [${a.severity.toUpperCase()}] ${a.component}${countStr}`,
    );
    lines.push(`    ${a.message}`);
    if (count > 1) {
      lines.push(`    First seen: ${first}  •  Last seen: ${last}`);
    } else {
      lines.push(`    Seen: ${first}`);
    }
    lines.push("");
  }

  lines.push("To resolve these, open the BitWealth UI and use the Alerts card.");
  lines.push("");
  lines.push("-- ef_alert_digest");

  const subject = `[BitWealth] ${alerts.length} new ${alerts.length === 1 ? "alert" : "alerts"} (error/critical)`;
  const text    = lines.join("\n");

  try {
    await sendEmail(subject, text);
  } catch (e) {
    console.error("ef_alert_digest: email send failed", e);
    return new Response("email send failed: " + (e as Error).message, {
      status: 500,
    });
  }

  // 3) Mark alerted rows as notified
  const ids = alerts.map((a: AlertRow) => a.alert_id);
  const { error: updErr } = await sb
    .schema("public")
    .from("alert_events")
    .update({ notified_at: new Date().toISOString() })
    .in("alert_id", ids);

  if (updErr) {
    console.error("ef_alert_digest: failed to update notified_at", updErr);
    // We still return 200 because the email *was* sent; otherwise we'd re-spam
  }

  return new Response(`notified ${alerts.length} alert(s)`, { status: 200 });
  } catch (err) {
    console.error("ef_alert_digest: uncaught error", err);
    return new Response(`Error: ${(err as Error).message}`, { status: 500 });
  }
});
