// Edge Function: ef_revert_withdrawal_fees
// Purpose: Revert interim performance fee if withdrawal fails or is declined
// Called by: Admin UI when withdrawal declined/failed
// Deployed with: --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
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

interface WithdrawalSnapshot {
  snapshot_id: string;
  customer_id: number;
  withdrawal_ref: string | null;
  snapshot_date: string;
  pre_withdrawal_hwm: number;
  pre_withdrawal_contrib_net: number;
  interim_performance_fee: number;
  post_withdrawal_hwm: number;
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const snapshotId = body.snapshot_id;
    const reason = body.reason || "Withdrawal declined or failed";

    if (!snapshotId) {
      return new Response(
        JSON.stringify({ error: "Missing snapshot_id" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`Reverting withdrawal fees for snapshot ${snapshotId}...`);

    // Get snapshot
    const { data: snapshot, error: snapshotError } = await supabase
      .from("withdrawal_fee_snapshots")
      .select("*")
      .eq("snapshot_id", snapshotId)
      .single();

    if (snapshotError || !snapshot) {
      return new Response(
        JSON.stringify({ error: "Snapshot not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const snap = snapshot as WithdrawalSnapshot;
    const customerId = snap.customer_id;

    console.log(`Snapshot found: customer ${customerId}, interim fee: $${snap.interim_performance_fee.toFixed(2)}`);

    // If interim performance fee was charged, create reversal ledger entry
    if (snap.interim_performance_fee > 0) {
      const today = new Date().toISOString().split('T')[0];

      const { error: ledgerError } = await supabase
        .from("ledger_lines")
        .insert({
          org_id: orgId,
          customer_id: customerId,
          trade_date: today,
          kind: "performance_fee_reversal",
          amount_usdt: snap.interim_performance_fee, // Positive = refund
          performance_fee_usdt: -snap.interim_performance_fee, // Negative in fee column
          note: `Performance fee reversal: ${reason}`,
        });

      if (ledgerError) {
        console.error("Error creating reversal ledger entry:", ledgerError);
        throw ledgerError;
      }

      console.log(`✓ Created reversal ledger entry: +$${snap.interim_performance_fee.toFixed(2)} USDT`);

      // Note: We don't reverse the VALR transfer (money stays in BitWealth main account)
      // The ledger reversal gives customer credit, which will be reflected in next balance calculation
      await logAlert(
        supabase,
        "ef_revert_withdrawal_fees",
        "info",
        `Performance fee reversed for customer ${customerId}: $${snap.interim_performance_fee.toFixed(2)}`,
        {
          customer_id: customerId,
          snapshot_id: snapshotId,
          fee_amount: snap.interim_performance_fee,
          reason: reason,
        },
        orgId,
        customerId
      );
    }

    // Restore pre-withdrawal HWM state
    const { data: currentState, error: stateError } = await supabase
      .from("customer_state_daily")
      .select("state_id")
      .eq("customer_id", customerId)
      .order("trade_date", { ascending: false })
      .limit(1)
      .single();

    if (stateError || !currentState) {
      throw new Error("No HWM state found for customer");
    }

    const { error: updateStateError } = await supabase
      .from("customer_state_daily")
      .update({
        high_water_mark_usd: snap.pre_withdrawal_hwm,
        hwm_contrib_net_cum: snap.pre_withdrawal_contrib_net,
        trade_date: new Date().toISOString().split('T')[0],
      })
      .eq("state_id", currentState.state_id);

    if (updateStateError) {
      throw updateStateError;
    }

    console.log(`✓ Restored HWM to pre-withdrawal state: $${snap.pre_withdrawal_hwm.toFixed(2)}`);

    // Delete snapshot (no longer needed)
    const { error: deleteError } = await supabase
      .from("withdrawal_fee_snapshots")
      .delete()
      .eq("snapshot_id", snapshotId);

    if (deleteError) {
      console.error("Error deleting snapshot:", deleteError);
      // Non-critical error, continue
    } else {
      console.log(`✓ Deleted withdrawal snapshot ${snapshotId}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        customer_id: customerId,
        fee_reversed: snap.interim_performance_fee,
        hwm_restored: snap.pre_withdrawal_hwm,
        snapshot_deleted: !deleteError,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Error in ef_revert_withdrawal_fees:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
