// deno-lint-ignore-file no-explicit-any
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
// --- CORS ---
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

Deno.serve(async (req)=>{
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  // Method guard (keeps logs clean if something hits it with GET)
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'content-type': 'application/json' }
    });
  }

  try {
    const body = await req.json().catch(()=>({}));
    if (!body.customer_id) throw new Error('customer_id is required');

    // normalize `yyyy/mm/dd` → `yyyy-mm-dd`
    const normDate = (s?: string) => (s ? String(s).replaceAll('/', '-') : undefined);

    let q = sb
      .from('real_exchange_txs')
      .select('id, transaction_timestamp, tx_type, currency_pair, debit_currency, debit_value, credit_currency, credit_value, fee_currency, fee_value, trade_price_currency, trade_price, exchange_order_id, kind, allocated_month')
      .eq('customer_id', body.customer_id)
      .order('transaction_timestamp', { ascending: true });

    const fromIso = normDate(body.from);
    const toIso   = normDate(body.to);
    if (fromIso) q = q.gte('transaction_timestamp', `${fromIso}T00:00:00Z`);
    if (toIso)   q = q.lte('transaction_timestamp', `${toIso}T23:59:59Z`);

    if (body.only_unallocated_deposits) q = q.eq('kind', 'USDT_DEPOSIT').is('allocated_month', null);
    const { data, error } = await q;
    if (error) throw error;
    // present same-ish columns as your CSV screenshot, with classification + flags
    const rows = (data || []).map((r)=>({
        date: r.transaction_timestamp,
        'transaction type': r.tx_type,
        'debit currency': r.debit_currency,
        'debit value': r.debit_value,
        'credit currency': r.credit_currency,
        'credit value': r.credit_value,
        'fee currency': r.fee_currency,
        'fee value': r.fee_value,
        'trade currency pair': r.currency_pair,
        'trade price currency': r.trade_price_currency,
        'trade price': r.trade_price,
        'order id': r.exchange_order_id,
        classification: r.kind,
        unallocated_deposit: r.kind === 'USDT_DEPOSIT' && !r.allocated_month ? true : false,
        allocated_month: r.allocated_month || null,
        real_tx_id: r.id
      }));
    return new Response(JSON.stringify({
      ok: true,
      rows
    }), {
      headers: {
        ...corsHeaders,
        'content-type': 'application/json'
      }
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
