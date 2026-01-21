// Edge Function: ef_calculate_interim_performance_fee
// Purpose: Calculate performance fee before withdrawal (with reversion capability)
// Called by: Admin UI when processing withdrawal requests
// Deployed with: --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { transferToMainAccount } from "../_shared/valrTransfer.ts";
import { logAlert } from "../_shared/alerting.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const orgId = Deno.env.get("ORG_ID");

if (!supabaseUrl || !supabaseKey || !orgId) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: "lth_pvr" }
});

interface CustomerState {
  state_id: string;
  customer_id: number;
  trade_date: string;
  high_water_mark_usd: number;
  hwm_contrib_net_cum: number;
  last_perf_fee_month: string | null;
}

interface Balance {
  btc_balance: number;
  usdt_balance: number;
  nav_usd: number;
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const customerId = body.customer_id;
    const withdrawalAmount = Number(body.withdrawal_amount_usd || 0);
    const withdrawalRef = body.withdrawal_ref || null; // Optional reference ID

    if (!customerId || !withdrawalAmount) {
      return new Response(
        JSON.stringify({ error: "Missing customer_id or withdrawal_amount_usd" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`Calculating interim performance fee for customer ${customerId} (withdrawal: $${withdrawalAmount.toFixed(2)})`);

    // Get customer's performance fee rate
    const { data: strategyData, error: strategyError } = await supabase
      .schema("public")
      .from("customer_strategies")
      .select("performance_fee_rate")
      .eq("customer_id", customerId)
      .eq("org_id", orgId)
      .eq("status", "active")
      .single();

    if (strategyError || !strategyData) {
      return new Response(
        JSON.stringify({ error: "No active strategy found for customer" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const feeRate = Number(strategyData.performance_fee_rate || 0.10);

    // Get current HWM state
    const { data: stateRows, error: stateError } = await supabase
      .from("customer_state_daily")
      .select("*")
      .eq("customer_id", customerId)
      .order("trade_date", { ascending: false })
      .limit(1);

    if (stateError) {
      throw stateError;
    }

    const currentState = stateRows?.[0] as CustomerState | undefined;

    if (!currentState) {
      return new Response(
        JSON.stringify({ error: "No HWM state found for customer (need to initialize first)" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get current balance
    const today = new Date().toISOString().split('T')[0];
    const { data: currentBalance, error: balanceError } = await supabase
      .from("balances_daily")
      .select("btc_balance, usdt_balance, nav_usd")
      .eq("org_id", orgId)
      .eq("customer_id", customerId)
      .lte("date", today)
      .order("date", { ascending: false })
      .limit(1)
      .single();

    if (balanceError || !currentBalance) {
      return new Response(
        JSON.stringify({ error: "No balance found for customer" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const balance = currentBalance as Balance;

    // Calculate cumulative net contributions since last HWM update
    const { data: recentContribData, error: recentContribError } = await supabase
      .from("ledger_lines")
      .select("amount_usdt, amount_btc")
      .eq("org_id", orgId)
      .eq("customer_id", customerId)
      .in("kind", ["topup", "withdrawal"])
      .gt("trade_date", currentState.trade_date)
      .lte("trade_date", today);

    if (recentContribError) throw recentContribError;

    let additionalContrib = 0;
    const btcPrice = balance.nav_usd / balance.btc_balance || 50000;

    for (const line of (recentContribData || [])) {
      additionalContrib += Number(line.amount_usdt || 0);
      additionalContrib += Number(line.amount_btc || 0) * btcPrice;
    }

    const totalNetContrib = currentState.hwm_contrib_net_cum + additionalContrib;
    const hwmThreshold = currentState.high_water_mark_usd + totalNetContrib;

    console.log(`Customer ${customerId}: NAV=$${balance.nav_usd.toFixed(2)}, HWM threshold=$${hwmThreshold.toFixed(2)}`);

    // Calculate performance fee if NAV exceeds HWM + contributions
    let performanceFee = 0;
    let newHWM = currentState.high_water_mark_usd;

    if (balance.nav_usd > hwmThreshold) {
      const profitAboveHWM = balance.nav_usd - hwmThreshold;
      performanceFee = profitAboveHWM * feeRate;

      console.log(`Interim performance fee: $${performanceFee.toFixed(2)} (${(feeRate * 100).toFixed(1)}% of $${profitAboveHWM.toFixed(2)} profit)`);

      // Check if sufficient USDT balance for fee
      if (balance.usdt_balance < performanceFee) {
        return new Response(
          JSON.stringify({
            error: "Insufficient USDT balance for performance fee",
            required: performanceFee,
            available: balance.usdt_balance,
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Create ledger entry for interim performance fee
      const { data: ledgerData, error: ledgerError } = await supabase
        .from("ledger_lines")
        .insert({
          org_id: orgId,
          customer_id: customerId,
          trade_date: today,
          kind: "performance_fee",
          amount_usdt: -performanceFee,
          performance_fee_usdt: performanceFee,
          note: `Interim performance fee (pre-withdrawal): ${(feeRate * 100).toFixed(1)}% of $${profitAboveHWM.toFixed(2)} profit`,
        })
        .select("ledger_id")
        .single();

      if (ledgerError) {
        throw ledgerError;
      }

      const ledgerId = ledgerData?.ledger_id;

      // Transfer fee to BitWealth main account
      const { data: exchangeAcct, error: exAcctError } = await supabase
        .schema("public")
        .from("exchange_accounts")
        .select("subaccount_id, account_id")
        .eq("customer_id", customerId)
        .eq("exchange", "VALR")
        .single();

      if (exAcctError || !exchangeAcct) {
        await logAlert(
          supabase,
          "ef_calculate_interim_performance_fee",
          "error",
          `No exchange account found for customer ${customerId}`,
          { customer_id: customerId, ledger_id: ledgerId },
          orgId,
          customerId
        );
        return new Response(
          JSON.stringify({ error: "No exchange account found" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      const subaccountId = exchangeAcct.subaccount_id;
      const mainAccountId = Deno.env.get("VALR_MAIN_ACCOUNT_ID") || "main";

      const transferResult = await transferToMainAccount(
        supabase,
        {
          fromSubaccountId: subaccountId,
          toAccount: mainAccountId,
          currency: "USDT",
          amount: performanceFee,
          transferType: "performance_fee",
        },
        customerId,
        ledgerId
      );

      if (!transferResult.success) {
        await logAlert(
          supabase,
          "ef_calculate_interim_performance_fee",
          "error",
          `Interim performance fee transfer failed: ${transferResult.errorMessage}`,
          {
            customer_id: customerId,
            ledger_id: ledgerId,
            amount_usdt: performanceFee,
            error: transferResult.errorMessage,
          },
          orgId,
          customerId
        );
        return new Response(
          JSON.stringify({ error: `Transfer failed: ${transferResult.errorMessage}` }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      // Calculate new HWM (NAV after fee - net contributions - withdrawal)
      const navAfterFee = balance.nav_usd - performanceFee;
      newHWM = navAfterFee - withdrawalAmount - totalNetContrib;

      console.log(`✓ Interim performance fee charged: $${performanceFee.toFixed(2)}, new HWM: $${newHWM.toFixed(2)}`);
    } else {
      console.log(`No interim performance fee (NAV <= HWM threshold)`);
      // No fee, but still adjust HWM for withdrawal
      newHWM = balance.nav_usd - withdrawalAmount - totalNetContrib;
    }

    // Create snapshot for potential reversion
    const { data: snapshotData, error: snapshotError } = await supabase
      .from("withdrawal_fee_snapshots")
      .insert({
        org_id: orgId,
        customer_id: customerId,
        withdrawal_ref: withdrawalRef,
        snapshot_date: today,
        pre_withdrawal_hwm: currentState.high_water_mark_usd,
        pre_withdrawal_contrib_net: currentState.hwm_contrib_net_cum,
        interim_performance_fee: performanceFee,
        post_withdrawal_hwm: newHWM,
      })
      .select("snapshot_id")
      .single();

    if (snapshotError) {
      console.error("Error creating snapshot:", snapshotError);
      throw snapshotError;
    }

    console.log(`✓ Created withdrawal snapshot (ID: ${snapshotData.snapshot_id})`);

    // Update HWM state with new values (assume withdrawal will succeed)
    const { error: updateStateError } = await supabase
      .from("customer_state_daily")
      .update({
        trade_date: today,
        high_water_mark_usd: newHWM,
        hwm_contrib_net_cum: totalNetContrib - withdrawalAmount, // Withdrawal reduces net contributions
      })
      .eq("state_id", currentState.state_id);

    if (updateStateError) {
      throw updateStateError;
    }

    console.log(`✓ Updated HWM state for customer ${customerId}`);

    return new Response(
      JSON.stringify({
        success: true,
        customer_id: customerId,
        interim_performance_fee: performanceFee,
        snapshot_id: snapshotData.snapshot_id,
        pre_withdrawal_hwm: currentState.high_water_mark_usd,
        post_withdrawal_hwm: newHWM,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Error in ef_calculate_interim_performance_fee:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
