import { getServiceClient } from "./client.ts";

Deno.serve(async () => {
  const sb = getServiceClient();
  const org_id = Deno.env.get("ORG_ID");
  if (!org_id) return new Response("ORG_ID missing", { status: 500 });

  const emailServiceUrl = Deno.env.get("INVOICE_EMAIL_URL");
  if (!emailServiceUrl) {
    return new Response("INVOICE_EMAIL_URL not configured", { status: 500 });
  }

  const { data: invoices, error } = await sb
    .from("lth_pvr.fee_invoices")
    .select("invoice_id, invoice_number, invoice_date, amount_usdt, customer_id, fee_id")
    .eq("org_id", org_id)
    .is("sent_at", null)
    .eq("status", "open")
    .limit(50);

  if (error) return new Response(error.message, { status: 500 });
  if (!invoices || invoices.length === 0) {
    return new Response("no invoices to send");
  }

  for (const inv of invoices) {
    const { data: customers, error: cErr } = await sb
      .from("customer_details")
      .select("customer_id, full_name, email")
      .eq("customer_id", inv.customer_id)
      .limit(1);
    if (cErr || !customers?.[0]) {
      console.error("customer lookup failed", cErr);
      continue;
    }
    const c = customers[0];

    const payload = {
      invoiceNumber: inv.invoice_number,
      invoiceDate: inv.invoice_date,
      amountUSDT: inv.amount_usdt,
      customer: {
        id: c.customer_id,
        name: c.full_name,
        email: c.email,
      },
    };

    try {
      const resp = await fetch(emailServiceUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        console.error(
          `Invoice email failed: ${resp.status} ${resp.statusText}`,
        );
        continue;
      }

      await sb.from("lth_pvr.fee_invoices")
        .update({ sent_at: new Date().toISOString() })
        .eq("invoice_id", inv.invoice_id);
    } catch (e) {
      console.error("Invoice email exception", e);
    }
  }

  return new Response("ok");
});
