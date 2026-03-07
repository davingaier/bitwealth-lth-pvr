// Edge Function: ef_request_withdrawal (EF10)
// Purpose: Customer-triggered withdrawal — auto-executes immediately with HWM fee deduction.
// Auth: JWT-enabled (Supabase verifies token; we extract email from payload to identify caller).
//
// Supported currencies: BTC, USDT (crypto withdraw), ZAR (fiat via bank account)
// Deployed with: supabase functions deploy ef_request_withdrawal  (JWT verification ON)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { resolveCustomerCredentials } from "../_shared/valrCredentials.ts";
import { cryptoWithdraw, getMarketPrice } from "../_shared/valrClient.ts";
import { convertUsdtToZar } from "../_shared/zarWithdrawal.ts";
import { withdrawFeeFromCustomerAccount } from "../_shared/valrTransfer.ts";
import { sendEmail } from "../_shared/smtp.ts";
import {
  getWithdrawalSubmittedEmail,
  getWithdrawalOutcomeEmail,
} from "../_shared/email-templates.ts";
import { logAlert } from "../_shared/alerting.ts";

// ── Environment ───────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ORG_ID       = Deno.env.get("ORG_ID");
const TEST_MODE    = Deno.env.get("VALR_TEST_MODE") === "true";
const FROM_EMAIL   = Deno.env.get("FROM_EMAIL") ?? "noreply@bitwealth.co.za";

if (!SUPABASE_URL || !SUPABASE_KEY || !ORG_ID) {
  throw new Error("Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORG_ID");
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

// ── JWT helpers ───────────────────────────────────────────────────────────────
// Supabase verifies the JWT before the function is invoked — we just need the email claim.
function parseJwtEmail(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    // JWT payload is base64url encoded; atob() is available in Deno
    const pad = parts[1].length % 4 === 0 ? "" : "=".repeat(4 - (parts[1].length % 4));
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/") + pad));
    return (payload.email ?? null) as string | null;
  } catch {
    return null;
  }
}

// ── Address validation ────────────────────────────────────────────────────────
function validateAddress(currency: string, address: string): string | null {
  const addr = address?.trim();
  if (!addr) return "withdrawal_address is required for BTC and USDT withdrawals";
  if (currency === "BTC") {
    const validBtc = /^(1|3|bc1)[a-zA-Z0-9]{25,61}$/.test(addr);
    if (!validBtc) return "Invalid BTC address (must start with 1, 3, or bc1; length 26–62)";
  } else if (currency === "USDT") {
    // USDT TRC-20: starts with T, 34 chars
    const validTrc20 = /^T[a-zA-Z0-9]{33}$/.test(addr);
    if (!validTrc20) return "Invalid USDT TRC-20 address (must start with T, 34 characters)";
  }
  return null; // valid
}

// ── VALR ZAR withdrawal fee lookup ────────────────────────────────────────────
async function calcValrZarFees(
  customerId: number,
  bankName: string | null,
  withdrawalType: string,
): Promise<{ withdrawalFeeZar: number; conversionFeeUsdt: number }> {
  // Conversion fee: 0.18% applied to USDT sold
  // Withdrawal fees: free if Standard Bank + fast, or within monthly 30 free, else R8.50 normal / R30 fast
  let withdrawalFeeZar = 0;
  const isStandardBank = (bankName ?? "").toLowerCase().includes("standard bank");
  const isFast = withdrawalType === "fast";

  if (isStandardBank && isFast) {
    withdrawalFeeZar = 0; // Free
  } else {
    // Count completed withdrawals this month
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const { count } = await sb
      .schema("lth_pvr")
      .from("withdrawal_requests")
      .select("request_id", { count: "exact", head: true })
      .eq("customer_id", customerId)
      .eq("currency", "ZAR")
      .eq("status", "completed")
      .gte("completed_at", monthStart.toISOString());
    const usedFreeThisMonth = count ?? 0;
    if (usedFreeThisMonth < 30) {
      withdrawalFeeZar = 0; // Still within 30 monthly free
    } else {
      withdrawalFeeZar = isFast ? 30 : 8.50;
    }
  }

  return { withdrawalFeeZar, conversionFeeUsdt: 0.0018 }; // conversionFeeUsdt is a rate
}

// ── HWM / interim performance fee calculation ─────────────────────────────────
interface FeeCalcResult {
  performanceFeeUsdt: number;
  feeSettledUsdt: number;
  feeShortfallBtc: number;
  btcSpotPrice: number;
  newHwm: number;
  preHwm: number;
  preContribNet: number;
  preNav: number;
}

async function calcInterimFee(
  customerId: number,
  portfolioId: string | null,
  navUsdt: number,
  btcBalance: number,
  usdtBalance: number,
): Promise<FeeCalcResult> {
  const today = new Date().toISOString().split("T")[0];

  // ── 1. Fee rate from customer_strategies ──────────────────────────────────
  const { data: strat } = await sb
    .schema("public")
    .from("customer_strategies")
    .select("performance_fee_rate")
    .eq("customer_id", customerId)
    .eq("org_id", ORG_ID)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  const feeRate = Number(strat?.performance_fee_rate ?? 0.10);

  // ── 2. Current HWM state ──────────────────────────────────────────────────
  const { data: stateRows } = await sb
    .schema("lth_pvr")
    .from("customer_state_daily")
    .select("high_water_mark_usd, hwm_contrib_net_cum, trade_date")
    .eq("customer_id", customerId)
    .eq("org_id", ORG_ID)
    .order("date", { ascending: false })
    .limit(1);
  const state = stateRows?.[0] as { high_water_mark_usd: number; hwm_contrib_net_cum: number; trade_date: string } | undefined;

  const preHwm = state?.high_water_mark_usd ?? 0;
  const preContribNet = state?.hwm_contrib_net_cum ?? 0;
  const lastStateDate = state?.trade_date ?? "1970-01-01";

  // ── 3. Recent contributions since last HWM ────────────────────────────────
  const btcSpot = btcBalance > 0 && navUsdt > 0 ? navUsdt / btcBalance : 50000;
  const { data: contributions } = await sb
    .schema("lth_pvr")
    .from("ledger_lines")
    .select("amount_usdt, amount_btc")
    .eq("customer_id", customerId)
    .eq("org_id", ORG_ID)
    .in("kind", ["topup", "withdrawal"])
    .gt("trade_date", lastStateDate)
    .lte("trade_date", today);

  let additionalContrib = 0;
  for (const line of (contributions ?? [])) {
    additionalContrib += Number(line.amount_usdt ?? 0);
    additionalContrib += Number(line.amount_btc ?? 0) * btcSpot;
  }

  const hwmThreshold = preHwm + preContribNet + additionalContrib;
  const preNav = navUsdt;

  // ── 4. Calculate fee ──────────────────────────────────────────────────────
  let performanceFeeUsdt = 0;
  let newHwm = preHwm;

  if (navUsdt > hwmThreshold) {
    const profitAboveHwm = navUsdt - hwmThreshold;
    performanceFeeUsdt = profitAboveHwm * feeRate;
    // HWM advances to NAV minus the fee portion we're taking
    newHwm = navUsdt - performanceFeeUsdt;
  }

  // ── 5. BTC shortfall (Option A) ───────────────────────────────────────────
  let feeSettledUsdt = 0;
  let feeShortfallBtc = 0;
  let btcSpotPrice = 0;

  if (performanceFeeUsdt > 0) {
    feeSettledUsdt = Math.min(performanceFeeUsdt, usdtBalance);
    const shortfallUsdt = performanceFeeUsdt - feeSettledUsdt;
    if (shortfallUsdt > 0.01) {
      // Use live BTC/USD price for shortfall
      try {
        btcSpotPrice = TEST_MODE ? 50000 : await getMarketPrice("BTCUSDT");
      } catch {
        btcSpotPrice = btcSpot; // fallback to derived price
      }
      feeShortfallBtc = shortfallUsdt / btcSpotPrice;
    }
  }

  return { performanceFeeUsdt, feeSettledUsdt, feeShortfallBtc, btcSpotPrice, newHwm, preHwm, preContribNet, preNav };
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ── Step 1: Parse JWT to identify caller ───────────────────────────────────
  const callerEmail = parseJwtEmail(req.headers.get("Authorization") ?? req.headers.get("authorization"));
  if (!callerEmail) return json({ error: "Unauthenticated — valid JWT required" }, 401);

  // ── Step 2: Parse and validate request body ────────────────────────────────
  let body: {
    currency?: string;
    amount?: number;
    withdrawal_address?: string;
    withdrawal_type?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const currency = (body.currency ?? "").toUpperCase();
  const amount = Number(body.amount);
  const withdrawalAddress = body.withdrawal_address?.trim() ?? null;
  const withdrawalType = body.withdrawal_type ?? "normal"; // "normal" | "fast"

  if (!["BTC", "USDT", "ZAR"].includes(currency)) {
    return json({ error: "currency must be BTC, USDT, or ZAR" }, 400);
  }
  if (!amount || amount <= 0) {
    return json({ error: "amount must be a positive number" }, 400);
  }
  if (currency !== "ZAR") {
    const addrErr = validateAddress(currency, withdrawalAddress ?? "");
    if (addrErr) return json({ error: addrErr }, 400);
  }

  // ── Step 3: Load customer by JWT email ────────────────────────────────────
  const { data: customer, error: custErr } = await sb
    .schema("public")
    .from("customer_details")
    .select("customer_id, email, first_name, last_name, org_id, account_model, registration_status")
    .eq("email", callerEmail.toLowerCase())
    .eq("org_id", ORG_ID)
    .single();

  if (custErr || !customer) {
    return json({ error: "Customer account not found for this email" }, 404);
  }

  const customerId: number = customer.customer_id;
  const firstName: string = customer.first_name ?? "Customer";
  const customerEmail: string = customer.email;

  // ── Step 4: Load exchange_accounts (bank details for ZAR) ─────────────────
  const { data: exAcct } = await sb
    .schema("public")
    .from("customer_strategies")
    .select("exchange_account_id, portfolio_id")
    .eq("customer_id", customerId)
    .eq("org_id", ORG_ID)
    .limit(1)
    .single();

  const { data: exchAcct } = exAcct?.exchange_account_id
    ? await sb
        .schema("public")
        .from("exchange_accounts")
        .select("exchange_account_id, subaccount_id, bank_valr_id, bank_name, bank_account_number")
        .eq("exchange_account_id", exAcct.exchange_account_id)
        .single()
    : { data: null };

  if (currency === "ZAR") {
    if (!exchAcct?.bank_valr_id) {
      return json({ error: "No linked bank account found. Please link your bank account before requesting a ZAR withdrawal." }, 422);
    }
  }

  const portfolioId: string | null = exAcct?.portfolio_id ?? null;

  // ── Step 5: Resolve VALR credentials ──────────────────────────────────────
  let creds: { apiKey: string; apiSecret: string } | null = null;
  let subaccountId: string | null = null;
  try {
    const resolved = await resolveCustomerCredentials(sb, customerId);
    creds = { apiKey: resolved.apiKey, apiSecret: resolved.apiSecret };
    subaccountId = resolved.subaccountId;
  } catch (e) {
    await logAlert(sb, "ef_request_withdrawal", "error", `Credential failure: ${(e as Error).message}`, { customerId }, ORG_ID, customerId);
    return json({ error: "Failed to resolve VALR credentials" }, 500);
  }

  // ── Step 6: Fetch withdrawable balance ────────────────────────────────────
  const { data: balData, error: balErr } = await sb
    .schema("lth_pvr")
    .rpc("get_withdrawable_balance", { p_customer_id: customerId });
  if (balErr || !balData) {
    return json({ error: "Failed to fetch withdrawable balance" }, 500);
  }
  const bal = Array.isArray(balData) ? balData[0] : balData;
  const withdrawableBtc = Number(bal.withdrawable_btc ?? 0);
  const withdrawableUsdt = Number(bal.withdrawable_usdt ?? 0);
  const navUsd = Number(bal.total_usd ?? 0);

  // ── Step 7: Live USDTZAR rate (for ZAR path) ──────────────────────────────
  let usdtzarRate = 0;
  if (currency === "ZAR") {
    try {
      usdtzarRate = TEST_MODE ? 18.50 : await getMarketPrice("USDTZAR");
    } catch (e) {
      return json({ error: `Cannot fetch USDTZAR rate: ${(e as Error).message}` }, 502);
    }
  }

  // ── Step 8: Validate requested amount ≤ withdrawable ─────────────────────
  if (currency === "BTC") {
    if (amount > withdrawableBtc) {
      return json({ error: `Amount ${amount} BTC exceeds withdrawable balance of ${withdrawableBtc.toFixed(8)} BTC` }, 422);
    }
  } else if (currency === "USDT") {
    if (amount > withdrawableUsdt) {
      return json({ error: `Amount ${amount} USDT exceeds withdrawable balance of ${withdrawableUsdt.toFixed(2)} USDT` }, 422);
    }
  } else if (currency === "ZAR") {
    const withdrawableZar = withdrawableUsdt * usdtzarRate;
    if (amount > withdrawableZar) {
      return json({
        error: `Amount R${amount.toFixed(2)} exceeds withdrawable balance of R${withdrawableZar.toFixed(2)} ZAR`,
      }, 422);
    }
  }

  // ── Step 9: Fetch BTC balance for HWM fee calc ────────────────────────────
  const today = new Date().toISOString().split("T")[0];
  const { data: latestBal } = await sb
    .schema("lth_pvr")
    .from("balances_daily")
    .select("btc_balance, usdt_balance, nav_usd")
    .eq("customer_id", customerId)
    .eq("org_id", ORG_ID)
    .lte("date", today)
    .order("date", { ascending: false })
    .limit(1)
    .single();

  const btcBalance = Number(latestBal?.btc_balance ?? 0);
  const usdtBalance = Number(latestBal?.usdt_balance ?? withdrawableUsdt);
  const currentNav = Number(latestBal?.nav_usd ?? navUsd);

  // ── Step 10: Calculate interim performance fee (HWM) ─────────────────────
  const feeCalc = await calcInterimFee(customerId, portfolioId, currentNav, btcBalance, usdtBalance);

  // ── Step 11: VALR fees (ZAR path only) ────────────────────────────────────
  let valrWithdrawalFeeZar = 0;
  let valrConvFeeRate = 0;
  let valrFeesDisplay = "None";

  if (currency === "ZAR") {
    const zarFees = await calcValrZarFees(customerId, exchAcct?.bank_name ?? null, withdrawalType);
    valrWithdrawalFeeZar = zarFees.withdrawalFeeZar;
    valrConvFeeRate = zarFees.conversionFeeUsdt; // 0.0018 rate
    const zarAmount = amount;
    const usdt4conv = zarAmount / usdtzarRate;
    const convFeeZar = usdt4conv * valrConvFeeRate * usdtzarRate;
    valrFeesDisplay = `R${(convFeeZar + valrWithdrawalFeeZar).toFixed(2)} ZAR (conversion + withdrawal)`;
  } else {
    valrFeesDisplay = "Blockchain network fee (deducted by VALR)";
  }

  // ── Step 12: Net amount shown to customer ─────────────────────────────────
  let netAmount = amount;
  if (currency === "USDT") {
    netAmount = amount - feeCalc.performanceFeeUsdt;
  } else if (currency === "BTC") {
    const btcPrice = feeCalc.btcSpotPrice > 0 ? feeCalc.btcSpotPrice : 50000;
    const feeBtcEquiv = feeCalc.performanceFeeUsdt / btcPrice;
    netAmount = amount - feeBtcEquiv;
  } else if (currency === "ZAR") {
    netAmount = amount - valrWithdrawalFeeZar; // Approx — conversion fee baked into rate
  }

  // ── Step 13: Insert withdrawal_requests ───────────────────────────────────
  const { data: wdRecord, error: wdInsErr } = await sb
    .schema("lth_pvr")
    .from("withdrawal_requests")
    .insert({
      org_id: ORG_ID,
      customer_id: customerId,
      portfolio_id: portfolioId,
      currency,
      amount_usdt: currency === "USDT" ? amount : null,
      amount_zar: currency === "ZAR" ? amount : null,
      withdrawal_address: withdrawalAddress,
      withdrawable_balance_snapshot: withdrawableUsdt,
      interim_performance_fee_usdt: feeCalc.performanceFeeUsdt,
      interim_fee_settled_usdt: feeCalc.feeSettledUsdt,
      interim_fee_settled_btc: feeCalc.feeShortfallBtc,
      interim_fee_btc_price: feeCalc.btcSpotPrice > 0 ? feeCalc.btcSpotPrice : null,
      net_amount: netAmount,
      source_asset: currency === "ZAR" ? (feeCalc.feeShortfallBtc > 0 ? "BTC+USDT" : "USDT") : currency,
      valr_conversion_fee_usdt: currency === "ZAR" ? (amount / usdtzarRate) * valrConvFeeRate : null,
      valr_withdrawal_fee_zar: currency === "ZAR" ? valrWithdrawalFeeZar : null,
      is_first_free_withdrawal: null, // computed in calcValrZarFees implicitly
      status: "pending",
      requested_at: new Date().toISOString(),
    })
    .select("request_id")
    .single();

  if (wdInsErr || !wdRecord) {
    await logAlert(sb, "ef_request_withdrawal", "error", `Failed to create withdrawal record: ${wdInsErr?.message}`, { customerId, currency, amount }, ORG_ID, customerId);
    return json({ error: "Failed to create withdrawal request" }, 500);
  }

  const requestId: string = wdRecord.request_id;

  // ── Step 14: Insert withdrawal_fee_snapshots ──────────────────────────────
  await sb
    .schema("lth_pvr")
    .from("withdrawal_fee_snapshots")
    .insert({
      org_id: ORG_ID,
      customer_id: customerId,
      withdrawal_request_id: requestId,
      snapshot_date: today,
      pre_withdrawal_hwm: feeCalc.preHwm,
      pre_withdrawal_contrib_net: feeCalc.preContribNet,
      pre_withdrawal_nav: feeCalc.preNav,
      interim_performance_fee: feeCalc.performanceFeeUsdt,
      new_hwm: feeCalc.newHwm,
      reverted: false,
    });

  // ── Step 15: Update HWM in customer_state_daily ───────────────────────────
  if (feeCalc.performanceFeeUsdt > 0) {
    await sb
      .schema("lth_pvr")
      .from("customer_state_daily")
      .update({ high_water_mark_usd: feeCalc.newHwm })
      .eq("customer_id", customerId)
      .eq("org_id", ORG_ID)
      .order("date", { ascending: false })
      .limit(1);
  }

  // ── Step 16: Mark processing ──────────────────────────────────────────────
  await sb
    .schema("lth_pvr")
    .from("withdrawal_requests")
    .update({ status: "processing" })
    .eq("request_id", requestId);

  // ── Step 17: Collect BTC interim fee portion (Option A) ───────────────────
  if (feeCalc.feeShortfallBtc > 0 && !TEST_MODE) {
    const btcFeeResult = await withdrawFeeFromCustomerAccount(
      sb,
      customerId,
      "BTC",
      feeCalc.feeShortfallBtc,
      undefined,
      "performance_fee",
    );
    if (!btcFeeResult.success) {
      await logAlert(sb, "ef_request_withdrawal", "warn", `BTC fee transfer failed (non-blocking): ${btcFeeResult.errorMessage}`, { requestId, customerId, amount: feeCalc.feeShortfallBtc }, ORG_ID, customerId);
    }
  }

  // ── Step 18: Send "Submission" email early (before VALR execution) ─────────
  const submittedTemplate = getWithdrawalSubmittedEmail(
    firstName, currency, amount, netAmount,
    feeCalc.performanceFeeUsdt, valrFeesDisplay, requestId,
  );
  await sendEmail({
    to: customerEmail,
    from: FROM_EMAIL,
    subject: "Your Withdrawal Request is Being Processed — BitWealth",
    html: submittedTemplate.html,
    text: submittedTemplate.text,
  }).catch((e: Error) => console.warn("Submission email failed:", e.message));

  // ── Step 19: Execute withdrawal ────────────────────────────────────────────
  let valrWithdrawalId: string | undefined;
  let executionError: string | undefined;

  try {
    if (currency === "BTC" || currency === "USDT") {
      // Direct crypto withdrawal via VALR
      const wdRes: any = TEST_MODE
        ? { id: "test-crypto-withdrawal-id" }
        : await cryptoWithdraw(currency, amount.toFixed(currency === "BTC" ? 8 : 2), withdrawalAddress!, subaccountId, creds);
      valrWithdrawalId = wdRes?.id ?? wdRes?.withdrawalId;
    } else {
      // ZAR: convert USDT → ZAR, then fiat withdraw
      const usdtNeeded = amount / usdtzarRate;
      const convResult = await convertUsdtToZar(
        sb,
        ORG_ID!,
        requestId,
        customerId,
        usdtNeeded * (1 + valrConvFeeRate), // send slightly more to account for conversion fee
        exchAcct!.bank_valr_id!,
        amount - valrWithdrawalFeeZar, // net ZAR after withdrawal fee
        withdrawalType === "fast",
        subaccountId,
        creds,
        TEST_MODE,
      );
      if (!convResult.success) {
        throw new Error(convResult.error ?? "ZAR conversion failed");
      }
      valrWithdrawalId = convResult.valrWithdrawalId;
    }
  } catch (e) {
    executionError = (e as Error).message;
  }

  // ── Step 20: Update final status + send outcome email ─────────────────────
  if (!executionError) {
    await sb
      .schema("lth_pvr")
      .from("withdrawal_requests")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        valr_withdrawal_id: valrWithdrawalId,
        processed_at: new Date().toISOString(),
      })
      .eq("request_id", requestId);

    const completedTemplate = getWithdrawalOutcomeEmail(
      firstName, currency, netAmount, "completed", new Date(), undefined, valrWithdrawalId,
    );
    await sendEmail({
      to: customerEmail,
      from: FROM_EMAIL,
      subject: "Withdrawal Complete — BitWealth",
      html: completedTemplate.html,
      text: completedTemplate.text,
    }).catch((e: Error) => console.warn("Outcome email failed:", e.message));

    return json({
      success: true,
      request_id: requestId,
      status: "completed",
      valr_withdrawal_id: valrWithdrawalId,
      net_amount: netAmount,
      currency,
    });
  } else {
    // Mark failed — do NOT revert HWM (fee was earned regardless of VALR status)
    await sb
      .schema("lth_pvr")
      .from("withdrawal_requests")
      .update({
        status: "failed",
        valr_response: { error: executionError },
        processed_at: new Date().toISOString(),
      })
      .eq("request_id", requestId);

    await logAlert(sb, "ef_request_withdrawal", "error", `Withdrawal execution failed: ${executionError}`, { requestId, customerId, currency, amount }, ORG_ID, customerId);

    const failedTemplate = getWithdrawalOutcomeEmail(firstName, currency, netAmount, "failed", undefined, executionError);
    await sendEmail({
      to: customerEmail,
      from: FROM_EMAIL,
      subject: "Withdrawal Failed — BitWealth",
      html: failedTemplate.html,
      text: failedTemplate.text,
    }).catch((e: Error) => console.warn("Failed outcome email failed:", e.message));

    return json({
      success: false,
      request_id: requestId,
      status: "failed",
      error: executionError,
    }, 500);
  }
});
