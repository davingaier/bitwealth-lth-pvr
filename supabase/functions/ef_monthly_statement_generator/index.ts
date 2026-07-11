// ef_monthly_statement_generator/index.ts
// Purpose: Generate monthly statements for all active customers on 1st of month
// Triggered by pg_cron at 00:01 UTC on 1st of every month
// Generates previous month's PDF statement and emails customers via the
// shared `ef_send_email` pipeline using the `monthly_statement` DB template.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bandsTableForSource, normaliseBandSource, BandSource } from "../_shared/band_source.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ORG_ID = Deno.env.get("ORG_ID");
const WEBSITE_URL = Deno.env.get("WEBSITE_URL") ?? "https://bitwealth.co.za";
const PORTAL_URL = Deno.env.get("PORTAL_URL") ?? "https://bitwealth.co.za/customer-portal.html";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function fmtZar(n: number): string {
  return n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUsd(n: number): string {
  return "$ " + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtBtc(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 8, maximumFractionDigits: 8 });
}

function fmtPct(n: number): string {
  const pct = n * 100;
  return pct.toFixed(2).replace(/\.?0+$/, "");
}

function buildFeeStatusText(schedule: string): string {
  return schedule === "annual" ? "Accrued (billed annually)" : "Deducted";
}

function buildPerformanceFeeNote(rate: number, schedule: string): string {
  const ratePct = fmtPct(rate);
  if (schedule === "annual") {
    return `The performance fee of ${ratePct}% is calculated on your portfolio gains made for the month (subject to a high-water mark). It has been accrued and will be deducted on your annual fee anniversary.`;
  }
  return `The performance fee of ${ratePct}% is calculated on your portfolio gains made for the month (subject to a high-water mark) and has been automatically deducted.`;
}

function buildPlatformFeeNote(rate: number, schedule: string): string {
  const ratePct = fmtPct(rate);
  if (schedule === "annual") {
    return `The platform fee of ${ratePct}% is calculated on your net USDT contributions. It has been accrued and will be deducted on your annual fee anniversary.`;
  }
  return `The platform fee of ${ratePct}% is calculated on your net USDT contributions and has been automatically deducted.`;
}

serve(async (_req) => {
  try {
    console.log("[ef_monthly_statement_generator] Starting monthly statement generation");

    // Optional band_source override (default 'ci' during CI->RB migration).
    // Day 5 of CI->RB migration (2026-05-19): default is now RB. Callers can
    // still pass { band_source: 'ci' } to regenerate historical CI statements.
    let bandSource: BandSource = "rb";
    try {
      if (_req.headers.get("content-type")?.includes("application/json")) {
        const reqBody = await _req.clone().json().catch(() => null);
        bandSource = normaliseBandSource(reqBody?.band_source);
      }
    } catch (_e) { /* ignore */ }
    const bandsTable = bandsTableForSource(bandSource);
    console.log(`[ef_monthly_statement_generator] band_source=${bandSource} table=${bandsTable}`);

    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      db: { schema: "lth_pvr" },
    });

    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const monthName = MONTH_NAMES[prevMonth];

    const startDate = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
    const endDateObj = new Date(prevYear, prevMonth, 0);
    const endDate = endDateObj.toISOString().split("T")[0];

    console.log(`[ef_monthly_statement_generator] Window: ${startDate} .. ${endDate}`);

    // Only email statements to customers whose strategy is active AND whose
    // registration is fully active. `registration_status` distinguishes
    // active customers from prospects, KYC-in-progress, and inactive ones.
    const { data: strategies, error: strategyError } = await supabase
      .schema("public")
      .from("customer_strategies")
      .select(`
        customer_id,
        status,
        performance_fee_rate,
        performance_fee_schedule,
        platform_fee_rate,
        platform_fee_schedule,
        fee_plan,
        management_fee_rate,
        management_fee_schedule,
        customer_details!inner(
          customer_id,
          first_names,
          last_name,
          email,
          registration_status
        )
      `)
      .eq("org_id", ORG_ID)
      .eq("status", "active")
      .ilike("customer_details.registration_status", "active");

    if (strategyError) {
      throw new Error(`Failed to fetch strategies: ${strategyError.message}`);
    }

    console.log(`[ef_monthly_statement_generator] Found ${strategies?.length || 0} active customers`);

    const results = {
      total: strategies?.length || 0,
      generated: 0,
      emailed: 0,
      skipped: 0,
      errors: [] as any[],
    };

    const statementMonth = startDate; // YYYY-MM-01

    const { data: ciRow } = await supabase
      .schema("lth_pvr")
      .from(bandsTable)
      .select("date,btc_price")
      .lte("date", endDate)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const currentBtcPriceUsd = Number(ciRow?.btc_price ?? 0);

    for (const strategy of strategies || []) {
      const customerId = strategy.customer_id;
      const customer = (strategy as any).customer_details;
      const perfRate = Number(strategy.performance_fee_rate ?? 0.10);
      const platRate = Number(strategy.platform_fee_rate ?? 0.0075);
      const perfSchedule = String(strategy.performance_fee_schedule ?? "monthly");
      const platSchedule = String(strategy.platform_fee_schedule ?? "immediate");
      const feePlan = String(strategy.fee_plan ?? "platform");
      const mgmtRate = Number(strategy.management_fee_rate ?? 0.01);
      const mgmtSchedule = String(strategy.management_fee_schedule ?? "monthly");

      try {
        console.log(`[ef_monthly_statement_generator] Processing customer ${customerId}`);

        // 0. Idempotency: skip if a statement for this period was already emailed.
        //    A row with `emailed_at IS NULL` means the PDF exists but the email
        //    failed last time — we re-attempt the email below without re-rendering.
        const { data: existingSent } = await supabase
          .from("statements_sent")
          .select("statement_id, emailed_at, download_url")
          .eq("org_id", ORG_ID)
          .eq("customer_id", customerId)
          .eq("statement_month", statementMonth)
          .maybeSingle();
        if (existingSent?.emailed_at) {
          console.log(`[ef_monthly_statement_generator] Skipping customer ${customerId} — already emailed at ${existingSent.emailed_at}`);
          results.skipped++;
          continue;
        }

        // 1. Generate the PDF (idempotent: ef_generate_statement returns the existing
        //    signed URL if a row already exists in statements_sent).
        const statementResponse = await fetch(
          `${SUPABASE_URL}/functions/v1/ef_generate_statement`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({
              customer_id: customerId,
              year: prevYear,
              month: prevMonth,
              band_source: bandSource,
            }),
          },
        );

        if (!statementResponse.ok) {
          const errorData = await statementResponse.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to generate statement");
        }
        const statementData = await statementResponse.json();
        results.generated++;

        // 2. Compute monthly investment activity from ledger_lines
        const { data: monthLines } = await supabase
          .schema("lth_pvr")
          .from("ledger_lines")
          .select("kind,amount_btc,amount_usdt,amount_zar,trade_date")
          .eq("org_id", ORG_ID)
          .eq("customer_id", customerId)
          .gte("trade_date", startDate)
          .lte("trade_date", endDate);

        let monthlyInvestedZar = 0;
        let btcAcquired = 0;
        let btcAcquiredZar = 0;
        let purchaseCount = 0;
        let monthDepositUsd = 0;
        for (const ll of monthLines ?? []) {
          if (ll.kind === "deposit") {
            monthlyInvestedZar += Number(ll.amount_zar ?? 0);
            monthDepositUsd += Number(ll.amount_usdt ?? 0);
          }
          if (ll.kind === "buy") {
            btcAcquired += Number(ll.amount_btc ?? 0);
            btcAcquiredZar += Number(ll.amount_zar ?? 0);
            purchaseCount += 1;
          }
        }
        const avgBuyPriceZar = btcAcquired > 0 ? btcAcquiredZar / btcAcquired : 0;

        // 3. All-time invested (ZAR) for total_invested
        const { data: allDeposits } = await supabase
          .schema("lth_pvr")
          .from("ledger_lines")
          .select("amount_zar")
          .eq("org_id", ORG_ID)
          .eq("customer_id", customerId)
          .eq("kind", "deposit");
        const totalInvestedZar = (allDeposits ?? []).reduce(
          (s, r) => s + Number(r.amount_zar ?? 0), 0,
        );

        // 4. Closing + opening balances for return calc
        const { data: closingBal } = await supabase
          .schema("lth_pvr")
          .from("balances_daily")
          .select("date,btc_balance,nav_usd")
          .eq("org_id", ORG_ID)
          .eq("customer_id", customerId)
          .lte("date", endDate)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();

        const { data: openingBal } = await supabase
          .schema("lth_pvr")
          .from("balances_daily")
          .select("date,nav_usd")
          .eq("org_id", ORG_ID)
          .eq("customer_id", customerId)
          .lt("date", startDate)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();

        const btcBalance = Number(closingBal?.btc_balance ?? 0);
        const navUsdClose = Number(closingBal?.nav_usd ?? 0);
        const navUsdOpen = Number(openingBal?.nav_usd ?? 0);

        let totalReturnPct = 0;
        if (navUsdOpen > 0) {
          totalReturnPct = ((navUsdClose - monthDepositUsd) - navUsdOpen) / navUsdOpen * 100;
        } else if (navUsdClose > 0 && monthDepositUsd > 0) {
          totalReturnPct = (navUsdClose - monthDepositUsd) / monthDepositUsd * 100;
        }
        const returnColor = totalReturnPct >= 0 ? "#10b981" : "#ef4444";

        // 5. Aggregate fees for the month
        const { data: feeLines } = await supabase
          .schema("lth_pvr")
          .from("ledger_lines")
          .select("performance_fee_usdt,platform_fee_usdt,platform_fee_btc,management_fee_usdt")
          .eq("org_id", ORG_ID)
          .eq("customer_id", customerId)
          .gte("trade_date", startDate)
          .lte("trade_date", endDate);

        let perfFeeUsd = 0;
        let platFeeUsdtSum = 0;
        let platFeeBtcSum = 0;
        let mgmtFeeUsd = 0;
        for (const fl of feeLines ?? []) {
          perfFeeUsd += Number(fl.performance_fee_usdt ?? 0);
          platFeeUsdtSum += Number(fl.platform_fee_usdt ?? 0);
          platFeeBtcSum += Number(fl.platform_fee_btc ?? 0);
          mgmtFeeUsd += Number(fl.management_fee_usdt ?? 0);
        }
        const platFeeUsd = platFeeUsdtSum + (platFeeBtcSum * currentBtcPriceUsd);

        // 6. Build template_data for the DB email template
        const templateData: Record<string, string | number> = {
          first_name: customer.first_names ?? "",
          month_name: monthName,
          year: prevYear,
          monthly_invested: fmtZar(monthlyInvestedZar),
          total_invested: fmtZar(totalInvestedZar),
          btc_acquired: fmtBtc(btcAcquired),
          avg_buy_price: fmtZar(avgBuyPriceZar),
          current_btc_price: fmtUsd(currentBtcPriceUsd),
          purchase_count: purchaseCount,
          btc_balance: fmtBtc(btcBalance),
          portfolio_value: fmtUsd(navUsdClose),
          total_return: totalReturnPct.toFixed(2),
          return_color: returnColor,
          // New fee placeholders
          performance_fee_rate: fmtPct(perfRate),
          performance_fee_amount: fmtUsd(perfFeeUsd),
          performance_fee_status_text: buildFeeStatusText(perfSchedule),
          performance_fee_note: buildPerformanceFeeNote(perfRate, perfSchedule),
          platform_fee_rate: fmtPct(platRate),
          platform_fee_amount: fmtUsd(platFeeUsd),
          platform_fee_status_text: buildFeeStatusText(platSchedule),
          platform_fee_note: buildPlatformFeeNote(platRate, platSchedule),
          fee_plan: feePlan,
          management_fee_rate: fmtPct(mgmtRate),
          management_fee_amount: fmtUsd(mgmtFeeUsd),
          management_fee_status_text: buildFeeStatusText(mgmtSchedule),
          portal_url: PORTAL_URL,
          website_url: WEBSITE_URL,
          download_url: statementData.downloadUrl ?? "",
        };

        // 7. Send via shared email pipeline
        try {
          const emailResponse = await fetch(`${SUPABASE_URL}/functions/v1/ef_send_email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({
              template_key: "monthly_statement",
              to_email: customer.email,
              data: templateData,
            }),
          });

          if (!emailResponse.ok) {
            const errBody = await emailResponse.text();
            throw new Error(`ef_send_email failed (${emailResponse.status}): ${errBody}`);
          }

          // Mark as emailed for idempotency on the next monthly run.
          await supabase
            .from("statements_sent")
            .update({ emailed_at: new Date().toISOString() })
            .eq("org_id", ORG_ID)
            .eq("customer_id", customerId)
            .eq("statement_month", statementMonth);

          results.emailed++;
          console.log(`[ef_monthly_statement_generator] Email sent to ${customer.email}`);
        } catch (emailError) {
          console.error(
            `[ef_monthly_statement_generator] Email error for customer ${customerId}:`,
            emailError,
          );
          results.errors.push({
            customer_id: customerId,
            email: customer.email,
            type: "email",
            error: (emailError as Error).message,
          });
        }
      } catch (error) {
        console.error(`[ef_monthly_statement_generator] Error for customer ${customerId}:`, error);
        results.errors.push({
          customer_id: customerId,
          type: "statement",
          error: (error as Error).message,
        });
      }
    }

    console.log(`[ef_monthly_statement_generator] Complete:`, results);

    return new Response(
      JSON.stringify({
        success: true,
        month: prevMonth,
        year: prevYear,
        results,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[ef_monthly_statement_generator] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message || "Failed to generate monthly statements" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
