// supabase/functions/valr-balance-finalizer/index.ts
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
/**
 * Reuse the same VALR call you already use in valr-balances EF.
 * I’ve inlined a minimal version that reads the API creds for a customer
 * and returns { btc_total, btc_available, usdt_total, usdt_available }.
 */ async function fetchValrBalanceForCustomer(supabase, customer_id) {
  // 1) Get API creds from your table(s)
  const { data: c, error: cErr } = await supabase.from('customer_details').select('exchange_api_name, exchange_api_key, exchange_api_secret').eq('customer_id', customer_id).single();
  if (cErr) throw cErr;
  if (!c || c.exchange_api_name !== 'VALR') throw new Error(`No VALR API creds for customer ${customer_id}`);
  const apiKey = c.exchange_api_key;
  const apiSecret = c.exchange_api_secret;
  // 2) Call VALR balances (copy the exact signing you use in valr-balances)
  const now = Date.now().toString();
  const method = 'GET';
  const path = '/v1/account/balances';
  const body = '';
  // --- HMAC-SHA512 signature: timestamp + method + path + body (VALR docs)
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(apiSecret), {
    name: 'HMAC',
    hash: 'SHA-512'
  }, false, [
    'sign'
  ]);
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(now + method + path + body));
  const signature = [
    ...new Uint8Array(sigBuf)
  ].map((b)=>b.toString(16).padStart(2, '0')).join('');
  const res = await fetch('https://api.valr.com' + path, {
    method,
    headers: {
      'X-VALR-API-KEY': apiKey,
      'X-VALR-SIGNATURE': signature,
      'X-VALR-TIMESTAMP': now
    }
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`VALR balances failed: ${res.status} ${t}`);
  }
  const list = await res.json();
  const num = (s)=>s ? Number(s) : 0;
  const btc = list.find((x)=>x.currency === 'BTC');
  const usdt = list.find((x)=>x.currency === 'USDT');
  return {
    btc_total: num(btc?.total),
    btc_available: num(btc?.available),
    usdt_total: num(usdt?.total),
    usdt_available: num(usdt?.available)
  };
}
Deno.serve(async (_req)=>{
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    // Write ONLY for Active customers
    const { data: customers, error: cErr } = await supabase.from('customer_details').select('customer_id').eq('customer_status', 'Active');
    if (cErr) throw cErr;
    // UTC day the job runs
    const as_of_date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    for (const row of customers ?? []){
      const customer_id = row.customer_id;
      const { btc_total, btc_available, usdt_total, usdt_available } = await fetchValrBalanceForCustomer(supabase, customer_id);
      const up = await supabase.from('exchange_daily_balances').upsert({
        customer_id,
        source_exchange: 'VALR',
        as_of_date,
        btc_total,
        btc_available,
        usdt_total,
        usdt_available,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'customer_id,source_exchange,as_of_date'
      });
      if (up.error) {
        console.error('upsert_failed', customer_id, up.error.message);
      }
    }
    return new Response(JSON.stringify({
      ok: true,
      finalized_for: as_of_date
    }), {
      status: 200
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({
      ok: false,
      error: String(e)
    }), {
      status: 500
    });
  }
});
