// Edge Function: ef_fee_monthly_close
// Purpose: Internal monthly fee aggregation. Rolls up fee ledger lines into
//          rows in `lth_pvr.fee_invoices` for BitWealth's own bookkeeping and
//          emails the admin a digest. NEVER sent to customers — customers
//          receive a polished monthly statement (see ef_generate_statement and
//          ef_monthly_statement_generator) which already itemises fees.
// Schedule: pg_cron on 1st of month at 00:10 UTC (after performance fees at 00:05)
// Deployed with: --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { logAlert } from "../_shared/alerting.ts";
import { bandsTableForSource, normaliseBandSource, BandSource } from "../_shared/band_source.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const orgId = Deno.env.get("ORG_ID");
const adminEmail = Deno.env.get("ADMIN_EMAIL") || "admin@bitwealth.co.za";

if (!supabaseUrl || !supabaseKey || !orgId) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: "lth_pvr" }
});

interface FeeAggregation {
  customer_id: number;
  platform_fees_btc: number;
  platform_fees_usdt: number;
  performance_fees_usdt: number;
  total_fees_usd: number;
}

Deno.serve(async (req) => {
  try {
    console.log("Starting monthly fee close and invoice generation...");

    // Optional band_source override (default 'ci' during CI->RB migration).
    let bandSource: BandSource = "ci";
    try {
      if (req.headers.get("content-type")?.includes("application/json")) {
        const reqBody = await req.clone().json().catch(() => null);
        bandSource = normaliseBandSource(reqBody?.band_source);
      }
    } catch (_e) { /* ignore */ }
    const bandsTable = bandsTableForSource(bandSource);
    console.log(`ef_fee_monthly_close: band_source=${bandSource} table=${bandsTable}`);

    // Get previous month (we run on 1st, invoice for previous month)
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthStr = lastMonth.toISOString().substring(0, 7); // YYYY-MM
    const lastMonthStart = `${lastMonthStr}-01`;
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];

    console.log(`Aggregating fees for ${lastMonthStr} (${lastMonthStart} to ${lastMonthEnd})`);

    // Check if already processed this month (invoice_month is DATE, use first day of month)
    const invoiceMonthDate = `${lastMonthStr}-01`;
    const { data: existingInvoices, error: existingError } = await supabase
      .from("fee_invoices")
      .select("invoice_id")
      .eq("org_id", orgId)
      .eq("invoice_month", invoiceMonthDate);

    if (existingError) {
      throw existingError;
    }

    if (existingInvoices && existingInvoices.length > 0) {
      console.log(`Invoices already generated for ${lastMonthStr}, skipping`);
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Invoices already generated for this month",
          invoice_count: existingInvoices.length 
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Aggregate platform fees (USDT and BTC)
    const { data: platformFeesUsdt, error: platformUsdtError } = await supabase
      .from("ledger_lines")
      .select("customer_id, platform_fee_usdt")
      .eq("org_id", orgId)
      .gte("trade_date", lastMonthStart)
      .lte("trade_date", lastMonthEnd)
      .gt("platform_fee_usdt", 0);

    if (platformUsdtError) throw platformUsdtError;

    const { data: platformFeesBtc, error: platformBtcError } = await supabase
      .from("ledger_lines")
      .select("customer_id, platform_fee_btc")
      .eq("org_id", orgId)
      .gte("trade_date", lastMonthStart)
      .lte("trade_date", lastMonthEnd)
      .gt("platform_fee_btc", 0);

    if (platformBtcError) throw platformBtcError;

    // Aggregate performance fees
    const { data: performanceFees, error: performanceError } = await supabase
      .from("ledger_lines")
      .select("customer_id, performance_fee_usdt")
      .eq("org_id", orgId)
      .gte("trade_date", lastMonthStart)
      .lte("trade_date", lastMonthEnd)
      .gt("performance_fee_usdt", 0);

    if (performanceError) throw performanceError;

    // Aggregate by customer
    const feesByCustomer = new Map<number, FeeAggregation>();

    for (const fee of (platformFeesUsdt || [])) {
      const customerId = fee.customer_id;
      if (!feesByCustomer.has(customerId)) {
        feesByCustomer.set(customerId, {
          customer_id: customerId,
          platform_fees_btc: 0,
          platform_fees_usdt: 0,
          performance_fees_usdt: 0,
          total_fees_usd: 0,
        });
      }
      const agg = feesByCustomer.get(customerId)!;
      agg.platform_fees_usdt += Number(fee.platform_fee_usdt || 0);
    }

    for (const fee of (platformFeesBtc || [])) {
      const customerId = fee.customer_id;
      if (!feesByCustomer.has(customerId)) {
        feesByCustomer.set(customerId, {
          customer_id: customerId,
          platform_fees_btc: 0,
          platform_fees_usdt: 0,
          performance_fees_usdt: 0,
          total_fees_usd: 0,
        });
      }
      const agg = feesByCustomer.get(customerId)!;
      agg.platform_fees_btc += Number(fee.platform_fee_btc || 0);
    }

    for (const fee of (performanceFees || [])) {
      const customerId = fee.customer_id;
      if (!feesByCustomer.has(customerId)) {
        feesByCustomer.set(customerId, {
          customer_id: customerId,
          platform_fees_btc: 0,
          platform_fees_usdt: 0,
          performance_fees_usdt: 0,
          total_fees_usd: 0,
        });
      }
      const agg = feesByCustomer.get(customerId)!;
      agg.performance_fees_usdt += Number(fee.performance_fee_usdt || 0);
    }

    // Get BTC price for conversion (use last day of month)
    const { data: ciData, error: ciError } = await supabase
      .from(bandsTable)
      .select("btc_price")
      .lte("date", lastMonthEnd)
      .order("date", { ascending: false })
      .limit(1)
      .single();

    const btcPrice = ciError ? 50000 : Number(ciData?.btc_price || 50000);

    // Calculate total fees in USD
    for (const [_, agg] of feesByCustomer) {
      agg.total_fees_usd = 
        agg.platform_fees_usdt + 
        (agg.platform_fees_btc * btcPrice) + 
        agg.performance_fees_usdt;
    }

    console.log(`Found ${feesByCustomer.size} customers with fees for ${lastMonthStr}`);

    if (feesByCustomer.size === 0) {
      console.log("No fees to invoice this month");
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "No fees collected this month",
          invoice_count: 0 
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Pull running accumulated-fee balances for every customer with new fees.
    // These reflect amounts that have been transferred OUT of customer subaccounts
    // into BitWealth's collection wallets but not yet swept to fiat / settled.
    const customerIds = Array.from(feesByCustomer.values()).map((a) => a.customer_id);
    const accumByCustomer = new Map<number, { btc: number; usdt: number }>();
    if (customerIds.length > 0) {
      const { data: accumRows, error: accumErr } = await supabase
        .from("customer_accumulated_fees")
        .select("customer_id, accumulated_btc, accumulated_usdt")
        .eq("org_id", orgId)
        .in("customer_id", customerIds);
      if (accumErr) {
        console.warn(`Could not load customer_accumulated_fees: ${accumErr.message}`);
      }
      for (const row of accumRows ?? []) {
        accumByCustomer.set(Number((row as any).customer_id), {
          btc: Number((row as any).accumulated_btc ?? 0),
          usdt: Number((row as any).accumulated_usdt ?? 0),
        });
      }
    }

    // Create invoices
    const invoicesToInsert = [];
    const dueDate = new Date(now.getFullYear(), now.getMonth(), 15).toISOString().split('T')[0]; // 15th of current month

    for (const [_, agg] of feesByCustomer) {
      // Convert invoice_month to first day of month (DATE format)
      const invoiceMonthDate = `${lastMonthStr}-01`;
      
      // Calculate total platform fees in USD
      const platformFeesUsd = agg.platform_fees_usdt + (agg.platform_fees_btc * btcPrice);
      const accum = accumByCustomer.get(agg.customer_id) ?? { btc: 0, usdt: 0 };
      
      invoicesToInsert.push({
        org_id: orgId,
        customer_id: agg.customer_id,
        invoice_month: invoiceMonthDate,  // YYYY-MM-DD format for DATE column
        platform_fees_due: platformFeesUsd,  // Total platform fees in USD
        performance_fees_due: agg.performance_fees_usdt,  // Performance fees in USD
        // Store breakdown in new columns (from 20260124 migration)
        platform_fees_transferred_btc: agg.platform_fees_btc,
        platform_fees_transferred_usdt: agg.platform_fees_usdt,
        platform_fees_accumulated_btc: accum.btc,
        platform_fees_accumulated_usdt: accum.usdt,
        due_date: dueDate,
        status: "unpaid",
      });
    }

    const { data: insertedInvoices, error: insertError } = await supabase
      .from("fee_invoices")
      .insert(invoicesToInsert)
      .select("invoice_id, customer_id, total_fees_usd");

    if (insertError) {
      throw insertError;
    }

    console.log(`✓ Created ${insertedInvoices?.length} invoices`);

    // Send invoice email to admin
    const invoiceDetails = (insertedInvoices || []).map((inv: any) => ({
      customer_id: inv.customer_id,
      total_fees: inv.total_fees_usd,
    }));

    const totalFeesAllCustomers = invoiceDetails.reduce((sum, inv) => sum + Number(inv.total_fees), 0);

    try {
      await fetch(`${supabaseUrl}/functions/v1/ef_send_email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": req.headers.get("authorization") || "",
        },
        body: JSON.stringify({
          template_key: "monthly_fee_invoice_admin",
          to_email: adminEmail,
          data: {
            invoice_month: lastMonthStr,
            invoice_count: invoiceDetails.length,
            total_fees_usd: totalFeesAllCustomers.toFixed(2),
            due_date: dueDate,
            invoice_details: invoiceDetails,
          },
        }),
      });
      console.log(`✓ Sent invoice email to ${adminEmail}`);
    } catch (emailError) {
      console.error("Error sending invoice email:", emailError);
      await logAlert(
        supabase,
        "ef_fee_monthly_close",
        "warn",
        `Failed to send invoice email: ${emailError.message}`,
        { invoice_month: lastMonthStr, invoice_count: invoiceDetails.length },
        orgId,
        null
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        invoice_month: lastMonthStr,
        invoice_count: invoiceDetails.length,
        total_fees_usd: totalFeesAllCustomers,
        due_date: dueDate,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in ef_fee_monthly_close:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
