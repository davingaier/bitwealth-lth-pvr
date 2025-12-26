// index.ts – ef_alert_digest
// Sends an email for NEW open error/critical alerts (notified_at IS NULL)

import { getServiceClient } from "./client.ts";

type AlertRow = {
  alert_id: string;
  created_at: string;
  severity: string;
  component: string;
  message: string;
};

async function sendEmail(subject: string, text: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from   = Deno.env.get("ALERT_EMAIL_FROM");
  const to     = Deno.env.get("ALERT_EMAIL_TO");

  if (!apiKey || !from || !to) {
    throw new Error("RESEND_API_KEY / ALERT_EMAIL_FROM / ALERT_EMAIL_TO not configured");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend error ${res.status}: ${res.statusText} – ${body}`);
  }
}

Deno.serve(async (req: Request) => {
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
    .from<AlertRow>("alert_events")
    .select("alert_id, created_at, severity, component, message")
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
    const when = new Date(a.created_at).toISOString();
    lines.push(
      `• [${a.severity.toUpperCase()}] ${a.component} @ ${when}`,
    );
    lines.push(`    ${a.message}`);
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
  const ids = alerts.map((a) => a.alert_id);
  const { error: updErr } = await sb
    .from("alert_events")
    .update({ notified_at: new Date().toISOString() })
    .in("alert_id", ids);

  if (updErr) {
    console.error("ef_alert_digest: failed to update notified_at", updErr);
    // We still return 200 because the email *was* sent; otherwise we'd re-spam
  }

  return new Response(`notified ${alerts.length} alert(s)`, { status: 200 });
});
