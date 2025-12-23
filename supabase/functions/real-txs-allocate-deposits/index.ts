// deno-lint-ignore-file no-explicit-any
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
Deno.serve(async (req)=>{
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }
  try {
    const body = await req.json().catch(()=>({}));
    if (!body.allocate_to_month) throw new Error('allocate_to_month (YYYY-MM) is required');
    // Only allow current or next month (UTC), same as the UI
    const now = new Date();
    const curr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const fmt = (d)=>`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const allowedMonths = new Set([
      fmt(curr),
      fmt(next)
    ]);
    if (!allowedMonths.has(body.allocate_to_month)) {
      throw new Error(`allocate_to_month must be ${fmt(curr)} or ${fmt(next)}`);
    }
    let rows = [];
    if (Array.isArray(body.tx_ids) && body.tx_ids.length) {
      const { data, error } = await sb
        .from('real_exchange_txs')
        .select('id, customer_id, kind, credit_value, currency_pair, credit_currency')
        .in('id', body.tx_ids);

      if (error) throw error;
      rows = data || [];
    } else {
      if (!body.customer_id) throw new Error('customer_id is required when tx_ids are not supplied');
      const q = sb
        .from('real_exchange_txs')
        .select('id, customer_id, kind, credit_value, transaction_timestamp, currency_pair, credit_currency')
        .eq('customer_id', body.customer_id)
        .is('allocated_month', null)
        .or('kind.eq.USDT_DEPOSIT,and(currency_pair.eq.USDTZAR,credit_currency.eq.USDT)')
        .order('transaction_timestamp', { ascending: true });

      const { data, error } = await (body.from || body.to ? q.gte('transaction_timestamp', (body.from ?? '1970-01-01') + 'T00:00:00Z').lte('transaction_timestamp', (body.to ?? '2999-12-31') + 'T23:59:59Z') : q);
      if (error) throw error;
      rows = data || [];
    }
    if (!rows.length) return new Response(JSON.stringify({
      ok: true,
      updated: 0
    }), {
      headers: {
        ...corsHeaders,
        'content-type': 'application/json'
      }
    });
    // Mark rows as allocated + optional note
    const allocIds = rows
      .filter(r =>
        r.kind === 'USDT_DEPOSIT' ||
        (r.currency_pair === 'USDTZAR' && String(r.credit_currency).toUpperCase() === 'USDT')
      )
      .map(r => r.id);

    if (allocIds.length === 0) {
      return new Response(JSON.stringify({
        ok: true,
        updated: 0
      }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' }
      });
    }

    const { error: updErr } = await sb
      .from('real_exchange_txs')
      .update({ allocated_month: body.allocate_to_month, notes: body.note ?? null })
      .in('id', allocIds);
    if (updErr) throw updErr;

    // Recompute SAB ledger + carry for affected customers/month
    const affectedCustomers = Array.from(new Set(
      rows
        .filter(r =>
          r.kind === 'USDT_DEPOSIT' ||
          (r.currency_pair === 'USDTZAR' && String(r.credit_currency).toUpperCase() === 'USDT')
        )
        .map(r => r.customer_id)
    ));

    let recomputed = 0;
    for (const cid of affectedCustomers) {
      const { error: rpcErr } = await sb.rpc('sab_dca_recompute_month_pair', {
        _customer_id: cid,
        _yyyymm: body.allocate_to_month
      });
      if (rpcErr) throw rpcErr;
      recomputed++;
    }

    return new Response(JSON.stringify({
      ok: true,
      updated: allocIds.length,
      recomputed,
      month: body.allocate_to_month
    }), {
      headers: { ...corsHeaders, 'content-type': 'application/json' }
    });

  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: String(e?.message || e)
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'content-type': 'application/json'
      }
    });
  }
});
