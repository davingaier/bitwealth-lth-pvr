import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (_req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      db: { schema: "lth_pvr" },
    });

    const customerId = 999;

    // 1. Get ZAR deposits
    const { data: deposits, error: depositsError } = await supabase
      .from("exchange_funding_events")
      .select("funding_id, occurred_at, amount, metadata, created_at")
      .eq("customer_id", customerId)
      .eq("kind", "zar_deposit")
      .order("occurred_at", { ascending: false });

    if (depositsError) throw depositsError;

    // 2. Get ZAR conversions (USDT deposits with zar_amount metadata)
    const { data: allUsdt, error: usdtError } = await supabase
      .from("exchange_funding_events")
      .select("funding_id, occurred_at, amount, metadata, created_at")
      .eq("customer_id", customerId)
      .eq("kind", "deposit")
      .eq("asset", "USDT")
      .order("occurred_at", { ascending: false })
      .limit(20);

    if (usdtError) throw usdtError;

    const conversions = allUsdt.filter(e => e.metadata?.zar_amount);

    // 3. Get pending conversions
    const { data: pending, error: pendingError } = await supabase
      .from("pending_zar_conversions")
      .select("*")
      .eq("customer_id", customerId)
      .order("occurred_at", { ascending: true });

    if (pendingError) throw pendingError;

    // 4. Calculate totals
    const totalDeposited = deposits.reduce((sum, d) => sum + parseFloat(d.amount), 0);
    const totalConverted = conversions.reduce((sum, c) => sum + parseFloat(c.metadata.zar_amount || 0), 0);
    const shouldRemaining = totalDeposited - totalConverted;

    return new Response(
      JSON.stringify({
        depositsCount: deposits.length,
        deposits: deposits.map(d => ({
          id: d.funding_id,
          date: d.occurred_at,
          amount: d.amount,
          created: d.created_at
        })),
        conversionsCount: conversions.length,
        conversions: conversions.map(c => ({
          id: c.funding_id,
          date: c.occurred_at,
          usdt: c.amount,
          zar: c.metadata.zar_amount,
          linkedTo: c.metadata.zar_deposit_id,
          isSplit: c.metadata.is_split_allocation,
          splitPart: c.metadata.split_part,
          created: c.created_at
        })),
        pendingCount: pending.length,
        pending: pending.map(p => ({
          fundingId: p.funding_id,
          original: p.zar_amount,
          converted: p.converted_amount,
          remaining: p.remaining_amount,
          date: p.occurred_at
        })),
        summary: {
          totalDeposited,
          totalConverted,
          shouldRemaining,
          valrReports: 50.00,
          discrepancy: shouldRemaining - 50.00
        }
      }, null, 2),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
