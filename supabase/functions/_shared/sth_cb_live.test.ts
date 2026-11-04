import { assertEquals } from "jsr:@std/assert@1";
import { LiveCustomer, LiveSignal, planCustomerDecision } from "./sth_cb_live.ts";

const sig = (o: Partial<LiveSignal> = {}): LiveSignal => ({ inMarket: true, targetAlloc: 1, prevTargetAlloc: 1, rule: "Hold", note: "", priceUsd: 60_000, ...o });
const cust = (o: Partial<LiveCustomer> = {}): LiveCustomer => ({ customerId: 1, btcBalance: 0, usdtBalance: 0, usdpcValueUsd: 0, lastBuyPx: null, joinPolicy: "immediate", minOrderUsdt: 10, ...o });

Deno.test("join (Policy A): new client with cash while strategy is in market buys everything", () => {
  const d = planCustomerDecision(sig(), cust({ usdtBalance: 5_000, usdpcValueUsd: 5_000 }));
  assertEquals(d.action, "BUY"); assertEquals(d.amountPct, 1); assertEquals(d.rule, "Join: adopt current state");
});

Deno.test("join_policy next_signal: waits while strategy is in market without a new entry", () => {
  const d = planCustomerDecision(sig(), cust({ usdtBalance: 5_000, joinPolicy: "next_signal" }));
  assertEquals(d.action, "HOLD"); assertEquals(d.rule, "Join: waiting for next entry signal");
});

Deno.test("join_policy next_signal: buys on an allocation increase (entry / re-buy)", () => {
  const d = planCustomerDecision(sig({ prevTargetAlloc: 0, rule: "R1 Capitulation buy", note: "cap" }), cust({ usdtBalance: 5_000, joinPolicy: "next_signal" }));
  assertEquals(d.action, "BUY"); assertEquals(d.amountPct, 1); assertEquals(d.rule, "R1 Capitulation buy");
});

Deno.test("join_policy next_signal: once invested, follows the strategy like everyone else", () => {
  const d = planCustomerDecision(sig(), cust({ btcBalance: 0.1, usdtBalance: 1_000, lastBuyPx: 50_000, joinPolicy: "next_signal" }));
  assertEquals(d.action, "BUY"); assertEquals(d.rule, "Deploy contribution");
});

Deno.test("in cash: strategy out of market → HOLD", () => {
  const d = planCustomerDecision(sig({ inMarket: false, targetAlloc: 0 }), cust({ usdtBalance: 5_000 }));
  assertEquals(d.action, "HOLD");
});

Deno.test("monthly contribution while fully invested is deployed", () => {
  const d = planCustomerDecision(sig(), cust({ btcBalance: 0.5, usdtBalance: 200, lastBuyPx: 40_000 }));
  assertEquals(d.action, "BUY"); assertEquals(d.amountPct, 1); assertEquals(d.rule, "Deploy contribution");
});

Deno.test("dust: idle cash below minimum order is left alone", () => {
  const d = planCustomerDecision(sig(), cust({ btcBalance: 0.5, usdtBalance: 5, lastBuyPx: 40_000 }));
  assertEquals(d.action, "HOLD");
});

Deno.test("full exit sells 100% of BTC and is never gated by the no-loss rule", () => {
  const d = planCustomerDecision(sig({ inMarket: false, targetAlloc: 0, prevTargetAlloc: 1, rule: "R3 Trend exit", note: "x" }), cust({ btcBalance: 0.5, lastBuyPx: 90_000 }));
  assertEquals(d.action, "SELL"); assertEquals(d.amountPct, 1); assertEquals(d.rule, "R3 Trend exit");
});

Deno.test("ladder slice to 50% sells half of a fully-invested customer", () => {
  const d = planCustomerDecision(sig({ targetAlloc: 0.5, prevTargetAlloc: 1, rule: "R15 LTH scale-out tier 1 → 50% BTC", note: "s" }), cust({ btcBalance: 1, lastBuyPx: 40_000 }));
  assertEquals(d.action, "SELL"); assertEquals(d.amountPct, 0.5);
});

Deno.test("ladder slice: customer already at the target does nothing", () => {
  // 0.5 BTC @ 60k = 30k, cash 30k → already 50 %
  const d = planCustomerDecision(sig({ targetAlloc: 0.5, prevTargetAlloc: 0.5 }), cust({ btcBalance: 0.5, usdtBalance: 30_000, lastBuyPx: 40_000 }));
  assertEquals(d.action, "HOLD");
});

Deno.test("ladder slice to 20% from a customer at 50% sells 60% of their BTC", () => {
  const d = planCustomerDecision(sig({ targetAlloc: 0.2, prevTargetAlloc: 0.5, rule: "R15 tier 2", note: "" }), cust({ btcBalance: 0.5, usdtBalance: 30_000, lastBuyPx: 40_000 }));
  assertEquals(d.action, "SELL"); assertEquals(d.amountPct, 0.6);
});

Deno.test("per-customer no-loss rule: slice skipped when price is below this customer's last buy", () => {
  const d = planCustomerDecision(sig({ targetAlloc: 0.5, prevTargetAlloc: 1, rule: "R15 tier 1", note: "" }), cust({ btcBalance: 1, lastBuyPx: 65_000 }));
  assertEquals(d.action, "HOLD"); assertEquals(d.rule, "R15 deferred (below last buy)");
});

Deno.test("dip re-buy from 50% back to 100% spends all cash", () => {
  const d = planCustomerDecision(sig({ targetAlloc: 1, prevTargetAlloc: 0.5, rule: "R16 Dip re-buy → 100% BTC", note: "" }), cust({ btcBalance: 0.5, usdtBalance: 30_000, lastBuyPx: 40_000 }));
  assertEquals(d.action, "BUY"); assertEquals(d.amountPct, 1); assertEquals(d.rule, "R16 Dip re-buy → 100% BTC");
});

Deno.test("partial top-up to a 50% target spends only what is needed", () => {
  // 0.2 BTC @60k = 12k, cash 28k → nav 40k, current 30 %, want 20k BTC → buy 8k of 28k cash
  const d = planCustomerDecision(sig({ targetAlloc: 0.5, prevTargetAlloc: 0.5 }), cust({ btcBalance: 0.2, usdtBalance: 28_000, lastBuyPx: 40_000 }));
  assertEquals(d.action, "BUY"); assertEquals(d.amountPct, +(8_000 / 28_000).toFixed(6));
});

Deno.test("unfunded customer → HOLD", () => {
  const d = planCustomerDecision(sig(), cust());
  assertEquals(d.action, "HOLD");
});
