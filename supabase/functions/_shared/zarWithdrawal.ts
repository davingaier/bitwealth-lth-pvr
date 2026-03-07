// _shared/zarWithdrawal.ts  (EF12 + EF13)
//
// Internal conversion helpers called by ef_request_withdrawal.
// NOT standalone edge functions — imported as a module.
//
// EF12: convertUsdtToZar — USDTZAR SELL (selling USDT, receiving ZAR)
// EF13: convertBtcToZar  — BTCZAR SELL  (selling BTC, receiving ZAR)
//
// Both follow limit → 2-min poll → market fallback pattern.
// On fill they call VALR fiat ZAR withdrawal to the customer's linked bank.

import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  getOrderBook,
  getOrderSummaryByCustomerOrderId,
  placeLimitOrder,
  placeMarketOrder,
  cancelOrderById,
  zarWithdraw,
} from "./valrClient.ts";

// ── Polling constants ─────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_ROUNDS  = 24;   // 24 × 5 s = 120 s max

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Generic fill-poller ───────────────────────────────────────────────────────
async function waitForFill(
  customerOrderId: string,
  pair: string,
  subaccountId: string | null,
  creds: { apiKey: string; apiSecret: string } | null,
): Promise<{
  filled: boolean;
  fillPrice?: number;
  fillQty?: number;     // base asset received
  valrOrderId?: string;
}> {
  for (let round = 0; round < POLL_MAX_ROUNDS; round++) {
    await sleep(POLL_INTERVAL_MS);
    let summary: any;
    try {
      summary = await getOrderSummaryByCustomerOrderId(customerOrderId, pair, subaccountId, creds);
    } catch {
      continue;
    }
    const status: string = summary?.orderStatusType ?? "";
    if (status === "Filled") {
      return {
        filled: true,
        fillPrice: Number(summary.averagePrice ?? summary.price),
        fillQty: Number(summary.originalQuantity ?? summary.quantity),
        valrOrderId: summary.orderId ?? summary.id,
      };
    }
    if (status === "Cancelled" || status === "Failed") return { filled: false };
  }
  return { filled: false };
}

// ── EF12: convertUsdtToZar ────────────────────────────────────────────────────
// Sells amountUsdt USDT on USDTZAR market, then withdraws ZAR to customer's bank.
// On success: updates withdrawal_requests.conversion_status = 'zar_ready', triggers ZAR withdrawal.
// Returns: { success, zarReceived, valrWithdrawalId }
export async function convertUsdtToZar(
  sb: SupabaseClient,
  orgId: string,
  requestId: string,
  customerId: number,
  amountUsdt: number,
  bankValrId: string,
  withdrawalAmountZar: number,   // ZAR amount to withdraw (may differ from conversion output due to fees)
  fastWithdrawal: boolean,
  subaccountId: string | null,
  creds: { apiKey: string; apiSecret: string } | null,
  testMode: boolean,
): Promise<{ success: boolean; zarReceived?: number; valrWithdrawalId?: string; error?: string }> {
  const pair = "USDTZAR";

  // ── 1. Best bid (selling USDT, receiving ZAR) ─────────────────────────────
  let bestBid: number;
  try {
    const book = await getOrderBook(pair);
    bestBid = Number(book.Bids[0]?.price);
    if (!bestBid || bestBid <= 0) throw new Error("No bid in order book");
  } catch (e) {
    return { success: false, error: `Order book error: ${(e as Error).message}` };
  }

  const limitPrice = bestBid;
  // quantity = USDT to sell (base = USDT for USDTZAR SELL)
  const qtyUsdt = amountUsdt;
  const customerOrderId = `wd-usdt-zar-${requestId}`;

  // ── 2. Place LIMIT SELL ───────────────────────────────────────────────────
  let limitOrderId: string | undefined;
  if (!testMode) {
    try {
      const res: any = await placeLimitOrder(
        { side: "SELL", pair, price: limitPrice.toFixed(4), quantity: qtyUsdt.toFixed(6), customerOrderId },
        subaccountId, creds,
      );
      limitOrderId = res?.id ?? res?.orderId;
    } catch (e) {
      return { success: false, error: `LIMIT order failed: ${(e as Error).message}` };
    }
  }

  await sb
    .schema("lth_pvr")
    .from("withdrawal_requests")
    .update({ conversion_status: "limit_placed", conversion_order_id: limitOrderId ?? customerOrderId })
    .eq("request_id", requestId);

  // ── 3. Poll for fill ──────────────────────────────────────────────────────
  let fillResult: { filled: boolean; fillPrice?: number; fillQty?: number; valrOrderId?: string };
  if (testMode) {
    fillResult = { filled: true, fillPrice: limitPrice, fillQty: qtyUsdt, valrOrderId: "test-order" };
  } else {
    fillResult = await waitForFill(customerOrderId, pair, subaccountId, creds);
  }

  // ── 4. Market fallback ────────────────────────────────────────────────────
  if (!fillResult.filled) {
    if (limitOrderId && !testMode) {
      try { await cancelOrderById(limitOrderId, pair, subaccountId, creds); } catch { /* best-effort */ }
    }
    const mktOrderId = `wd-usdt-zar-mkt-${requestId}`;
    if (!testMode) {
      try {
        await placeMarketOrder(pair, "SELL", qtyUsdt.toFixed(6), mktOrderId, subaccountId, creds);
        await sleep(3_000);
        const mktSummary: any = await getOrderSummaryByCustomerOrderId(mktOrderId, pair, subaccountId, creds).catch(() => null);
        if (mktSummary?.orderStatusType === "Filled") {
          fillResult = {
            filled: true,
            fillPrice: Number(mktSummary.averagePrice ?? mktSummary.price),
            fillQty: Number(mktSummary.originalQuantity ?? mktSummary.quantity),
            valrOrderId: mktSummary.orderId ?? mktSummary.id,
          };
        } else {
          return { success: false, error: "Market order not filled within timeout" };
        }
      } catch (e) {
        return { success: false, error: `MARKET order failed: ${(e as Error).message}` };
      }
    } else {
      fillResult = { filled: true, fillPrice: limitPrice, fillQty: qtyUsdt };
    }
  }

  // ── 5. Conversion filled — update record ──────────────────────────────────
  const zarReceived = fillResult.fillPrice != null && fillResult.fillQty != null
    ? fillResult.fillQty * fillResult.fillPrice
    : withdrawalAmountZar;

  await sb
    .schema("lth_pvr")
    .from("withdrawal_requests")
    .update({ conversion_status: "zar_ready", conversion_order_id: fillResult.valrOrderId ?? limitOrderId })
    .eq("request_id", requestId);

  // ── 6. Trigger ZAR fiat withdrawal via VALR ───────────────────────────────
  let valrWithdrawalId: string | undefined;
  if (!testMode) {
    try {
      const wdRes: any = await zarWithdraw(
        bankValrId,
        withdrawalAmountZar.toFixed(2),
        fastWithdrawal,
        subaccountId,
        creds,
      );
      valrWithdrawalId = wdRes?.id ?? wdRes?.withdrawalId;
    } catch (e) {
      return { success: false, error: `ZAR withdrawal API failed: ${(e as Error).message}`, zarReceived };
    }
  } else {
    valrWithdrawalId = "test-zar-withdrawal-id";
  }

  return { success: true, zarReceived, valrWithdrawalId };
}

// ── EF13: convertBtcToZar ─────────────────────────────────────────────────────
// Sells amountBtc BTC on BTCZAR market, then withdraws ZAR to customer's bank.
export async function convertBtcToZar(
  sb: SupabaseClient,
  orgId: string,
  requestId: string,
  customerId: number,
  amountBtc: number,
  bankValrId: string,
  withdrawalAmountZar: number,
  fastWithdrawal: boolean,
  subaccountId: string | null,
  creds: { apiKey: string; apiSecret: string } | null,
  testMode: boolean,
): Promise<{ success: boolean; zarReceived?: number; valrWithdrawalId?: string; error?: string }> {
  const pair = "BTCZAR";

  let bestBid: number;
  try {
    const book = await getOrderBook(pair);
    bestBid = Number(book.Bids[0]?.price);
    if (!bestBid || bestBid <= 0) throw new Error("No bid in order book");
  } catch (e) {
    return { success: false, error: `Order book error: ${(e as Error).message}` };
  }

  const limitPrice = bestBid;
  const customerOrderId = `wd-btc-zar-${requestId}`;

  let limitOrderId: string | undefined;
  if (!testMode) {
    try {
      const res: any = await placeLimitOrder(
        { side: "SELL", pair, price: limitPrice.toFixed(2), quantity: amountBtc.toFixed(8), customerOrderId },
        subaccountId, creds,
      );
      limitOrderId = res?.id ?? res?.orderId;
    } catch (e) {
      return { success: false, error: `LIMIT order failed: ${(e as Error).message}` };
    }
  }

  await sb
    .schema("lth_pvr")
    .from("withdrawal_requests")
    .update({ conversion_status: "limit_placed", conversion_order_id: limitOrderId ?? customerOrderId })
    .eq("request_id", requestId);

  let fillResult: { filled: boolean; fillPrice?: number; fillQty?: number; valrOrderId?: string };
  if (testMode) {
    fillResult = { filled: true, fillPrice: limitPrice, fillQty: amountBtc };
  } else {
    fillResult = await waitForFill(customerOrderId, pair, subaccountId, creds);
  }

  if (!fillResult.filled) {
    if (limitOrderId && !testMode) {
      try { await cancelOrderById(limitOrderId, pair, subaccountId, creds); } catch { /* best-effort */ }
    }
    const mktOrderId = `wd-btc-zar-mkt-${requestId}`;
    if (!testMode) {
      try {
        await placeMarketOrder(pair, "SELL", amountBtc.toFixed(8), mktOrderId, subaccountId, creds);
        await sleep(3_000);
        const mktSummary: any = await getOrderSummaryByCustomerOrderId(mktOrderId, pair, subaccountId, creds).catch(() => null);
        if (mktSummary?.orderStatusType === "Filled") {
          fillResult = {
            filled: true,
            fillPrice: Number(mktSummary.averagePrice ?? mktSummary.price),
            fillQty: Number(mktSummary.originalQuantity ?? mktSummary.quantity),
            valrOrderId: mktSummary.orderId ?? mktSummary.id,
          };
        } else {
          return { success: false, error: "Market order not filled within timeout" };
        }
      } catch (e) {
        return { success: false, error: `MARKET order failed: ${(e as Error).message}` };
      }
    } else {
      fillResult = { filled: true, fillPrice: limitPrice, fillQty: amountBtc };
    }
  }

  const zarReceived = fillResult.fillPrice != null && fillResult.fillQty != null
    ? fillResult.fillQty * fillResult.fillPrice
    : withdrawalAmountZar;

  await sb
    .schema("lth_pvr")
    .from("withdrawal_requests")
    .update({ conversion_status: "zar_ready", conversion_order_id: fillResult.valrOrderId ?? limitOrderId })
    .eq("request_id", requestId);

  let valrWithdrawalId: string | undefined;
  if (!testMode) {
    try {
      const wdRes: any = await zarWithdraw(
        bankValrId,
        withdrawalAmountZar.toFixed(2),
        fastWithdrawal,
        subaccountId,
        creds,
      );
      valrWithdrawalId = wdRes?.id ?? wdRes?.withdrawalId;
    } catch (e) {
      return { success: false, error: `ZAR withdrawal API failed: ${(e as Error).message}`, zarReceived };
    }
  } else {
    valrWithdrawalId = "test-zar-withdrawal-id";
  }

  return { success: true, zarReceived, valrWithdrawalId };
}
