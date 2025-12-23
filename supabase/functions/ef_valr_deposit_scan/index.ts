// ef_valr_deposit_scan/index.ts
import { getServiceClient } from "./client.ts";
import { getCryptoDepositHistory, getCryptoWithdrawHistory } from "./valrClient.ts";
Deno.serve(async ()=>{
  const sb = getServiceClient();
  const org_id = Deno.env.get("ORG_ID");
  if (!org_id) {
    return new Response("ORG_ID missing", {
      status: 500
    });
  }
  // 1) Resolve omnibus exchange account for VALR
  const { data: accounts, error: accErr } = await sb.from("exchange_accounts").select("exchange_account_id").eq("org_id", org_id).eq("exchange", "VALR").eq("is_omnibus", true).limit(1);
  if (accErr) {
    console.error(accErr);
    return new Response(accErr.message, {
      status: 500
    });
  }
  const exchange_account_id = accounts?.[0]?.exchange_account_id ?? null;
  if (!exchange_account_id) {
    return new Response("No omnibus VALR exchange_account found", {
      status: 400
    });
  }
  // 2) For now, map everything to a single customer (e.g. your own ID).
  //    REPLACE THIS with logic to map per-customer from subaccount_ref/etc.
  const defaultCustomerId = Number(Deno.env.get("DEFAULT_CUSTOMER_ID") ?? "0");
  if (!defaultCustomerId) {
    return new Response("DEFAULT_CUSTOMER_ID env missing or zero", {
      status: 400
    });
  }
  const { data: deposits, error: depErr } = await safeWrap(getCryptoDepositHistory());
  if (depErr) {
    console.error(depErr);
    return new Response(depErr.message, {
      status: 500
    });
  }
  const { data: withdrawals, error: wdrErr } = await safeWrap(getCryptoWithdrawHistory());
  if (wdrErr) {
    console.error(wdrErr);
    return new Response(wdrErr.message, {
      status: 500
    });
  }
  const events = [];
  for (const d of deposits ?? []){
    if (![
      "USDT",
      "BTC"
    ].includes(d.currency)) continue;
    if (d.state && d.state.toUpperCase() !== "COMPLETED") continue;
    const idem = `VALR:DEPOSIT:${d.id}`;
    events.push({
      kind: "deposit",
      asset: d.currency,
      amount: Number(d.amount),
      ext_ref: d.txHash ?? d.address ?? d.id,
      occurred_at: new Date(d.createdAt).toISOString(),
      idempotency_key: idem
    });
  }
  for (const w of withdrawals ?? []){
    if (![
      "USDT",
      "BTC"
    ].includes(w.currency)) continue;
    if (w.state && w.state.toUpperCase() !== "COMPLETED") continue;
    const idem = `VALR:WITHDRAWAL:${w.id}`;
    events.push({
      kind: "withdrawal",
      asset: w.currency,
      amount: Number(w.amount),
      ext_ref: w.txHash ?? w.address ?? w.id,
      occurred_at: new Date(w.createdAt).toISOString(),
      idempotency_key: idem
    });
  }
  // 3) Upsert into exchange_funding_events with idempotency on idempotency_key
  let inserted = 0;
  for (const e of events){
    const { error: upErr } = await sb.from("exchange_funding_events").insert({
      org_id,
      customer_id: defaultCustomerId,
      exchange_account_id,
      kind: e.kind,
      asset: e.asset,
      amount: e.amount,
      ext_ref: e.ext_ref,
      occurred_at: e.occurred_at,
      idempotency_key: e.idempotency_key
    }).select("funding_id"); // will error if idempotency key already exists
    if (upErr) {
      // Skip duplicate key errors, log others
      if (!upErr.message.includes("duplicate key value")) {
        console.error("funding insert failed", upErr);
      }
      continue;
    }
    inserted++;
  }
  return new Response(`ok: inserted ${inserted} funding events`);
});
// helper for converting promise → {data,error}
async function safeWrap(p) {
  try {
    const data = await p;
    return {
      data
    };
  } catch (e) {
    return {
      error: e
    };
  }
}
